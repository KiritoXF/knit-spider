<script setup>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  state, activeWork, switchChart, addChart, renameChart, deleteChart,
  isChartLocked, toggleChartLocked,
} from '../store.js';
import { withLoading, appConfirm, toast } from '../ui.js';

const renamingId = ref(null);
const renameText = ref('');
const work = computed(() => activeWork());
const curLocked = computed(() => isChartLocked());
function onToggleLock() { toggleChartLocked(); }

/* ---- 页签翻页箭头：页签多到溢出时两侧出现，按「整页签个数」翻页 ----
   注意：箭头只切可见性、始终占位（见 .ctab-arrow.is-hidden），不能 display:none，
   否则箭头出现/消失会改变滚动区宽度，造成「溢出↔不溢出」反复抖动、落点错位。
   位置测量只用 offsetWidth（与滚动状态无关），不用 getBoundingClientRect——
   后者在平滑滚动动画途中会取到中间值。 */
const strip = ref(null);
const canL = ref(false), canR = ref(false);
function updateArrows() {
  const el = strip.value;
  if (!el) { canL.value = canR.value = false; return; }
  canL.value = el.scrollLeft > 1;
  canR.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}
/* 静态测量每个页签的宽度与在滚动内容中的起始位置 */
function tabMetrics(el) {
  const tabs = [...el.querySelectorAll('.ctab')];
  const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
  const xs = [];
  let acc = 0;
  for (const t of tabs) { xs.push(acc); acc += t.offsetWidth + gap; }
  return { xs, w: tabs.map(t => t.offsetWidth), gap, cw: el.clientWidth, total: xs.length ? acc - gap : 0 };
}
/* 分页起点：每页从一个页签左缘开始，页内页签尽量整块显示（放不下就进入下一页） */
function pageStarts(m) {
  const starts = [];
  let i = 0;
  while (i < m.xs.length) {
    starts.push(m.xs[i]);
    let used = 0, j = i;
    while (j < m.xs.length && used + m.w[j] <= m.cw + 1) { used += m.w[j] + m.gap; j++; }
    if (j === i) j = i + 1;            // 单个页签比视口还宽：至少前进一格
    if (j >= m.xs.length) break;       // 已到结尾
    i = j;
  }
  return starts;
}
/* 平滑滚动期间以「目标位置」为基准继续翻页，避免连点时读到动画中间态 */
let intended = null;
function scrollTo(el, left) {
  intended = left;
  el.scrollTo({ left, behavior: 'smooth' });
}
function syncIntended() {
  const el = strip.value;
  if (el && intended != null && Math.abs(el.scrollLeft - intended) < 1) intended = null;
}
function scrollDir(dir) {
  const el = strip.value;
  if (!el) return;
  const m = tabMetrics(el);
  if (!m.xs.length) return;
  const starts = pageStarts(m);
  const cur = intended != null ? intended : el.scrollLeft;
  const endMax = Math.max(0, m.total - m.cw);
  if (dir > 0) {
    const next = starts.find(s => s > cur + 1);
    scrollTo(el, next == null ? endMax : Math.min(next, endMax));
  } else {
    const prev = [...starts].reverse().find(s => s < cur - 1);
    scrollTo(el, prev == null ? 0 : prev);
  }
}
/* 切换图解 / 增删页签后同步箭头状态，并让当前页签滚进可视区 */
watch(() => state.activeChartId, async () => {
  await nextTick();
  updateArrows();
  strip.value?.querySelector('.ctab-on')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
});
watch(() => work.value?.charts.length, async () => {
  await nextTick(); updateArrows();
});
let ro = null;
onMounted(() => {
  updateArrows();
  ro = new ResizeObserver(updateArrows); // 页签宽度变化（重命名等）也会影响溢出
  if (strip.value) ro.observe(strip.value);
  window.addEventListener('resize', updateArrows);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  window.removeEventListener('resize', updateArrows);
});

