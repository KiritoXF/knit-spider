<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { state, activeWork, getSym } from '../store.js';
import { ui, dlg } from '../ui.js';
import { chartToTextRows } from '../textChart.js';
import { tutorialUrlForGroup, tutorialUrlForSid } from '../tutorials.js';
import SymbolArt from './SymbolArt.vue';

const copied = ref(false);
let copiedTimer = null;

const close = () => { hidePop(); ui.textChartOpen = false; };

const rows = computed(() => chartToTextRows(state));
const text = computed(() => rows.value.map(x => x.text).join('\n'));
/* 弹窗标题：作品名 · 图解名 */
const headTitle = computed(() => {
  const w = activeWork();
  const c = w && w.charts.find(x => x.id === state.activeChartId);
  return (w ? w.name : '') + ' · ' + (c ? c.name : '');
});
/* 展示用：分组自带 sid（符号 id），附教程图 URL；未配置教程的名称 tut=null，悬停无感 */
const view = computed(() => rows.value.map(x => ({
  r: x.r, ws: x.ws,
  groups: (x.groups || []).map(g => ({ ...g, tut: tutorialUrlForGroup(g) })),
})));
/* 本图解用到的符号速查：扫正文分组的 sid 去重（含背景针），累计使用次数，按次数降序。
   sym 取内置/自定义符号定义用于画缩略图；tut 为教程图 URL（有图才显示虚线下划线） */
const legend = computed(() => {
  const map = new Map();
  for (const row of rows.value) {
    for (const g of row.groups || []) {
      let it = map.get(g.sid);
      if (!it) { it = { sid: g.sid, name: g.name, n: 0, sym: getSym(g.sid), tut: null }; map.set(g.sid, it); }
      it.n += g.n;
    }
  }
  const list = [...map.values()].sort((a, b) => b.n - a.n);
  for (const it of list) it.tut = tutorialUrlForSid(it.sid);
  return list;
});

/* ---- 织法教程 popover：悬停有教程的针法名称约 300ms 后弹出 ----
   fixed 定位（视口坐标），宽 640px 尽量大地显示教程图；下方空间不足时向上翻，
   图框高度按剩余空间与 62vh 收缩；移入弹窗保持显示（200ms 宽限期），点击图片看原图 */
const pop = ref(null); // { name, sid, url, left, top, ax, imgH, above }
let popTimer = null;
const POP_GRACE = 200;
function hidePop() {
  clearTimeout(popTimer);
  popTimer = null;
  pop.value = null;
}
function delayHide() {
  clearTimeout(popTimer);
  popTimer = setTimeout(() => { pop.value = null; }, POP_GRACE);
}
function onPopEnter() { clearTimeout(popTimer); }
function onImgClick() { if (pop.value) window.open(pop.value.url, '_blank'); }
function onNameEnter(ev, g) {
  if (!g.tut) return;
  const el = ev.currentTarget;
  clearTimeout(popTimer);
  popTimer = setTimeout(() => {
    const W = Math.min(640, window.innerWidth - 24);
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    const below = vh - r.bottom;
    let top, imgH, above = false;
    if (below >= 150) { imgH = Math.min(Math.round(vh * 0.62), below - 64); top = r.bottom + 6; }
    else { above = true; imgH = Math.min(Math.round(vh * 0.62), Math.max(120, r.top - 70)); top = Math.max(8, r.top - 6 - imgH - 56); }
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const ax = Math.max(12, Math.min(r.left + r.width / 2 - left - 5, W - 22));
    pop.value = { name: g.name, sid: g.sid, url: g.tut, left, top, ax, imgH, above };
  }, 300);
}
function onNameLeave() { delayHide(); }
/* Esc：应用内对话框优先（dlg.open 让路）→ 先关教程 popover → 再关弹窗 */
const onKey = e => {
  if (e.key !== 'Escape' || !ui.textChartOpen) return;
  if (dlg.open) return;
  if (pop.value) hidePop();
  else close();
};
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => { document.removeEventListener('keydown', onKey); hidePop(); });

function flashCopied() {
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 2000);
}

function onCopy() {
  const done = () => { flashCopied(); };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text.value;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text.value).then(done).catch(fallback);
  } else fallback();
}

