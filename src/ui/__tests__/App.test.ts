import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import type { StudioDependencies } from '../useStudio';
import { createMeme, type VoiceMeme } from '../../core/models';
import { coverPresetFor } from '../../core/cover-presets';

function deps(options: { denied?: boolean } = {}): StudioDependencies {
  const works: VoiceMeme[] = [];
  return {
    recorder:{isRecording:false,start:async()=>{if(options.denied)throw new DOMException('denied','NotAllowedError')},stop:async()=>new Blob(['voice'],{type:'audio/webm'})},
    analyzer:{analyze:async()=>({duration:2,features:{loudness:.75,dynamics:.55,pitch:.8,zeroCrossing:.62,pauseRatio:.12,tempoVariation:.6}})},
    cropper:{inspect:async()=>({duration:2,needsCrop:false}),crop:async(blob:Blob,range:{start:number;end:number})=>({blob,duration:range.end-range.start})},
    renderer:{render:async()=>new Blob(['cover'],{type:'image/png'})},
    repository:{list:async()=>works,get:async(id:string)=>works.find(w=>w.id===id),save:async(m:VoiceMeme)=>{const i=works.findIndex(w=>w.id===m.id);if(i>=0)works.splice(i,1,m);else works.push(m)},rename:async()=>{},delete:async(id:string)=>{const i=works.findIndex(w=>w.id===id);if(i>=0)works.splice(i,1)}},
    share:{share:async()=> 'shared'},
  };
}
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe('Voice meme App', () => {
  it('shows the studio stages, time limit and sharing disclosure', () => {
    const wrapper = mount(App,{props:{dependencies:deps()}});
    expect(wrapper.text()).toContain('声音表情包工坊');
    expect(wrapper.text()).toContain('00:10 MAX');
    expect(wrapper.text()).toContain('分享链接不包含原始声音');
  });
  it('shows a recoverable microphone permission error', async () => {
    const wrapper=mount(App,{props:{dependencies:deps({denied:true})}}); await wrapper.get('[data-testid="record"]').trigger('click'); await flush();
    expect(wrapper.text()).toContain('麦克风权限');
  });
  it('creates, labels, edits and saves a work to the gallery', async () => {
    const wrapper=mount(App,{props:{dependencies:deps()}}); await wrapper.get('[data-testid="record"]').trigger('click'); await wrapper.get('[data-testid="stop"]').trigger('click'); await flush();
    await wrapper.get('[data-testid="analyze"]').trigger('click'); await flush(); await wrapper.get('[data-emotion="温柔姐姐"]').trigger('click'); expect(wrapper.text()).toContain('已手动选择');
    await wrapper.get('[data-testid="to-cover"]').trigger('click'); await wrapper.get('[aria-label="气泡文字"]').setValue('轻轻说一句'); await wrapper.get('[data-testid="save-work"]').trigger('click'); await flush(); await flush();
    expect(wrapper.text()).toContain('作品集'); expect(wrapper.text()).toContain('我的声音表情');
  });
  it('updates the original without changing its creation time, then saves an independent copy', async () => {
    const d = deps();
    const original: VoiceMeme = createMeme('meme-fixed', {
      title: '原稿', emotion: '温柔姐姐', confidence: .8,
      features: { loudness: .2, dynamics: .2, pitch: .4, zeroCrossing: .2, pauseRatio: .3, tempoVariation: .2 },
      audio: new Blob(['a']), duration: 1, cover: new Blob(['c']), coverConfig: coverPresetFor('温柔姐姐'),
    }, '2026-09-01T08:00:00.000Z');
    await d.repository.save(original);
    const wrapper = mount(App, { props: { dependencies: d } });
    await flush();
    // 与画廊"编辑"按钮同一入口
    (wrapper.vm as unknown as { studio: { editMeme(m: VoiceMeme): void } }).studio.editMeme(original);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="save-work"]').text()).toContain('更新原作');
    expect(wrapper.get('[data-testid="save-copy"]').text()).toContain('另存副本');
    await wrapper.get('[data-testid="save-work"]').trigger('click');
    await flush(); await flush();
    expect(wrapper.text()).toContain('原作已更新');
    expect((await d.repository.list()).map((w) => w.id)).toEqual(['meme-fixed']);
    expect((await d.repository.get('meme-fixed'))?.createdAt).toBe('2026-09-01T08:00:00.000Z');
    expect((await d.repository.get('meme-fixed'))?.updatedAt).not.toBe('2026-09-01T08:00:00.000Z');
    // 回到该作品，另存副本 -> 两条记录并存
    await wrapper.get('[data-testid="edit-work"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-testid="save-copy"]').trigger('click');
    await flush(); await flush();
    const all = await d.repository.list();
    expect(all).toHaveLength(2);
    expect(all.some((w) => w.id === 'meme-fixed')).toBe(true);
    expect(wrapper.text()).toContain('独立副本');
  });
});
