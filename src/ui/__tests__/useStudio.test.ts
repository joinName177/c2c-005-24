import { describe, expect, it } from 'vitest';
import { useStudio, type StudioDependencies } from '../useStudio';
import { coverPresetFor } from '../../core/cover-presets';
import type { VoiceMeme } from '../../core/models';

interface RepoOptions { listFail?: boolean; saveFail?: () => boolean; getFail?: boolean }
function dependencies(overrides: Partial<StudioDependencies> = {}, repoOptions: RepoOptions = {}): StudioDependencies & { data: Map<string, VoiceMeme> } {
  const data = new Map<string, VoiceMeme>();
  const repository: StudioDependencies['repository'] = {
    list: async () => { if (repoOptions.listFail) throw new DOMException('network', 'OperationError'); return [...data.values()]; },
    get: async (id: string) => { if (repoOptions.getFail) throw new Error('boom'); return data.get(id); },
    save: async (m) => { if (repoOptions.saveFail?.()) throw new DOMException('full', 'QuotaExceededError'); data.set(m.id, m); },
    rename: async () => {},
    delete: async (id) => { data.delete(id); },
  };
  return {
    data,
    recorder: { isRecording: false, start: async () => {}, stop: async () => new Blob(['voice'], { type: 'audio/webm' }) },
    analyzer: { analyze: async () => ({ duration: 2, features: { loudness:.75,dynamics:.55,pitch:.8,zeroCrossing:.62,pauseRatio:.12,tempoVariation:.6 } }) },
    cropper: { inspect: async () => ({duration:2,needsCrop:false}), crop: async (blob, range) => ({blob,duration:range.end-range.start}) },
    renderer: { render: async () => new Blob(['cover'], { type: 'image/png' }) },
    repository,
    share: { share: async () => 'shared' },
    ...overrides,
  };
}

async function fillDraft(studio: ReturnType<typeof useStudio>) {
  studio.draft.audio = new Blob(['a']); studio.draft.duration = 1; studio.cover.value = coverPresetFor('温柔姐姐');
  studio.emotion.value = { label:'温柔姐姐',confidence:.8,explanation:'柔和',scores:{'暴躁老哥':0,'温柔姐姐':1,'阴阳怪气':0,'元气满满':0} };
  studio.features.value = { loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2 };
}
const existing = (): VoiceMeme => ({ id:'old',title:'旧作品',emotion:'温柔姐姐' as const,confidence:.8,features:{loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2},audio:new Blob(['a']),duration:1,cover:new Blob(['c']),coverConfig:coverPresetFor('温柔姐姐'),createdAt:'2026-10-05T00:00:00.000Z' });

