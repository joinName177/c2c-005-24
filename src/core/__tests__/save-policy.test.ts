import { describe, expect, it } from 'vitest';
import { isConfirmed, mintMemeId, resolveSave, sortByRecent, type MemeContent } from '../save-policy';
import { coverPresetFor } from '../cover-presets';
import type { VoiceMeme } from '../models';

const now = new Date('2026-10-07T08:00:00.000Z');
const content = (): MemeContent => ({
  title: '同名作品', emotion: '温柔姐姐', confidence: .8,
  features: { loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2 },
  audio: new Blob(['a']), duration: 1, cover: new Blob(['c']), coverConfig: coverPresetFor('温柔姐姐'),
});
const legacy = (): VoiceMeme => ({ id: 'old', ...content(), createdAt: '2026-09-01T00:00:00.000Z' });

describe('resolveSave', () => {
  it('update keeps identity and createdAt and only stamps updatedAt', () => {
    const result = resolveSave(content(), 'update', legacy(), now);
    expect(result.id).toBe('old');
    expect(result.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(result.updatedAt).toBe('2026-10-07T08:00:00.000Z');
  });
  it('copy gets a fresh identity and stamps both times, independent of the source', () => {
    const result = resolveSave(content(), 'copy', legacy(), now);
    expect(result.id).not.toBe('old');
    expect(result.createdAt).toBe('2026-10-07T08:00:00.000Z');
    expect(result.updatedAt).toBe(result.createdAt);
  });
  it('copy without a source also creates a brand new record', () => {
    const result = resolveSave(content(), 'copy', undefined, now);
    expect(result.id).toMatch(/^meme-/);
  });
  it('mints distinct ids within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 20 }, () => mintMemeId(now)));
    expect(ids.size).toBe(20);
  });
  it('allows same-title works to coexist as different records', () => {
    const a = resolveSave(content(), 'copy', undefined, now);
    const b = resolveSave(content(), 'copy', undefined, now);
    expect(a.title).toBe(b.title);
    expect(a.id).not.toBe(b.id);
  });
});

describe('sortByRecent', () => {
  it('orders by updatedAt when present and falls back to createdAt without faking it', () => {
    const oldEdited = { ...legacy(), updatedAt: '2026-10-06T00:00:00.000Z' };
    const freshNoMod: VoiceMeme = { id: 'new', ...content(), createdAt: '2026-10-05T00:00:00.000Z' };
    const ancient: VoiceMeme = { id: 'a1', ...content(), createdAt: '2026-08-01T00:00:00.000Z' };
    expect(sortByRecent([ancient, freshNoMod, oldEdited]).map((m) => m.id)).toEqual(['old', 'new', 'a1']);
    expect(ancient.updatedAt).toBeUndefined();
  });
});

describe('isConfirmed', () => {
  it('only confirms when the stored record carries this exact write timestamp', () => {
    const candidate = resolveSave(content(), 'update', legacy(), now);
    expect(isConfirmed(undefined, candidate)).toBe(false);
    expect(isConfirmed({ ...legacy() }, candidate)).toBe(false);
    expect(isConfirmed({ ...legacy(), updatedAt: '2026-10-07T08:00:00.000Z' }, candidate)).toBe(true);
  });
});
