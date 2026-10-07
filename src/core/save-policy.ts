import type { AudioFeatures, CoverConfig, EmotionLabel, VoiceMeme } from './models';

/** 更新原作还是另存副本 */
export type SaveTarget = 'update' | 'copy';

/** 不包含身份与时间戳的作品内容 */
export interface MemeContent {
  title: string;
  emotion: EmotionLabel;
  confidence: number;
  features: AudioFeatures;
  audio: Blob;
  duration: number;
  cover: Blob;
  coverConfig: CoverConfig;
}

/** 生成作品身份：时间戳加随机后缀，同毫秒内连铸也不碰撞 */
export function mintMemeId(now: Date = new Date()): string {
  const random = Math.floor(Math.random() * 0x100000).toString(36);
  return `meme-${now.getTime()}-${random}`;
}

/**
 * 保存前确定目标记录的身份与时间戳。
 * update：沿用原 id 与创建时间，只刷新最近修改时间，不依赖标题区分作品；
 * copy：新身份与新创建时间，与原作从此独立。
 */
export function resolveSave(
  content: MemeContent,
  target: SaveTarget,
  source: Pick<VoiceMeme, 'id' | 'createdAt'> | undefined,
  now: Date = new Date(),
): VoiceMeme {
  const stamped = now.toISOString();
  if (target === 'update' && source) {
    return { id: source.id, ...content, createdAt: source.createdAt, updatedAt: stamped };
  }
  return { id: mintMemeId(now), ...content, createdAt: stamped, updatedAt: stamped };
}

/** 作品集排序键：有修改时间按修改时间，否则回退创建时间，不替旧记录伪造修改 */
export function collectionOrder(meme: VoiceMeme): string {
  return meme.updatedAt ?? meme.createdAt;
}

export function sortByRecent(memes: VoiceMeme[]): VoiceMeme[] {
  return [...memes].sort((a, b) => collectionOrder(b).localeCompare(collectionOrder(a)));
}

/** 点读核对：本次写入是否已真实落库（更新模式比对修改时间戳，副本模式只认 id） */
export function isConfirmed(saved: VoiceMeme | undefined, candidate: VoiceMeme): boolean {
  if (!saved || saved.id !== candidate.id) return false;
  return saved.updatedAt === candidate.updatedAt;
}
