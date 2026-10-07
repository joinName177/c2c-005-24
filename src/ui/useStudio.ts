import { reactive, ref } from 'vue';
import { classifyEmotion } from '../core/emotion-engine';
import { coverPresetFor } from '../core/cover-presets';
import { isConfirmed, resolveSave, sortByRecent, type MemeContent, type SaveTarget } from '../core/save-policy';
import type { AudioFeatures, CoverConfig, EmotionLabel, EmotionResult, StudioStage, VoiceMeme } from '../core/models';
import type { RecorderPort } from '../ports/recorder.port';
import type { AudioAnalyzerPort } from '../ports/audio-analyzer.port';
import type { AudioCropperPort } from '../ports/audio-cropper.port';
import type { CoverRendererPort } from '../ports/cover-renderer.port';
import type { MemeRepository } from '../ports/meme-repository.port';
import type { SharePort } from '../ports/share.port';

export interface StudioDependencies { recorder: RecorderPort; analyzer: AudioAnalyzerPort; cropper: AudioCropperPort; renderer: CoverRendererPort; repository: MemeRepository; share: SharePort }
/** 一次保存尝试（含其重试）的身份与意图，确认成功或离开编辑前持有同一份 */
interface PendingSave { target: SaveTarget; meme: VoiceMeme }

