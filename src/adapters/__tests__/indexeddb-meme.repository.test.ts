import { describe, expect, it } from 'vitest';
import { IndexedDbMemeRepository, type MemeStoreDriver } from '../indexeddb-meme.repository';
import { createMeme, type VoiceMeme } from '../../core/models';
import { coverPresetFor } from '../../core/cover-presets';
const meme = (): VoiceMeme => createMeme('1', { title: '原名', emotion: '温柔姐姐', confidence: .8, features: { loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2 }, audio: new Blob(['audio']), duration: 1, cover: new Blob(['cover']), coverConfig: coverPresetFor('温柔姐姐') }, '2026-10-05T00:00:00.000Z');
class MemoryDriver implements MemeStoreDriver { data = new Map<string, VoiceMeme>(); async list(){return [...this.data.values()]} async get(id:string){return this.data.get(id)} async put(value: VoiceMeme){this.data.set(value.id,value)} async delete(id:string){this.data.delete(id)} }

describe('IndexedDbMemeRepository', () => {
  it('round trips blobs, supports point reads, rename and delete', async () => {
    const repo = new IndexedDbMemeRepository(new MemoryDriver()); await repo.save(meme());
    expect((await repo.list())[0].audio.size).toBe(5);
    expect((await repo.get('1'))?.title).toBe('原名');
    expect(await repo.get('missing')).toBeUndefined();
    await repo.rename('1','新名字');
    const renamed = await repo.get('1');
    expect(renamed?.title).toBe('新名字');
    expect(renamed?.updatedAt).toBeDefined();
    expect(renamed?.createdAt).toBe('2026-10-05T00:00:00.000Z');
    await repo.delete('1'); expect(await repo.list()).toEqual([]);
  });
  it('surfaces storage quota failures', async () => {
    const driver: MemeStoreDriver = { list: async()=>[], get:async()=>undefined, put: async()=>{throw new DOMException('full','QuotaExceededError')}, delete:async()=>{} };
    await expect(new IndexedDbMemeRepository(driver).save(meme())).rejects.toThrow('full');
  });
});
