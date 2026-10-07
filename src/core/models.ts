export type EmotionLabel = '暴躁老哥' | '温柔姐姐' | '阴阳怪气' | '元气满满';
export type StudioStage = 'record' | 'crop' | 'emotion' | 'cover' | 'collection';
export interface CropRange { start: number; end: number }
export interface AudioFeatures { loudness: number; dynamics: number; pitch: number; zeroCrossing: number; pauseRatio: number; tempoVariation: number }
export interface EmotionResult { label: EmotionLabel; confidence: number; explanation: string; scores: Record<EmotionLabel, number> }
export interface CoverConfig {
  label: EmotionLabel;
  title: string;
  bubbleText: string;
  bubbleX: number;
  bubbleY: number;
  palette: [string, string, string];
  filter: 'none' | 'mono' | 'saturate' | 'warm' | 'cool';
  ratio: 'square' | 'portrait';
}
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
export interface VoiceMeme extends MemeContent {
  id: string;
  createdAt: string;
  /** 最近修改时间；旧记录可能缺失，读取时按 createdAt 回退，绝不回填伪造 */
  updatedAt?: string;
}

let idSequence = 0;
export function createMemeId(now: () => Date = () => new Date()): string {
  const stamp = now().getTime();
  idSequence += 1;
  return `meme-${stamp}-${idSequence.toString(36)}`;
}
/** 新建作品（含另存副本）：创建时间与修改时间同为 now */
export function createMeme(id: string, content: MemeContent, now: string): VoiceMeme {
  return { id, ...content, createdAt: now, updatedAt: now };
}
/** 更新原作：身份与创建时间不变，只换内容并记录最近修改时间 */
export function reviseMeme(current: Pick<VoiceMeme, 'id' | 'createdAt'>, content: MemeContent, now: string): VoiceMeme {
  return { ...content, id: current.id, createdAt: current.createdAt, updatedAt: now };
}
/** 另存副本：以 now 为创建时刻的全新独立作品，源记录不被修改 */
export function copyMeme(content: MemeContent, now: string, newId: string = createMemeId()): VoiceMeme {
  return createMeme(newId, content, now);
}
/** 作品集排序键：缺少 updatedAt 的旧记录回退到 createdAt，不伪造修改时间 */
export function memeModifiedAt(meme: VoiceMeme): string {
  return meme.updatedAt ?? meme.createdAt;
}
export function sortMemes(memes: VoiceMeme[]): VoiceMeme[] {
  return [...memes].sort((a, b) => memeModifiedAt(b).localeCompare(memeModifiedAt(a)));
}

export function validateCropRange(range: CropRange, duration: number): string | undefined {
  if (range.start < 0) return '裁剪起点不能小于 0';
  if (range.end <= range.start) return '裁剪终点必须晚于起点';
  if (range.end > duration) return '裁剪终点超出音频时长';
  if (range.end - range.start > 10) return '裁剪片段不能超过 10 秒';
  return undefined;
}