describe('useStudio', () => {
  it('turns microphone denial into a recoverable error', async () => {
    const studio = useStudio(dependencies({ recorder: { isRecording:false, start:async()=>{throw new DOMException('denied','NotAllowedError')}, stop:async()=>new Blob() } }));
    await studio.startRecording();
    expect(studio.error.value).toContain('麦克风权限');
    expect(studio.stage.value).toBe('record');
  });
  it('moves recording through crop and emotion with manual override', async () => {
    const studio = useStudio(dependencies()); await studio.startRecording(); await studio.stopRecording();
    expect(studio.stage.value).toBe('crop'); await studio.analyze(); expect(studio.emotion.value?.label).toBe('元气满满');
    studio.selectEmotion('温柔姐姐'); expect(studio.cover.value.label).toBe('温柔姐姐'); expect(studio.stage.value).toBe('emotion');
  });
  it('keeps the draft when writing fails and can edit an existing work', async () => {
    const studio = useStudio(dependencies({}, { saveFail: () => true }));
    await fillDraft(studio);
    await studio.save(); expect(studio.error.value).toContain('保存结果不明'); expect(studio.draft.audio?.size).toBe(1);
    expect(studio.uncertainPending.value).toBeTruthy();
    studio.editMeme(existing()); expect(studio.draft.title).toBe('旧作品'); expect(studio.stage.value).toBe('cover');
    expect(studio.draft.originId).toBe('old');
  });
  it('updating keeps the original identity and createdAt and stamps updatedAt', async () => {
    const d = dependencies(); d.data.set('old', existing()); const studio = useStudio(d);
    await studio.loadCollection(); studio.editMeme(existing()); studio.draft.title = '改过名';
    await studio.save('update');
    expect(d.data.size).toBe(1);
    const saved = [...d.data.values()][0];
    expect(saved.id).toBe('old');
    expect(saved.createdAt).toBe('2026-10-05T00:00:00.000Z');
    expect(saved.updatedAt).toBeTruthy();
    expect(saved.title).toBe('改过名');
  });
  it('saving a copy creates an independent record while leaving the original intact', async () => {
    const d = dependencies(); d.data.set('old', existing()); const studio = useStudio(d);
    await studio.loadCollection(); studio.editMeme(existing()); studio.draft.title = '副本同名';
    await studio.save('copy');
    expect(d.data.size).toBe(2);
    const copy = [...d.data.values()].find((m) => m.id !== 'old')!;
    expect(copy.createdAt).not.toBe(existing().createdAt);
    expect(d.data.get('old')?.title).toBe('旧作品');
    // 删除副本不影响原作
    await studio.deleteMeme(copy.id);
    expect(d.data.has('old')).toBe(true); expect(d.data.has(copy.id)).toBe(false);
  });
  it('retrying an uncertain save reuses the same identity and never duplicates', async () => {
    let fail = true;
    const d = dependencies({}, { saveFail: () => fail }); const studio = useStudio(d);
    await fillDraft(studio);
    await studio.save('copy');
    const pendingId = studio.uncertainPending.value!.meme.id;
    fail = false;
    await studio.save('copy');
    expect(d.data.size).toBe(1);
    expect(d.data.has(pendingId)).toBe(true);
  });
  it('verifies an actually-written record when only the collection refresh failed', async () => {
    const d = dependencies({}, { listFail: true }); const studio = useStudio(d);
    await fillDraft(studio);
    await studio.save('copy');
    expect(studio.staleAfterWrite.value).toBeTruthy();
    expect(studio.stage.value).not.toBe('collection');
    expect(d.data.size).toBe(1); // 已写入
    // 核对时 list 仍失败：保持 stale，不重写
    await studio.verifyPendingSave();
    expect(d.data.size).toBe(1);
    expect(studio.notice.value).toContain('已确认');
  });
  it('point-read verification after an ambiguous reject detects the real write', async () => {
    let fail = true;
    const d = dependencies({}, { saveFail: () => fail }); const studio = useStudio(d);
    await fillDraft(studio);
    await studio.save('copy');
    expect(d.data.size).toBe(0);
    // 核对确认确实没写进去
    await studio.verifyPendingSave();
    expect(studio.error.value).toContain('尚未写入');
    // 模拟“拒绝但实际已落库”：手动放入与 pending 完全一致的记录
    const candidate = studio.uncertainPending.value!.meme;
    d.data.set(candidate.id, candidate);
    fail = false;
    await studio.verifyPendingSave();
    expect(studio.stage.value).toBe('collection');
    expect(d.data.size).toBe(1);
  });
  it('a second copy after the first one lands is a genuinely new work', async () => {
    const d = dependencies(); d.data.set('old', existing()); const studio = useStudio(d);
    await studio.loadCollection(); studio.editMeme(existing());
    await studio.save('copy');
    const firstId = [...d.data.keys()].find((id) => id !== 'old');
    // 已确认完成后再次另存：从已保存副本再铸一个新身份
    studio.stage.value = 'cover';
    await studio.save('copy');
    expect(d.data.size).toBe(3);
    const ids = [...d.data.keys()];
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain('old'); expect(ids).toContain(firstId);
  });
  it('sorts by modified time and never fabricates updatedAt on legacy records', async () => {
    const legacy = existing();
    const newer: VoiceMeme = { ...existing(), id: 'new', title: '新作品', createdAt: '2026-10-06T00:00:00.000Z' };
    const d = dependencies(); d.data.set('new', newer); d.data.set('old', legacy);
    const studio = useStudio(d);
    await studio.loadCollection();
    expect(studio.collection.value.map((m) => m.id)).toEqual(['new', 'old']);
    expect(studio.collection.value.find((m) => m.id === 'old')?.updatedAt).toBeUndefined();
    // 旧记录被编辑后，靠修改时间排到前面
    studio.editMeme(legacy);
    await studio.save('update');
    expect(studio.collection.value[0].id).toBe('old');
  });
});