export function useStudio(deps: StudioDependencies) {
  const stage = ref<StudioStage>('record'); const error = ref(''); const notice = ref(''); const level = ref(0);
  const draft = reactive<{ id?: string; originId?: string; title: string; audio?: Blob; duration: number; cropStart: number; cropEnd: number }>({ title: '我的声音表情', duration: 0, cropStart: 0, cropEnd: 0 });
  const emotion = ref<EmotionResult>(); const features = ref<AudioFeatures>(); const cover = ref<CoverConfig>(coverPresetFor('元气满满')); const collection = ref<VoiceMeme[]>([]);
  /** 保存生命周期：idle → saving → 已确认完成；失败按事实分裂为 unknown / stale */
  const saving = ref(false);
  /** 写入结果不明：save 被拒绝，可能已落库，只能点读核对或按同一身份幂等重试 */
  const uncertainPending = ref<PendingSave>();
  /** 已写入但作品集刷新失败：禁止重写，只允许刷新列表 */
  const staleAfterWrite = ref<PendingSave>();

  async function startRecording() { error.value = ''; try { await deps.recorder.start((value) => { level.value = value; }); notice.value = '正在录音，最长 10 秒'; } catch { error.value = '无法使用麦克风权限，请在浏览器设置中允许访问或导入音频。'; } }
  async function stopRecording() { try { draft.audio = await deps.recorder.stop(); const info = await deps.cropper.inspect(draft.audio); draft.duration = info.duration; draft.cropStart = 0; draft.cropEnd = Math.min(10, info.duration); stage.value = 'crop'; notice.value = info.needsCrop ? '音频超过 10 秒，请选择保留片段' : '录音完成，可以试听并分析'; } catch (cause) { error.value = cause instanceof Error ? cause.message : '录音结束失败'; } }
  async function importAudio(blob: Blob) { draft.audio = blob; const info = await deps.cropper.inspect(blob); draft.duration = info.duration; draft.cropStart = 0; draft.cropEnd = Math.min(10, info.duration); stage.value = 'crop'; }
  async function analyze() { if (!draft.audio) { error.value = '请先录制或导入一段声音'; return; } const cropped = await deps.cropper.crop(draft.audio, { start: draft.cropStart, end: draft.cropEnd }); draft.audio = cropped.blob; draft.duration = cropped.duration; const result = await deps.analyzer.analyze(cropped.blob); features.value = result.features; emotion.value = classifyEmotion(result.features); cover.value = coverPresetFor(emotion.value.label); stage.value = 'emotion'; }
  function selectEmotion(label: EmotionLabel) { const current = emotion.value ?? classifyEmotion({ loudness:0,dynamics:0,pitch:0,zeroCrossing:0,pauseRatio:1,tempoVariation:0 }); emotion.value = { ...current, label, explanation: `已手动选择「${label}」标签。` }; cover.value = { ...coverPresetFor(label), title: cover.value.title || label }; }
  function goCover() { stage.value = 'cover'; }

  /**
   * 保存作品。身份在首次写入前确定并缓存到 pending：
   * 同次保存的重试复用 pending 中的 id（IndexedDB put 幂等，不会产生重复副本）；
   * 确认成功清空 pending 后再次以 copy 调用才铸造新身份（用户另建一份）。
   */
  async function save(target: SaveTarget = 'copy') {
    if (saving.value) return;
    error.value = ''; notice.value = '';
    // 结果不明时的“重试”：沿用已确定的身份；用户改点另一按钮则按对应意图处理
    const pending = uncertainPending.value;
    let meme: VoiceMeme;
    if (pending && pending.target === target) {
      meme = pending.meme;
    } else {
      if (!draft.audio || !emotion.value || !features.value) { error.value = '作品信息尚未完整，请先完成声音分析'; return; }
      let coverBlob: Blob;
      try { coverBlob = await deps.renderer.render(cover.value); } catch { error.value = '封面生成失败，编辑内容仍保留，可重试保存。'; return; }
      const source = target === 'update' && draft.originId ? collection.value.find((item) => item.id === draft.originId) : undefined;
      if (target === 'update' && draft.originId && !source) { error.value = '找不到原作，无法更新；可先刷新作品集核对，或选择另存副本。'; return; }
      const content: MemeContent = { title: draft.title.trim() || '未命名声音', emotion: emotion.value.label, confidence: emotion.value.confidence, features: features.value, audio: draft.audio, duration: draft.duration, cover: coverBlob, coverConfig: { ...cover.value } };
      meme = resolveSave(content, target, source);
    }
    uncertainPending.value = { target, meme };
    saving.value = true;
    try {
      await deps.repository.save(meme);
    } catch {
      // 写入被拒绝不代表一定没落库：不宣布成功，交给点读核对；编辑内容与身份都保留
      saving.value = false;
      error.value = '保存结果不明（可能已经写入）。请点“核对结果”确认真实状态，或重试保存；编辑内容仍保留。';
      return;
    }
    try {
      await loadCollection();
    } catch {
      // 写入已成功，仅回显失败：禁止重写，避免重复副本/重复覆盖
      saving.value = false;
      staleAfterWrite.value = { target, meme };
      uncertainPending.value = undefined;
      notice.value = '作品已保存，但作品集刷新失败。列表是旧内容，点“刷新作品集”即可核对，请勿重复保存。';
      return;
    }
    completePending(target, meme);
  }

  function completePending(target: SaveTarget, meme: VoiceMeme) {
    saving.value = false; uncertainPending.value = undefined; staleAfterWrite.value = undefined;
    if (target === 'copy') {
      // 副本独立：下一次“另存副本”针对已保存的这一份再铸新身份
      draft.originId = meme.id;
    }
    draft.id = meme.id;
    stage.value = 'collection';
    notice.value = target === 'update' ? '原作已更新，创建时间保持不变。' : '已另存为独立副本，可单独修改或删除。';
  }

  /** 写入结果不明时的点读核对：只查真实结果，绝不重写 */
  async function verifyPendingSave() {
    const pending = uncertainPending.value ?? staleAfterWrite.value;
    if (!pending || saving.value) return;
    error.value = ''; notice.value = ''; saving.value = true;
    let saved: VoiceMeme | undefined;
    try {
      saved = await deps.repository.get(pending.meme.id);
    } catch {
      saving.value = false;
      error.value = '仍无法核对保存结果，编辑内容已保留。可再次核对或重试保存（重试按同一身份写入，不会产生重复副本）。';
      return;
    }
    if (!isConfirmed(saved, pending.meme)) {
      saving.value = false;
      error.value = '核对完成：本次内容尚未写入，可以重试保存。';
      return;
    }
    try {
      await loadCollection();
    } catch {
      saving.value = false;
      staleAfterWrite.value = pending; uncertainPending.value = undefined;
      notice.value = '已确认作品保存成功，但作品集刷新失败，列表暂为旧内容，可稍后刷新。';
      return;
    }
    completePending(pending.target, pending.meme);
  }

  async function refreshCollection() {
    if (saving.value) return;
    error.value = ''; notice.value = ''; saving.value = true;
    try {
      await loadCollection();
      if (staleAfterWrite.value) { const pending = staleAfterWrite.value; completePending(pending.target, pending.meme); return; }
      saving.value = false; notice.value = '作品集已刷新。';
    } catch {
      saving.value = false; error.value = '作品集刷新失败，已保存内容不受影响，可稍后再试。';
    }
  }

  async function loadCollection() { collection.value = sortByRecent(await deps.repository.list()); }
  function editMeme(meme: VoiceMeme) { Object.assign(draft, { id:meme.id, originId:meme.id, title:meme.title, audio:meme.audio, duration:meme.duration, cropStart:0, cropEnd:meme.duration }); features.value = meme.features; emotion.value = { label:meme.emotion,confidence:meme.confidence,explanation:'编辑已保存作品，可更新原作或另存副本',scores:{'暴躁老哥':0,'温柔姐姐':0,'阴阳怪气':0,'元气满满':0} }; cover.value = { ...meme.coverConfig }; uncertainPending.value = undefined; staleAfterWrite.value = undefined; error.value=''; notice.value=''; stage.value = 'cover'; }
  async function deleteMeme(id: string) { await deps.repository.delete(id); await loadCollection(); }
  async function shareMeme(meme: VoiceMeme) { const result = await deps.share.share(meme); notice.value = result === 'shared' ? '已打开系统分享' : '浏览器不支持文件分享，已下载音频和封面'; }
  function newRecording() { draft.id = undefined; draft.originId = undefined; draft.title = '我的声音表情'; draft.audio = undefined; emotion.value = undefined; features.value = undefined; uncertainPending.value = undefined; staleAfterWrite.value = undefined; stage.value = 'record'; error.value = ''; notice.value = ''; }
  return { stage,error,notice,level,draft,emotion,features,cover,collection,saving,uncertainPending,staleAfterWrite,startRecording,stopRecording,importAudio,analyze,selectEmotion,goCover,save,verifyPendingSave,refreshCollection,loadCollection,editMeme,deleteMeme,shareMeme,newRecording };
}
