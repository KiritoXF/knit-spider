<script setup>
import { ref, computed } from 'vue';
import {
  state, save, selectTool, openEditor, getSym, paletteIds, isFav, toggleFav,
} from '../store.js';
import SymbolArt from './SymbolArt.vue';

const q = ref(''); // 符号搜索（名称/id，与分类过滤叠加）

/* 分类定义：与 generate-symbols.mjs 的 cat 字段对应 */
const CATS = [
  { id: 'all',    label: '全部' },
  { id: 'fav',    label: '常用' },
  { id: 'basic',  label: '基础' },
  { id: 'dec',    label: '减针' },
  { id: 'inc',    label: '增针' },
  { id: 'cross',  label: '扭针交叉' },
  { id: 'cable',  label: '交叉针' },
  { id: 'slip',   label: '滑针·引上' },
  { id: 'custom', label: '自定义' },
];
const CAT_LABELS = Object.fromEntries(CATS.map(c => [c.id, c.label]));

/* 分类多选：命中的分类都显示；点"全部"重置；可全部取消（此时面板为空）。
   读写直接挂 store.state（本机 UI 偏好，随 favorites 一起进 localStorage，不进撤销与 JSON 存档） */
const activeCats = computed({
  get: () => state.activeCats,
  set: v => { state.activeCats = v; save(); },
});
function toggleCat(id) {
  if (id === 'all') { activeCats.value = ['all']; return; }
  const next = activeCats.value.filter(c => c !== 'all' && c !== id);
  if (!activeCats.value.includes(id)) next.push(id);
  activeCats.value = next;
}
/* 仅当选中单个具体分类时不需要组标题，其余情况显示 */
const showGroupLabel = computed(() =>
  activeCats.value.includes('all') || activeCats.value.length > 1);

const allItems = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return paletteIds().map(id => {
    const sym = getSym(id);
    return {
      id, sym,
      custom: id.startsWith('custom_'),
      cat: id.startsWith('custom_') ? 'custom' : (sym.cat || 'basic'),
      title: sym.name + (id.startsWith('custom_') ? '（自定义）' : ''),
      iconSize: Math.min(40, Math.max(sym.w, sym.h) * 20),
      hit: !needle || sym.name.toLowerCase().includes(needle) || id.toLowerCase().includes(needle),
    };
  });
});

/* 按激活分类过滤并分组；"常用"组排最前，其余按 CATS 顺序 */
const groups = computed(() => {
  const showAll = activeCats.value.includes('all');
  const on = new Set(activeCats.value);
  const out = [];
  if (on.has('fav')) {
    const items = allItems.value.filter(it => it.hit && isFav(it.id));
    if (items.length) out.push({ id: 'fav', label: '常用', items });
  }
  const byCat = new Map();
  for (const it of allItems.value) {
    if (!it.hit) continue; // 搜索不命中的过滤掉
    if (!showAll && !on.has(it.cat)) continue;
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push(it);
  }
  for (const c of CATS) {
    if (c.id === 'all' || c.id === 'fav') continue;
    if (byCat.has(c.id)) out.push({ id: c.id, label: c.label, items: byCat.get(c.id) });
  }
  return out;
});
</script>

<template>
  <div class="palette-scroll">
    <div class="flex items-center justify-between mb-1">
      <div class="text-xs font-semibold text-gray-600">符号</div>
      <div class="flex items-center gap-1">
        <button id="btnCustom" class="text-[10px] px-1.5 py-0.5 rounded-full border bg-white text-gray-600 border-gray-200 hover:bg-gray-100"
          title="新建自定义符号" @click="openEditor(null)">＋ 自定义</button>
      </div>
    </div>
    <!-- 符号搜索（名称/id，与分类过滤叠加） -->
    <div class="relative mb-1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        class="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-300 pointer-events-none">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
      </svg>
      <input id="palSearch" v-model="q" type="search" placeholder="搜符号：名称 / id，如 麻花"
        class="w-full text-[11px] rounded border border-gray-200 bg-white pl-6 pr-2 py-1 leading-none focus:outline-none focus:border-rose-400"
        @keydown.esc.prevent="q = ''">
    </div>
    <!-- 分类过滤（多选切换） -->
    <div id="catChips" class="flex flex-wrap gap-1 mb-1">
      <button v-for="c in CATS" :key="c.id"
        class="cat-chip text-[10px] px-1.5 py-0.5 rounded-full border"
        :class="activeCats.includes(c.id)
          ? 'chip-on'
          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'"
        :data-cat="c.id"
        @click="toggleCat(c.id)">{{ c.label }}</button>
    </div>

    <!-- 按分类分组渲染符号 -->
    <div id="palette">
      <div v-if="!groups.length" class="text-[10px] text-gray-400 px-0.5 py-2">
        {{ q.trim() ? `没有匹配「${q.trim()}」的符号` : '当前未选中任何分类，点上方分类标签切换显示' }}
      </div>
      <div v-for="g in groups" :key="g.id" class="mb-1.5">
        <div v-if="showGroupLabel" class="text-[10px] text-gray-400 mb-0.5 px-0.5">
          {{ g.label }}
        </div>
        <div class="grid grid-cols-4 gap-1">
          <div v-for="it in g.items" :key="it.id"
            class="palette-btn border rounded bg-white hover:bg-gray-50 flex items-center justify-center p-1 relative cursor-pointer"
            :class="{ selected: state.tool === it.id }"
            :data-tool="it.id" :title="it.title"
            @click="selectTool(it.id)">
            <svg :viewBox="`0 0 ${it.sym.w} ${it.sym.h}`"
              :style="{ width: it.iconSize + 'px', height: it.iconSize + 'px' }">
              <SymbolArt :sym="it.sym"/>
            </svg>
            <span class="sym-fav" :class="{ on: isFav(it.id) }"
              :title="isFav(it.id) ? '从常用移除' : '加入常用'"
              @click.stop="toggleFav(it.id)">{{ isFav(it.id) ? '★' : '☆' }}</span>
          </div>
        </div>
      </div>
    </div>

    <p class="text-[10px] text-gray-400 leading-relaxed mb-3">
      悬停符号点左上角 ☆ 可加入"常用"分类；分类标签可多选切换显示。移除不用的符号、删除自定义符号，请回首页「🧩 符号库」。
    </p>
  </div>
</template>
