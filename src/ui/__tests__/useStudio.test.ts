import { describe, expect, it } from 'vitest';
import { useStudio, type StudioDependencies } from '../useStudio';
import { coverPresetFor } from '../../core/cover-presets';
import type { VoiceMeme } from '../../core/models';

function makeMeme(overrides: Partial<VoiceMeme> = {}): VoiceMeme {
  return {
    id: 'old', title: '旧作品', emotion: '温柔姐姐', confidence: .8,
    features: { loudness: .2, dynamics: .2, pitch: .4, zeroCrossing: .2, pauseRatio: .3, tempoVariation: .2 },
    audio: new Blob(['a']), duration: 1, cover: new Blob(['c']),
    coverConfig: coverPresetFor('温柔姐姐'), createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z', ...overrides,
  };
}
/** 可按用例替换行为的内存仓储 */
function memoryRepository(seed: VoiceMeme[] = [], behavior: {
  save?: (m: VoiceMeme) => void; get?: (id: string) => VoiceMeme | undefined; listFail?: boolean; getFail?: boolean;
} = {}) {
  const data = new Map(seed.map((m) => [m.id, m]));
  return {
    map: data,
    list: async () => { if (behavior.listFail) throw new DOMException('blocked', 'UnknownError'); return [...data.values()]; },
    get: async (id: string) => { if (behavior.getFail) throw new DOMException('blocked', 'UnknownError'); return behavior.get ? behavior.get(id) : data.get(id); },
    save: async (m: VoiceMeme) => { if (behavior.save) behavior.save(m); data.set(m.id, m); },
    rename: async () => {},
    delete: async (id: string) => { data.delete(id); },
  };
}
function dependencies(repository: StudioDependencies['repository']): StudioDependencies {
  return {
    recorder: { isRecording: false, start: async () => {}, stop: async () => new Blob(['voice'], { type: 'audio/webm' }) },
    analyzer: { analyze: async () => ({ duration: 2, features: { loudness: .75, dynamics: .55, pitch: .8, zeroCrossing: .62, pauseRatio: .12, tempoVariation: .6 } }) },
    cropper: { inspect: async () => ({ duration: 2, needsCrop: false }), crop: async (blob: Blob, range: { start: number; end: number }) => ({ blob, duration: range.end - range.start }) },
    renderer: { render: async () => new Blob(['cover'], { type: 'image/png' }) },
    repository,
    share: { share: async () => 'shared' as const },
  };
}
async function prime(studio: ReturnType<typeof useStudio>, meme = makeMeme()) {
  studio.draft.audio = new Blob(['a']); studio.draft.duration = 1;
  studio.cover.value = coverPresetFor('温柔姐姐');
  studio.emotion.value = { label: '温柔姐姐', confidence: .8, explanation: '柔和', scores: { '暴躁老哥': 0, '温柔姐姐': 1, '阴阳怪气': 0, '元气满满': 0 } };
  studio.features.value = { loudness: .2, dynamics: .2, pitch: .4, zeroCrossing: .2, pauseRatio: .3, tempoVariation: .2 };
  studio.stage.value = 'cover';
  return meme;
}