function startRename(c) {
  renamingId.value = c.id;
  renameText.value = c.name;
  nextTick(() => {
    const el = document.querySelector('.ctab input');
    if (el) { el.focus(); el.select(); }
  });
}
function commitRename() {
  if (!renamingId.value) return;
  renameChart(renamingId.value, renameText.value);
  renamingId.value = null;
}
function cancelRename() { renamingId.value = null; }
function onAdd() { withLoading(() => addChart()); }
function onSwitch(c) {
  if (c.id === state.activeChartId) return; // 当前图解再点不响应（也不闪 loading）
  withLoading(() => switchChart(c.id));
}
async function onDel(c) {
  if (c.locked) { toast(`图解「${c.name}」已锁定，请先解锁再删除。`, 'warn'); return; }
  const ok = await appConfirm({
    title: '删除图解',
    message: `删除图解「${c.name}」？\n该图解内容将不可恢复。`,
    okText: '删除', danger: true,
  });
  if (ok) withLoading(() => deleteChart(c.id));
}
</script>

<template>
  <div v-if="work" class="chart-tabs-wrap">
    <button class="ctab-arrow" :class="{ 'is-hidden': !canL }" title="向左翻页签"
      aria-label="向左翻页签" @click="scrollDir(-1)">‹</button>
    <div ref="strip" class="chart-tabs" role="tablist" aria-label="图解页签"
      @scroll.passive="() => { updateArrows(); syncIntended(); }">
      <div v-for="c in work.charts" :key="c.id" class="ctab" role="tab" tabindex="0"
        :aria-selected="c.id === state.activeChartId"
        :aria-label="c.name + (c.locked ? '（已锁定）' : '')"
        :class="{ 'ctab-on': c.id === state.activeChartId }"
        :title="(c.id === state.activeChartId ? '当前图解（双击或 F2 重命名）' : '切换到「' + c.name + '」（双击或 F2 重命名）') + (c.locked ? ' · 已锁定' : '')"
        @click="onSwitch(c)" @dblclick="startRename(c)"
        @keydown.enter.self.prevent="onSwitch(c)" @keydown.space.self.prevent="onSwitch(c)"
        @keydown.f2.self.prevent="startRename(c)">
        <input v-if="renamingId === c.id" v-model="renameText" spellcheck="false"
          :aria-label="'重命名图解 ' + c.name"
          @blur="commitRename" @keydown.enter="commitRename" @keydown.esc="cancelRename"
          @keydown.stop @click.stop @dblclick.stop>
        <span v-else class="ctab-name">{{ c.name }}</span>
        <span v-if="c.locked" class="ctab-lock" title="已锁定（防止误改）">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
          </svg>
        </span>
        <!-- 锁定的图解不给删除入口，先解锁再删 -->
        <button v-if="work.charts.length > 1 && !c.locked" type="button" class="ctab-x"
          :aria-label="'删除图解「' + c.name + '」'" title="删除此图解"
          @click.stop="onDel(c)">×</button>
      </div>
    </div>
    <button class="ctab-arrow" :class="{ 'is-hidden': !canR }" title="向右翻页签"
      aria-label="向右翻页签" @click="scrollDir(1)">›</button>
    <button class="ctab-add" title="新建图解" aria-label="新建图解" @click="onAdd">＋</button>
    <button class="ctab-lockbtn" :class="{ on: curLocked }" :aria-pressed="curLocked"
      :title="curLocked ? '解锁当前图解（恢复编辑）' : '锁定当前图解（完成后防误改）'"
      @click="onToggleLock">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="11" width="16" height="10" rx="2"/>
        <path v-if="curLocked" d="M8 11V7a4 4 0 0 1 8 0v4"/>
        <path v-else d="M8 11V7a4 4 0 0 1 7.9-1.4"/>
      </svg>
      {{ curLocked ? '已锁定' : '锁定' }}
    </button>
  </div>
</template>
