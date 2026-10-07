import { reactive, ref } from 'vue';
import { classifyEmotion } from '../core/emotion-engine';
import { coverPresetFor } from '../core/cover-presets';
import { copyMeme, createMemeId, reviseMeme, sortMemes, type AudioFeatures, type CoverConfig, type EmotionLabel, type EmotionResult, type MemeContent, type StudioStage, type VoiceMeme } from '../core/models';
import type { RecorderPort } from '../ports/recorder.port';
import type { AudioAnalyzerPort } from '../ports/audio-analyzer.port';
import type { AudioCropperPort } from '../ports/audio-cropper.port';
import type { CoverRendererPort } from '../ports/cover-renderer.port';
import type { MemeRepository } from '../ports/meme-repository.port';
import type { SharePort } from '../ports/share.port';

export type SaveMode = 'update' | 'copy';
/** 写入已发生、但尚未通过点读确认的保存尝试；保留它以便核对而不是重写 */
export interface UnverifiedSave { mode: SaveMode; id: string; token: string; meme: VoiceMeme }

export interface StudioDependencies { recorder: RecorderPort; analyzer: AudioAnalyzerPort; cropper: AudioCropperPort; renderer: CoverRendererPort; repository: MemeRepository; share: SharePort }
export function useStudio(deps: StudioDependencies) {
  const stage = ref<StudioStage>('record'); const error = ref(''); const notice = ref(''); const level = ref(0);
  const saving = ref(false); const listStale = ref(false);
  const unverified = ref<UnverifiedSave>();
  /** 另存副本在编辑会话内预占的 id；确认提交后清除，使"再另存一份"得到新身份 */
  const reservedCopyId = ref<string>();
  const draft = reactive<{ id?: string; createdAt?: string; title: string; audio?: Blob; duration: number; cropStart: number; cropEnd: number }>({ title: '我的声音表情', duration: 0, cropStart: 0, cropEnd: 0 });
  const emotion = ref<EmotionResult>(); const features = ref<AudioFeatures>(); const cover = ref<CoverConfig>(coverPresetFor('元气满满')); const collection = ref<VoiceMeme[]>([]);

  async function startRecording() { error.value = ''; try { await deps.recorder.start((value) => { level.value = value; }); notice.value = '正在录音，最长 10 秒'; } catch { error.value = '无法使用麦克风权限，请在浏览器设置中允许访问或导入音频。'; } }
  async function stopRecording() { try { draft.audio = await deps.recorder.stop(); const info = await deps.cropper.inspect(draft.audio); draft.duration = info.duration; draft.cropStart = 0; draft.cropEnd = Math.min(10, info.duration); stage.value = 'crop'; notice.value = info.needsCrop ? '音频超过 10 秒，请选择保留片段' : '录音完成，可以试听并分析'; } catch (cause) { error.value = cause instanceof Error ? cause.message : '录音结束失败'; } }
  async function importAudio(blob: Blob) { draft.audio = blob; const info = await deps.cropper.inspect(blob); draft.duration = info.duration; draft.cropStart = 0; draft.cropEnd = Math.min(10, info.duration); stage.value = 'crop'; }
  async function analyze() { if (!draft.audio) { error.value = '请先录制或导入一段声音'; return; } const cropped = await deps.cropper.crop(draft.audio, { start: draft.cropStart, end: draft.cropEnd }); draft.audio = cropped.blob; draft.duration = cropped.duration; const result = await deps.analyzer.analyze(cropped.blob); features.value = result.features; emotion.value = classifyEmotion(result.features); cover.value = coverPresetFor(emotion.value.label); stage.value = 'emotion'; }
  function selectEmotion(label: EmotionLabel) { const current = emotion.value ?? classifyEmotion({ loudness:0,dynamics:0,pitch:0,zeroCrossing:0,pauseRatio:1,tempoVariation:0 }); emotion.value = { ...current, label, explanation: `已手动选择「${label}」标签。` }; cover.value = { ...coverPresetFor(label), title: cover.value.title || label }; }
  function goCover() { stage.value = 'cover'; }

  function resetTransientSaveState() { unverified.value = undefined; reservedCopyId.value = undefined; saving.value = false; }
  function buildContent(coverBlob: Blob): MemeContent {
    return { title: draft.title.trim() || '未命名声音', emotion: emotion.value!.label, confidence: emotion.value!.confidence, features: features.value!, audio: draft.audio!, duration: draft.duration, cover: coverBlob, coverConfig: { ...cover.value } };
  }
  function commitLocally(meme: VoiceMeme) {
    const index = collection.value.findIndex((item) => item.id === meme.id);
    if (index >= 0) collection.value.splice(index, 1, meme); else collection.value.push(meme);
    collection.value = sortMemes(collection.value);
  }
  /** 点读确认通过后的唯一收尾：本地同步 → 尽力刷新列表 → 宣布成功 */
  async function confirmSave(mode: SaveMode, meme: VoiceMeme) {
    unverified.value = undefined;
    commitLocally(meme);
    if (mode === 'copy') { draft.id = meme.id; draft.createdAt = meme.createdAt; reservedCopyId.value = undefined; }
    try { await loadCollection(); listStale.value = false; } catch { listStale.value = true; }
    saving.value = false;
    stage.value = 'collection';
    notice.value = mode === 'copy' ? '已另存为独立副本，可与原作分别修改、删除' : '原作已更新，创建时间保持不变';
    error.value = '';
  }

  async function save(mode: SaveMode = draft.id ? 'update' : 'copy', target?: HTMLCanvasElement) {
    if (saving.value) return;
    if (!draft.audio || !emotion.value || !features.value) { error.value = '作品信息尚未完整，请先完成声音分析'; return; }
    if (mode === 'update' && !(draft.id && draft.createdAt)) { error.value = '没有可更新的原作，请使用另存副本'; return; }
    error.value = ''; notice.value = ''; saving.value = true;
    let coverBlob: Blob;
    try { coverBlob = await deps.renderer.render(cover.value, target); }
    catch { saving.value = false; error.value = '封面生成失败，本次编辑内容仍保留，请重试。'; return; }
    const now = new Date().toISOString();
    const meme = mode === 'update'
      ? reviseMeme({ id: draft.id!, createdAt: draft.createdAt! }, buildContent(coverBlob), now)
      : copyMeme(buildContent(coverBlob), now, reservedCopyId.value ?? (reservedCopyId.value = createMemeId()));
    try { await deps.repository.save(meme); }
    catch { saving.value = false; error.value = '写入失败，本次编辑内容仍保留，请检查浏览器存储空间后重试（重试不会产生重复副本）。'; return; }
    // 写入 Promise 成功不等于可以宣布成功：点读核对修改时间令牌
    let echo: VoiceMeme | undefined;
    try { echo = await deps.repository.get(meme.id); }
    catch { saving.value = false; unverified.value = { mode, id: meme.id, token: now, meme }; error.value = '保存结果尚未确认：写入可能已经完成。请点「核对保存结果」，不要重复另存。'; return; }
    if (echo?.updatedAt === now) { await confirmSave(mode, echo); return; }
    saving.value = false;
    unverified.value = { mode, id: meme.id, token: now, meme };
    error.value = echo
      ? '存储中的记录与本次保存不一致，请核对；如非最新内容可重新保存覆盖，不会产生副本。'
      : '没有核对到这条记录，写入可能未完成。编辑内容仍保留，请核对后决定是否重新保存。';
  }

  /** 写入后回显失败的恢复入口：只读取真实结果，绝不重写 */
  async function verifyPendingSave() {
    const pending = unverified.value; if (!pending || saving.value) return;
    error.value = '';
    let echo: VoiceMeme | undefined;
    try { echo = await deps.repository.get(pending.id); }
    catch { error.value = '仍无法读取本地存储，请稍后再次核对；编辑内容仍保留。'; return; }
    if (echo?.updatedAt === pending.token) { await confirmSave(pending.mode, echo); return; }
    error.value = echo
      ? '核对到的记录不是本次保存的内容，可点「重新保存本次内容」覆盖同一身份，不会产生重复副本。'
      : '仍未核对到这条记录，可能写入确实失败；可点「重新保存本次内容」，编辑内容仍保留。';
  }

  async function loadCollection() { collection.value = sortMemes(await deps.repository.list()); listStale.value = false; }
  async function retryRefreshList() { try { await loadCollection(); error.value = ''; } catch { listStale.value = true; error.value = '作品集刷新失败，已保存内容不受影响，请稍后重试刷新。'; } }
  function editMeme(meme: VoiceMeme) { resetTransientSaveState(); Object.assign(draft, { id:meme.id,createdAt:meme.createdAt,title:meme.title,audio:meme.audio,duration:meme.duration,cropStart:0,cropEnd:meme.duration }); features.value = meme.features; emotion.value = { label:meme.emotion,confidence:meme.confidence,explanation:'编辑已保存作品',scores:{'暴躁老哥':0,'温柔姐姐':0,'阴阳怪气':0,'元气满满':0} }; cover.value = { ...meme.coverConfig }; stage.value = 'cover'; }
  async function deleteMeme(id: string) { await deps.repository.delete(id); const index = collection.value.findIndex((item) => item.id === id); if (index >= 0) collection.value.splice(index, 1); try { await loadCollection(); } catch { listStale.value = true; } }
  async function shareMeme(meme: VoiceMeme) { const result = await deps.share.share(meme); notice.value = result === 'shared' ? '已打开系统分享' : '浏览器不支持文件分享，已下载音频和封面'; }
  function newRecording() { resetTransientSaveState(); draft.id = undefined; draft.createdAt = undefined; draft.title = '我的声音表情'; draft.audio = undefined; emotion.value = undefined; features.value = undefined; stage.value = 'record'; error.value = ''; }
  return { stage,error,notice,level,saving,listStale,unverified,draft,emotion,features,cover,collection,startRecording,stopRecording,importAudio,analyze,selectEmotion,goCover,save,verifyPendingSave,loadCollection,retryRefreshList,editMeme,deleteMeme,shareMeme,newRecording };
}
