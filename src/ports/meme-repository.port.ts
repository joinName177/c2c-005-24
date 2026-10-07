import type { VoiceMeme } from '../core/models';
export interface MemeRepository {
  list(): Promise<VoiceMeme[]>;
  /** 点读：写入后用它核对真实结果（read-your-writes），不存在时返回 undefined */
  get(id: string): Promise<VoiceMeme | undefined>;
  save(meme: VoiceMeme): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  delete(id: string): Promise<void>;
}
