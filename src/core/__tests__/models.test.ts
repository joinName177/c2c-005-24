import { describe, expect, it } from 'vitest';
import { validateCropRange, createMemeId, createMeme, reviseMeme, copyMeme, sortMemes, memeModifiedAt } from '../models';
import { coverPresetFor } from '../cover-presets';
import type { MemeContent, VoiceMeme } from '../models';

describe('validateCropRange', () => {
  it('rejects a negative start', () => expect(validateCropRange({ start: -1, end: 3 }, 5)).toContain('起点'));
  it('rejects reversed endpoints', () => expect(validateCropRange({ start: 4, end: 2 }, 5)).toContain('终点'));
  it('rejects clips longer than ten seconds', () => expect(validateCropRange({ start: 0, end: 11 }, 12)).toContain('10 秒'));
  it('accepts an exact ten-second clip', () => expect(validateCropRange({ start: 0, end: 10 }, 10)).toBeUndefined());
});

const content = (title = '声音'): MemeContent => ({
  title, emotion: '温柔姐姐', confidence: .8,
  features: { loudness: .2, dynamics: .2, pitch: .4, zeroCrossing: .2, pauseRatio: .3, tempoVariation: .2 },
  audio: new Blob(['audio']), duration: 1, cover: new Blob(['cover']), coverConfig: coverPresetFor('温柔姐姐'),
});

describe('meme identity and timestamps', () => {
  it('generates unique ids even within the same millisecond', () => {
    const fixed = () => new Date('2026-10-07T00:00:00.000Z');
    expect(createMemeId(fixed)).not.toBe(createMemeId(fixed));
  });
  it('creates a new meme with matching creation and modification times', () => {
    const meme = createMeme('new-1', content(), '2026-10-07T10:00:00.000Z');
    expect(meme.id).toBe('new-1');
    expect(meme.createdAt).toBe('2026-10-07T10:00:00.000Z');
    expect(meme.updatedAt).toBe('2026-10-07T10:00:00.000Z');
  });
  it('revises in place: identity and creation time are preserved, modification time advances', () => {
    const original = createMeme('orig', content('原作'), '2026-09-01T08:00:00.000Z');
    const revised = reviseMeme(original, { ...content('改了'), duration: 2 }, '2026-10-07T09:30:00.000Z');
    expect(revised.id).toBe('orig');
    expect(revised.createdAt).toBe('2026-09-01T08:00:00.000Z');
    expect(revised.updatedAt).toBe('2026-10-07T09:30:00.000Z');
    expect(revised.title).toBe('改了');
    expect(revised.duration).toBe(2);
  });
  it('saves a copy as a distinct record whose creation time is now', () => {
    const original = createMeme('orig', content('同名'), '2026-09-01T08:00:00.000Z');
    const twin = copyMeme(content('同名'), '2026-10-07T09:30:00.000Z', 'copy-1');
    expect(twin.id).toBe('copy-1');
    expect(twin.id).not.toBe(original.id);
    expect(twin.createdAt).toBe('2026-10-07T09:30:00.000Z');
    expect(twin.updatedAt).toBe('2026-10-07T09:30:00.000Z');
    expect(twin.title).toBe(original.title);
  });
});

describe('sortMemes', () => {
  it('orders by modification time descending', () => {
    const older = createMeme('a', content(), '2026-09-01T00:00:00.000Z');
    const edited = reviseMeme(older, content(), '2026-10-06T00:00:00.000Z');
    const fresh = createMeme('b', content(), '2026-10-05T00:00:00.000Z');
    expect(sortMemes([older, fresh, edited]).map((m) => m.id)).toEqual(['a', 'b', 'a']);
  });
  it('falls back to creation time for legacy records and never fabricates an updatedAt', () => {
    const legacy: VoiceMeme = { ...createMeme('old', content(), '2026-09-01T00:00:00.000Z') };
    delete legacy.updatedAt;
    const recent = createMeme('new', content(), '2026-10-05T00:00:00.000Z');
    expect(memeModifiedAt(legacy)).toBe(legacy.createdAt);
    const sorted = sortMemes([legacy, recent]);
    expect(sorted.map((m) => m.id)).toEqual(['new', 'old']);
    expect(sorted[1].updatedAt).toBeUndefined();
  });
});
