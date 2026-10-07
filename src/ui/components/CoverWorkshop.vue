<script setup lang="ts">
import type { CoverConfig } from '../../core/models';
import type { SaveMode } from '../useStudio';
const props = defineProps<{
  config: CoverConfig;
  title: string;
  saving: boolean;
  editing: boolean;
  unverifiedMode?: SaveMode;
}>();
const emit = defineEmits<{ patch: [p: Partial<CoverConfig>]; title: [t: string]; save: [mode: SaveMode]; verify: [] }>();
</script>
<template><section class="cover-layout"><div class="stage-card controls"><span class="kicker">04 / COVER LAB</span><h2>给声音穿件有戏的外套</h2><label>作品名称<input :value="title" @input="emit('title',($event.target as HTMLInputElement).value)"></label><label>气泡文字<textarea aria-label="气泡文字" :value="config.bubbleText" @input="emit('patch',{bubbleText:($event.target as HTMLTextAreaElement).value})"></textarea></label><label>滤镜<select :value="config.filter" @change="emit('patch',{filter:($event.target as HTMLSelectElement).value as CoverConfig['filter']})"><option value="none">原色</option><option value="mono">黑白</option><option value="saturate">高饱和</option><option value="warm">暖调</option><option value="cool">冷调</option></select></label><label>比例<select :value="config.ratio" @change="emit('patch',{ratio:($event.target as HTMLSelectElement).value as CoverConfig['ratio']})"><option value="square">方形 1:1</option><option value="portrait">竖版 3:4</option></select></label>
<div v-if="unverifiedMode" class="save-actions">
  <button data-testid="verify-save" class="acid-button" type="button" @click="emit('verify')">核对保存结果</button>
  <button data-testid="resave" class="ghost-button" type="button" :disabled="saving" @click="emit('save',unverifiedMode)">{{ saving ? '正在保存…' : '重新保存本次内容' }}</button>
</div>
<div v-else class="save-actions">
  <button v-if="editing" data-testid="save-work" class="acid-button" type="button" :disabled="saving" @click="emit('save','update')">{{ saving ? '正在保存…' : '更新原作' }}</button>
  <button :data-testid="editing ? 'save-copy' : 'save-work'" class="ghost-button" type="button" :disabled="saving" @click="emit('save','copy')">{{ saving ? '正在保存…' : editing ? '另存副本' : '保存作品' }}</button>
</div>
<p v-if="editing && !unverifiedMode" class="save-hint">「更新原作」保留原身份与创建时间；「另存副本」生成可独立修改、删除的新作品。</p>
</div><div class="cover-preview" :class="[config.ratio,config.filter]" :style="{'--c1':config.palette[0],'--c2':config.palette[1],'--c3':config.palette[2]}"><span>SOUND REACTION / 005</span><div class="burst"></div><h3>{{ config.title }}</h3><p>{{ config.bubbleText }}</p><i>▶ PLAY IT</i></div></section></template>
