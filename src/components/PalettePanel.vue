<script setup>
import { ref, computed } from 'vue';
import {
  state, save, selectTool, openEditor, getSym, paletteIds, hiddenSyms,
  hideSymbol, restoreSymbol, deleteCustom, isFav, toggleFav,
} from '../store.js';
import SymbolArt from './SymbolArt.vue';

const showHidden = ref(false);
const manageMode = ref(false);

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

const allItems = computed(() => paletteIds().map(id => {
  const sym = getSym(id);
  return {
    id, sym,
    custom: id.startsWith('custom_'),
    cat: id.startsWith('custom_') ? 'custom' : (sym.cat || 'basic'),
    title: sym.name + (id.startsWith('custom_') ? '（自定义）' : ''),
    iconSize: Math.min(40, Math.max(sym.w, sym.h) * 20),
  };
}));

/* 按激活分类过滤并分组；"常用"组排最前，其余按 CATS 顺序 */
const groups = computed(() => {
  const showAll = activeCats.value.includes('all');
  const on = new Set(activeCats.value);
  const out = [];
  if (on.has('fav')) {
    const items = allItems.value.filter(it => isFav(it.id));
    if (items.length) out.push({ id: 'fav', label: '常用', items });
  }
  const byCat = new Map();
  for (const it of allItems.value) {
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

const hidden = computed(() => hiddenSyms());

function onRemove(it) {
  if (it.custom) {
    if (!confirm('删除自定义符号“' + it.sym.name + '”？\n图上已放置的也会一并删除。')) return;
    deleteCustom(it.id);
  } else {
    hideSymbol(it.id); // 内置符号仅从面板移除，可恢复
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <div class="text-xs font-semibold text-gray-600">符号</div>
      <div class="flex items-center gap-1">
        <button id="btnCustom" class="text-[10px] px-1.5 py-0.5 rounded-full border bg-white text-gray-600 border-gray-200 hover:bg-gray-100"
          title="新建自定义符号" @click="openEditor(null)">＋ 自定义</button>
        <button id="btnManageSym" class="text-[10px] px-1.5 py-0.5 rounded-full border"
          :class="manageMode
            ? 'bg-amber-500 text-white border-amber-500'
            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'"
          @click="manageMode = !manageMode">
          {{ manageMode ? '退出管理' : '管理' }}
        </button>
        <button v-if="hidden.length"
          class="text-[10px] text-blue-600 hover:underline"
          @click="showHidden = !showHidden">
          {{ showHidden ? '收起恢复区' : `已移除 ${hidden.length} 个 · 恢复` }}
        </button>
      </div>
    </div>
    <!-- 管理模式提示条 -->
    <div v-if="manageMode"
      class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mb-1">
      管理模式：点符号右上角 × 移除。内置符号可恢复，自定义符号为彻底删除。
    </div>
    <!-- 分类过滤（多选切换） -->
    <div id="catChips" class="flex flex-wrap gap-1 mb-1">
      <button v-for="c in CATS" :key="c.id"
        class="cat-chip text-[10px] px-1.5 py-0.5 rounded-full border"
        :class="activeCats.includes(c.id)
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'"
        :data-cat="c.id"
        @click="toggleCat(c.id)">{{ c.label }}</button>
    </div>

    <!-- 按分类分组渲染符号 -->
    <div id="palette">
      <div v-if="!groups.length" class="text-[10px] text-gray-400 px-0.5 py-2">
        当前未选中任何分类，点上方分类标签切换显示
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
            <span v-if="manageMode" class="sym-remove sym-remove-on"
              :title="it.custom ? '删除自定义符号' : '从面板移除（可恢复）'"
              @click.stop="onRemove(it)">×</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 已移除符号恢复区（低代码式可删可恢复） -->
    <div v-if="showHidden && hidden.length" class="mb-2 border border-dashed border-gray-300 rounded p-1">
      <div class="text-[10px] text-gray-400 mb-1 px-0.5">已从面板移除（定义仍保留，图上已放置的不受影响）</div>
      <div class="flex flex-wrap gap-1">
        <div v-for="h in hidden" :key="'hid-' + h.id"
          class="flex items-center gap-1 border rounded bg-gray-50 pl-1 pr-0.5 py-0.5">
          <svg :viewBox="`0 0 ${h.sym.w} ${h.sym.h}`" style="width:20px;height:20px">
            <SymbolArt :sym="h.sym"/>
          </svg>
          <span class="text-[10px] text-gray-500">{{ h.sym.name }}</span>
          <button class="text-[10px] text-blue-600 hover:underline sym-restore" :data-id="h.id"
            @click="restoreSymbol(h.id)">恢复</button>
        </div>
      </div>
    </div>

    <p class="text-[10px] text-gray-400 leading-relaxed mb-3">
      悬停符号点左上角 ☆ 可加入"常用"分类；点"管理"进入管理模式后才能移除符号；分类标签可多选切换显示。
    </p>
  </div>
</template>