function onDownload() {
  const w = activeWork();
  const c = w && w.charts.find(x => x.id === state.activeChartId);
  const name = (w ? w.name : '作品') + '_' + (c ? c.name : '图解') + '.txt';
  const blob = new Blob([text.value], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
</script>

<template>
  <div v-if="ui.textChartOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex" @mousedown.self="close">
    <div class="modal-shell tcm-shell">
      <div class="modal-head">
        <h2 class="modal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
            <path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
          </svg>
          文字解<span class="modal-sub">— {{ headTitle }}</span>
        </h2>
        <span class="tcm-chip">共 {{ state.rows }} 行</span>
        <button id="tcClose" class="modal-x" title="关闭" @click="close">×</button>
      </div>
      <div class="tcm-body">
        <!-- 左栏：符号速查 + 操作 + 读法提示（常驻可见，随时核对） -->
        <aside class="tcm-side">
          <div class="tcm-side-head">
            <h3>本图解用到的符号</h3>
            <span class="tcm-count">{{ legend.length }} 种</span>
          </div>
          <div class="tcm-syms">
            <p v-if="!legend.length" class="tcm-empty">该图解还没有内容。</p>
            <div v-for="it in legend" :key="it.sid" class="tcm-sym">
              <svg v-if="it.sym" class="tcm-sym-ico" :viewBox="`0 0 ${it.sym.w} ${it.sym.h}`">
                <SymbolArt :sym="it.sym"/>
              </svg>
              <span v-else class="tcm-sym-ico-none">{{ it.name.slice(0, 1) }}</span>
              <span class="tcm-sym-name" :class="{ 'tc-name-tut': it.tut }"
                :title="it.tut ? '悬停查看织法教程图' : ''"
                @mouseenter="onNameEnter($event, it)" @mouseleave="onNameLeave">{{ it.name }}</span>
              <span class="tcm-sym-n" title="全图出现次数">×{{ it.n }}</span>
            </div>
          </div>
          <div class="tcm-side-foot">
            <div class="tcm-acts">
              <button id="tcCopy" class="tcm-btn tcm-btn-main" @click="onCopy">复制全文</button>
              <button id="tcDownload" class="tcm-btn" @click="onDownload">下载 txt</button>
              <span v-if="copied" class="tcm-flash">已复制</span>
            </div>
            <p class="tcm-hint">
              正面行从右往左织（按图解原样读）；反面行从左往右织，下针↔上针互换、扭针织成上针的扭针。
            </p>
            <p class="tcm-hint">空白格为背景针：正面织上针、反面织下针。</p>
            <p class="tcm-hint"><b>虚线下划线</b> = 有教程图，悬停针名可看大图。</p>
          </div>
        </aside>
        <!-- 右栏：文字解正文，独立滚动 -->
        <div class="tcm-main">
          <div id="textChartView" class="tcm-doc" @scroll.passive="hidePop">
            <div v-for="row in view" :key="row.r" class="tcm-row" :class="{ 'tcm-row-ws': row.ws }">
              <span class="tcm-rno">r{{ row.r }}</span>
              <span v-if="row.ws" class="tcm-ws-badge">反面</span>
              <span class="tcm-txt">
                <span v-for="(g, i) in row.groups" :key="i">
                  <b>{{ g.n }}</b><span :class="{ 'tc-name-tut': g.tut }"
                    @mouseenter="onNameEnter($event, g)" @mouseleave="onNameLeave">{{ g.name }}</span><span
                    v-if="i < row.groups.length - 1" class="tcm-comma">，</span>
                </span>
              </span>
              <span class="tcm-sum">{{ state.cols }} 针</span>
            </div>
          </div>
        </div>
      </div>
      <!-- 织法教程 popover：fixed 定位，Esc/滚动内容区/移开关闭；移入弹窗保持显示，点图片看原图 -->
      <div v-if="pop" class="tc-pop" :class="{ 'tc-pop-above': pop.above }"
        :style="{ left: pop.left + 'px', top: pop.top + 'px', '--ax': pop.ax + 'px' }"
        @mouseenter="onPopEnter" @mouseleave="delayHide">
        <div class="tc-pop-head">
          <span class="tc-pop-chip">织法教程</span>
          <span class="tc-pop-name">{{ pop.name }}</span>
          <span v-if="pop.sid" class="tc-pop-id">{{ pop.sid }}</span>
        </div>
        <div class="tc-pop-imgbox" :style="{ maxHeight: pop.imgH + 'px' }">
          <img :src="pop.url" alt="" title="点击查看原图" @click="onImgClick">
        </div>
      </div>
    </div>
  </div>
</template>
