import type { VoiceMeme } from '../core/models';
export interface MemeRepository { list(): Promise<VoiceMeme[]>; get(id: string): Promise<VoiceMeme | undefined>; save(meme: VoiceMeme): Promise<void>; rename(id: string, title: string): Promise<void>; delete(id: string): Promise<void> }