describe('useStudio saving', () => {
  it('turns microphone denial into a recoverable error', async () => {
    const deps: StudioDependencies = {
      ...dependencies(memoryRepository()),
      recorder: { isRecording: false, start: async () => { throw new DOMException('denied', 'NotAllowedError'); }, stop: async () => new Blob() },
    };
    const studio = useStudio(deps);
    await studio.startRecording();
    expect(studio.error.value).toContain('麦克风权限');
    expect(studio.stage.value).toBe('record');
  });

  it('updates the original in place: identity and creation time kept, modification time recorded', async () => {
    const repo = memoryRepository([makeMeme()]);
    const studio = useStudio(dependencies(repo));
    studio.editMeme(makeMeme()); await prime(studio);
    studio.draft.title = '改过的名字';
    await studio.save('update');
    expect(studio.stage.value).toBe('collection');
    expect([...repo.map.keys()]).toEqual(['old']);
    const saved = repo.map.get('old')!;
    expect(saved.title).toBe('改过的名字');
    expect(saved.createdAt).toBe('2026-09-01T08:00:00.000Z');
    expect(saved.updatedAt).not.toBe('2026-09-01T08:00:00.000Z');
  });

  it('saves a copy as an independent record and lets the two diverge', async () => {
    const repo = memoryRepository([makeMeme()]);
    const studio = useStudio(dependencies(repo));
    studio.editMeme(makeMeme()); await prime(studio);
    await studio.save('copy');
    expect(studio.stage.value).toBe('collection');
    expect([...repo.map.keys()]).toHaveLength(2);
    expect(studio.draft.id).not.toBe('old');
    const copy = [...repo.map.values()].find((m) => m.id !== 'old')!;
    expect(copy.createdAt).not.toBe(makeMeme().createdAt);
    // 删除副本不影响原作
    await studio.deleteMeme(copy.id);
    expect([...repo.map.keys()]).toEqual(['old']);
  });

  it('renders failure and write failure both keep the draft and never announce success', async () => {
    const repo = memoryRepository([]);
    const studio = useStudio({ ...dependencies(repo), renderer: { render: async () => { throw new Error('封面导出失败'); } } });
    await prime(studio);
    await studio.save('copy');
    expect(studio.stage.value).toBe('cover');
    expect(studio.error.value).toContain('封面生成失败');
    expect(studio.draft.audio?.size).toBe(1);
    expect(repo.map.size).toBe(0);

    const failing = memoryRepository([], { save: () => { throw new DOMException('full', 'QuotaExceededError'); } });
    const s2 = useStudio(dependencies(failing)); await prime(s2);
    await s2.save('copy');
    expect(s2.error.value).toContain('写入失败');
    expect(s2.stage.value).toBe('cover');
    expect(s2.draft.audio?.size).toBe(1);
    expect(s2.unverified.value).toBeUndefined();
  });

  it('write success with failing echo stays unverified; verify then confirms without rewriting', async () => {
    let saveCount = 0;
    let echoFails = true;
    const data = new Map<string, VoiceMeme>();
    const repository = {
      list: async () => [...data.values()],
      get: async (id: string) => { if (echoFails) throw new DOMException('blocked', 'UnknownError'); return data.get(id); },
      save: async (m: VoiceMeme) => { saveCount += 1; data.set(m.id, m); },
      rename: async () => {}, delete: async (id: string) => { data.delete(id); },
    };
    const studio = useStudio(dependencies(repository)); await prime(studio);
    await studio.save('copy');
    expect(saveCount).toBe(1);
    expect(studio.unverified.value?.id).toBeDefined();
    expect(studio.stage.value).toBe('cover');
    expect(studio.error.value).toContain('尚未确认');
    // 存储恢复（同一份已写入记录），核对后成功，不再写入
    echoFails = false;
    await studio.verifyPendingSave();
    expect(saveCount).toBe(1);
    expect(studio.stage.value).toBe('collection');
    expect(studio.unverified.value).toBeUndefined();
  });

  it('same-session retry after uncertain write reuses the reserved copy id (no duplicate)', async () => {
    // 第一次写入后点读未命中；重新保存仍写同一身份
    const repo = memoryRepository([]);
    const studio = useStudio(dependencies(repo)); await prime(studio);
    // get 先返回 undefined 伪装未命中
    let getWorks = false;
    repo.get = async (id: string) => (getWorks ? repo.map.get(id) : undefined);
    await studio.save('copy');
    expect(studio.unverified.value).toBeDefined();
    const reserved = studio.unverified.value!.id;
    getWorks = true;
    await studio.save('copy');
    expect([...repo.map.keys()]).toEqual([reserved]);
    expect(studio.draft.id).toBe(reserved);
  });

  it('a second explicit save-as after confirmation creates a further distinct copy', async () => {
    const repo = memoryRepository([makeMeme()]);
    const studio = useStudio(dependencies(repo));
    studio.editMeme(makeMeme()); await prime(studio);
    await studio.save('copy');
    const firstCopy = studio.draft.id!;
    // 确认后再另存一份：从当前草稿再次 copy 得到新 id
    await studio.save('copy');
    expect([...repo.map.keys()]).toHaveLength(3);
    expect(studio.draft.id).not.toBe(firstCopy);
    expect(studio.draft.id).not.toBe('old');
  });

  it('same-named works coexist and collection falls back to createdAt for legacy records', async () => {
    const legacy = makeMeme({ id: 'legacy', title: '同名', updatedAt: undefined });
    const recent = makeMeme({ id: 'recent', title: '同名', createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' });
    const repo = memoryRepository([legacy, recent]);
    const studio = useStudio(dependencies(repo));
    await studio.loadCollection();
    expect(studio.collection.value.map((m) => m.id)).toEqual(['recent', 'legacy']);
    expect(studio.collection.value.find((m) => m.id === 'legacy')?.updatedAt).toBeUndefined();
    // 新作同名并存
    studio.editMeme(legacy); await prime(studio);
    studio.draft.title = '同名';
    await studio.save('copy');
    expect([...repo.map.values()].filter((m) => m.title === '同名')).toHaveLength(3);
  });

  it('list refresh failure after a confirmed write marks the list stale but keeps the saved work visible', async () => {
    const repo = memoryRepository([], { listFail: true });
    const studio = useStudio(dependencies(repo)); await prime(studio);
    await studio.save('copy');
    expect(studio.stage.value).toBe('collection');
    expect(studio.listStale.value).toBe(true);
    expect(studio.collection.value).toHaveLength(1);
    expect(studio.error.value).toBe('');
    // 恢复后重试刷新
    repo.list = async () => [...repo.map.values()];
    await studio.retryRefreshList();
    expect(studio.listStale.value).toBe(false);
  });
});
