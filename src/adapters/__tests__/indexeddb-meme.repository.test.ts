import { describe, expect, it } from 'vitest';
import { IndexedDbMemeRepository, type MemeStoreDriver } from '../indexeddb-meme.repository';
import { coverPresetFor } from '../../core/cover-presets';
import type { VoiceMeme } from '../../core/models';
const meme = (): VoiceMeme => ({ id: '1', title: '原名', emotion: '温柔姐姐', confidence: .8, features: { loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2 }, audio: new Blob(['audio']), duration: 1, cover: new Blob(['cover']), coverConfig: coverPresetFor('温柔姐姐'), createdAt: '2026-10-05' });
class MemoryDriver implements MemeStoreDriver { data = new Map<string, VoiceMeme>(); async list(){return [...this.data.values()]} async get(id:string){return this.data.get(id)} async put(value: VoiceMeme){this.data.set(value.id,value)} async delete(id:string){this.data.delete(id)} }

describe('IndexedDbMemeRepository', () => {
  it('round trips blobs, point reads, rename and delete', async () => {
    const repo = new IndexedDbMemeRepository(new MemoryDriver()); await repo.save(meme());
    expect((await repo.list())[0].audio.size).toBe(5);
    expect((await repo.get('1'))?.title).toBe('原名');
    expect(await repo.get('missing')).toBeUndefined();
    await repo.rename('1','新名字');
    const renamed = (await repo.list())[0]; expect(renamed.title).toBe('新名字'); expect(renamed.updatedAt).toBeTruthy();
    await repo.delete('1'); expect(await repo.list()).toEqual([]);
  });
  it('puts by id so retrying the same save never creates a duplicate', async () => {
    const driver = new MemoryDriver(); const repo = new IndexedDbMemeRepository(driver);
    await repo.save(meme()); await repo.save({ ...meme(), title: '改了' }); await repo.save(meme());
    expect(driver.data.size).toBe(1);
  });
  it('keeps same-titled works as separate records', async () => {
    const repo = new IndexedDbMemeRepository(new MemoryDriver());
    await repo.save({ ...meme(), id: 'a' }); await repo.save({ ...meme(), id: 'b' });
    expect((await repo.list()).length).toBe(2);
  });
  it('surfaces storage quota failures', async () => {
    const driver: MemeStoreDriver = { list: async()=>[], get: async()=>undefined, put: async()=>{throw new DOMException('full','QuotaExceededError')}, delete:async()=>{} };
    await expect(new IndexedDbMemeRepository(driver).save(meme())).rejects.toThrow('full');
  });
});
