import type { VoiceMeme } from '../core/models';
import type { MemeRepository } from '../ports/meme-repository.port';
export interface MemeStoreDriver { list(): Promise<VoiceMeme[]>; get(id: string): Promise<VoiceMeme | undefined>; put(value: VoiceMeme): Promise<void>; delete(id: string): Promise<void> }
class BrowserDriver implements MemeStoreDriver {
  private async db(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open('c2c-005-voice-memes', 1); request.onupgradeneeded = () => request.result.createObjectStore('memes', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async list(): Promise<VoiceMeme[]> { const db = await this.db(); return new Promise((resolve, reject) => { const request = db.transaction('memes').objectStore('memes').getAll(); request.onsuccess = () => resolve(request.result as VoiceMeme[]); request.onerror = () => reject(request.error); }); }
  async get(id: string): Promise<VoiceMeme | undefined> { const db = await this.db(); return new Promise((resolve, reject) => { const request = db.transaction('memes').objectStore('memes').get(id); request.onsuccess = () => resolve((request.result as VoiceMeme | undefined) ?? undefined); request.onerror = () => reject(request.error); }); }
  async put(value: VoiceMeme): Promise<void> { const db = await this.db(); return new Promise((resolve, reject) => { const tx = db.transaction('memes', 'readwrite'); tx.objectStore('memes').put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  async delete(id: string): Promise<void> { const db = await this.db(); return new Promise((resolve, reject) => { const tx = db.transaction('memes', 'readwrite'); tx.objectStore('memes').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
}
export class IndexedDbMemeRepository implements MemeRepository {
  constructor(private readonly driver: MemeStoreDriver = new BrowserDriver()) {}
  list() { return this.driver.list(); }
  get(id: string) { return this.driver.get(id); }
  save(meme: VoiceMeme) { return this.driver.put(meme); }
  async rename(id: string, title: string) { const meme = await this.driver.get(id); if (meme) await this.driver.put({ ...meme, title, updatedAt: new Date().toISOString() }); }
  delete(id: string) { return this.driver.delete(id); }
}
