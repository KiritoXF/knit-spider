<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { state, activeWork, getSym, stepDoneRows, setDoneRows, contentRev } from '../store.js';
/* 剩余时间估算抽到 knitEta.js 共享模块：文字解弹窗与歌词浮窗（画中画）共用一份计速 */
import { etaLabel } from '../knitEta.js';
import { pipSupported, togglePip } from '../pipLyrics.js';
import { ui, dlg } from '../ui.js';
import { chartToTextRows } from '../textChart.js';
import { tutorialUrlForGroup, tutorialUrlForSid, tutorialTextForGroup, tutorialTextForSid } from '../tutorials.js';
import SymbolArt from './SymbolArt.vue';
import { tutRev } from '../tutorialStore.js';
import { openExternal } from '../util.js';

const copied = ref(false);
let copiedTimer = null;
/* 歌词浮窗（画中画）：桌面 Chrome/Edge 116+ 才支持；开着时按钮呈激活态，再点关闭。
   浮窗开着与弹窗互不干扰（关弹窗不关浮窗，浮窗里能继续织） */
const pipSup = pipSupported();
const pipOn = computed(() => ui.pipOpen);

const close = () => { hidePop(); ui.textChartOpen = false; };

/* 正文重算必须防抖：这里是常驻挂载组件，若每次图面编辑都同步重算
   chartToTextRows + 重渲整个文字列表（400 行 × 全部分组 DOM），开着文字解
   编辑图解时单格修改会卡数百毫秒～秒级（实测 40k 放置 ~2000ms）。
   策略：弹窗关着完全不重算；开着时 contentRev 变化后 250ms 合并重算；
   重算期间显示「正在生成文字解」过渡（大图解重算 + 全列表渲染可感） */
const rows = ref([]);
const genLoading = ref(false);
let rowsTimer = 0;
function rebuildRows() {
  clearTimeout(rowsTimer);
  rowsTimer = 0;
  rows.value = chartToTextRows(state);
}
async function rebuildRowsWithLoading() {
  genLoading.value = true;
  await nextTick();
  await new Promise(r => setTimeout(r, 30)); // 先让 loading 画出一帧
  rebuildRows();
  genLoading.value = false;
}
watch(() => contentRev.n, () => {
  if (!ui.textChartOpen) return;
  if (rowsTimer) return; // 已有待重算，合并
  rowsTimer = setTimeout(() => { rowsTimer = 0; rebuildRowsWithLoading(); }, 250);
});
onMounted(() => { if (ui.textChartOpen) rebuildRows(); });
onUnmounted(() => clearTimeout(rowsTimer));
const text = computed(() => rows.value.map(x => x.text).join('\n'));
/* 弹窗标题：作品名 · 图解名 */
const headTitle = computed(() => {
  const w = activeWork();
  const c = w && w.charts.find(x => x.id === state.activeChartId);
  return (w ? w.name : '') + ' · ' + (c ? c.name : '');
});
/* 展示用：分组自带 sid（符号 id），附教程图 URL 与文字说明；
   两者皆未配置的名称 tut=null，悬停无感。
   text / tutFlags 供 v-memo 用：单格编辑只变更个别行，行内容没变就跳过
   整行 vnode diff（400 行全文重建是开着文字解编辑卡顿的大头） */
const view = computed(() => {
  void tutRev.n; // 订阅教程库版本：IDB 载入/增删后 view 重算（教程数据非响应式 Map）
  return rows.value.map(x => ({
  r: x.r, ws: x.ws, count: x.count, text: x.text,
  tutFlags: (x.groups || []).map(g => (g.tut ? 'i' : '') + (g.tutText ? 't' : '')).join(','),
  groups: (x.groups || []).map(g => ({
    ...g, tut: tutorialUrlForGroup(g), tutText: tutorialTextForGroup(g),
  })),
  }));
});
/* 本图解用到的符号速查：扫正文分组的 sid 去重（含背景针），累计使用次数，按次数降序。
   sym 取内置/自定义符号定义用于画缩略图；tut 为教程图 URL，tutText 为文字说明
   （有任一即显示虚线下划线） */
const legend = computed(() => {
  void tutRev.n; // 同 view：教程库就绪后符号速查的教程标记也要刷新
  const map = new Map();
  for (const row of rows.value) {
    for (const g of row.groups || []) {
      let it = map.get(g.sid);
      if (!it) { it = { sid: g.sid, name: g.name, n: 0, sym: getSym(g.sid), tut: null, tutText: null }; map.set(g.sid, it); }
      it.n += g.n;
    }
  }
  const list = [...map.values()].sort((a, b) => b.n - a.n);
  for (const it of list) { it.tut = tutorialUrlForSid(it.sid); it.tutText = tutorialTextForSid(it.sid); }
  return list;
});

/* ---- 织进度：doneRows 已织完行数，当前待织行 = doneRows + 1（行号自下而上） ----
   这里只做展示与出口，进度本身存在 store 的 state.doneRows / chart.doneRows；
   正文里只靠行高亮体现进度（已织行淡化 + 当前待织行高亮） */
const curRow = computed(() => state.doneRows + 1);
const allDone = computed(() => state.doneRows >= state.rows);
/* 计数器可直接输入：非法输入还原为当前值，合法值经 setDoneRows 收敛（0..rows） */
function onProgInput(e) {
  const v = Math.round(+e.target.value);
  if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= state.rows &&
      v !== state.doneRows) {
    setDoneRows(v);
  }
  e.target.value = state.doneRows;
}
const docEl = ref(null);
/* 编织进度（针数口径）：各行 count 相加为总针数，未织行（行号 > doneRows）
   的针数为剩余。空白格按背景针（上/下针）计入，与文字解口径一致 */
const stitchStat = computed(() => {
  let total = 0, remain = 0;
  for (const row of rows.value) {
    total += row.count;
    if (row.r > state.doneRows) remain += row.count;
  }
  const pct = total ? Math.round(((total - remain) / total) * 100) : 0;
  return { total, remain, pct };
});
/* 用时估算已抽到 ../knitEta.js（弹窗 + 歌词浮窗共享计速），这里只消费 etaLabel */
/* 打开弹窗时把当前待织行滚到视口偏上的位置，一进来就能接着织 */
watch(() => ui.textChartOpen, async open => {
  if (!open) return;
  await rebuildRowsWithLoading(); // 先出 loading 过渡再重算（大图解打开可感）
  await nextTick();
  const box = docEl.value;
  const cur = box && box.querySelector('.tcm-row-cur');
  if (!box || !cur) return;
  const rb = box.getBoundingClientRect(), rc = cur.getBoundingClientRect();
  box.scrollTop += (rc.top - rb.top) - box.clientHeight * 0.35;
});

/* ---- 织法教程 popover：悬停有教程（图/文字）的针法名称约 300ms 后弹出 ----
   fixed 定位（视口坐标），宽 640px；图下方显示文字说明，无图时是纯文字卡。
   下方空间不足时向上翻；高度按剩余空间与 62vh 收缩（文字块限高滚动）；
   移入弹窗保持显示（200ms 宽限期），点击图片看原图 */
const pop = ref(null); // { name, sid, url, text, left, top|bottom, ax, imgH, above }
let popTimer = null;
const POP_GRACE = 200;
const POP_TXT_H = 118; // 文字块预留高度（max-height 110 + 间距）
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
function onImgClick() { if (pop.value && pop.value.url) openExternal(pop.value.url); }
/* 针名换行时 getBoundingClientRect 是多行碎片的联合外框，箭头会指错；
   改用光标位置取鼠标所在那一行的文字碎片 rect（取不到再退回联合框） */
function lineRectAt(x, y) {
  try {
    let rg = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (!rg && document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { rg = document.createRange(); rg.setStart(p.offsetNode, p.offset); }
    }
    if (!rg) return null;
    let rc = rg.getBoundingClientRect();
    if (rc.width || rc.height) return rc;
    rg.expand && rg.expand('character'); // 光标折叠时扩一个字符
    rc = rg.getBoundingClientRect();
    return (rc.width || rc.height) ? rc : null;
  } catch { return null; }
}
function onNameEnter(ev, g) {
  if (!g.tut && !g.tutText) return;
  const el = ev.currentTarget;
  const mx = ev.clientX, my = ev.clientY;
  clearTimeout(popTimer);
  popTimer = setTimeout(() => {
    const W = Math.min(640, window.innerWidth - 24);
    const vh = window.innerHeight;
    const r = lineRectAt(mx, my) || el.getBoundingClientRect();
    const below = vh - r.bottom;
    const txtH = g.tutText ? POP_TXT_H : 0; // 有文字时高度预算多留一截
    let top = null, bottom = null, imgH, above = false;
    if (below >= 150 + txtH) { // 下方放得下：锚定符号下方 6px，向下展开
      imgH = Math.min(Math.round(vh * 0.62), below - 64 - txtH);
      top = r.bottom + 6;
    } else {
      // 下方不够：向上翻。用 bottom 锚定弹窗底边在符号上方 6px——
      // imgH 只是 maxHeight，实际图往往更矮，若按预算反推 top，
      // 弹窗会悬在离符号很远的位置（曾出现「纵向显示在屏幕上方」）
      above = true;
      imgH = Math.min(Math.round(vh * 0.62), Math.max(120, r.top - 70 - txtH));
      bottom = vh - r.top + 6;
    }
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const ax = Math.max(12, Math.min(r.left + r.width / 2 - left - 5, W - 22));
    pop.value = { name: g.name, sid: g.sid, url: g.tut, text: g.tutText, left, top, bottom, ax, imgH, above };
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
        <button v-if="pipSup" class="tcm-btn tc-pip-btn" :class="{ on: pipOn }"
          :title="pipOn ? '关闭歌词浮窗' : '弹出置顶歌词浮窗：切到别的软件 / 标签页也能看当前行、点织完这行'"
          @click="togglePip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="4" width="20" height="14" rx="2"/><rect x="12" y="11" width="8" height="5" rx="1" fill="currentColor" stroke="none"/>
          </svg>
          {{ pipOn ? '浮窗中' : '浮窗' }}
        </button>
        <span class="tcm-chip">共 {{ state.rows }} 行</span>
        <button id="tcClose" class="modal-x" title="关闭" @click="close">×</button>
      </div>
      <div class="tcm-body">
        <!-- 左栏：符号速查 + 操作 + 读法提示（常驻可见，随时核对） -->
        <aside class="tcm-side">
          <!-- 织进度：进度存在图解上，随存档/导出带走；正文靠行高亮同步显示 -->
          <div class="tcm-prog">
            <span class="tcm-prog-label">织完</span>
            <button id="tcDonePrev" class="tcm-step" :disabled="state.doneRows <= 0"
              title="退回一行" @click="stepDoneRows(-1)">−</button>
            <input id="tcProgNum" class="tcm-prog-input" type="text" inputmode="numeric"
              :value="state.doneRows" :title="allDone
                ? `已织完全部 ${state.rows} 行（可直接输入行数）`
                : `已织完 ${state.doneRows} 行，当前待织第 ${state.doneRows + 1} 行（可直接输入行数）`"
              @focus="$event.target.select()"
              @keydown.enter="$event.target.blur()"
              @change="onProgInput($event)" />
            <span class="tcm-prog-sep">/ {{ state.rows }}</span>
            <button id="tcDoneNext" class="tcm-step" :disabled="allDone"
              title="把下一行记为已织完" @click="stepDoneRows(1)">+</button>
          </div>
          <div class="tcm-prog-st" title="按各行针数估算（空白格按背景针计入）">
            <div class="tcm-prog-bar"><i :style="{ width: stitchStat.pct + '%' }"></i></div>
            <span class="tcm-prog-st-num">剩 <b>{{ stitchStat.remain }}</b> 针 · 已织
              {{ stitchStat.total - stitchStat.remain }} / {{ stitchStat.total }}（{{ stitchStat.pct }}%）</span>
            <span v-if="etaLabel" class="tcm-eta"
              title="按最近的织行节奏粗略估算；连点过快或长时间未动不算在内">照这个节奏{{ etaLabel }}织完</span>
          </div>
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
              <span class="tcm-sym-name" :class="{ 'tc-name-tut': it.tut || it.tutText }"
                :title="it.tut || it.tutText ? '悬停查看织法教程' : ''"
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
              正面行从右往左织（按图解原样读）；反面行从左往右织，符号按「反面织法」换算（默认下针↔上针、扭针互换，可在符号库调整）。
            </p>
            <p class="tcm-hint">空白格为背景针：正面织上针、反面织下针。</p>
            <p class="tcm-hint"><b>虚线下划线</b> = 有织法教程（图片或文字说明），悬停针名即可查看。</p>
          </div>
        </aside>
        <!-- 右栏：文字解正文，独立滚动；大图解重算期间显示生成过渡 -->
        <div class="tcm-main">
          <div v-if="genLoading" id="tcmGen" class="tcm-gen">
            <div class="loading-yarn">🧶</div>
            <span>正在生成文字解…</span>
          </div>
          <div v-else id="textChartView" ref="docEl" class="tcm-doc" @scroll.passive="hidePop">
            <div v-for="row in view" :key="row.r" class="tcm-row"
              v-memo="[row.text, row.tutFlags, row.r <= state.doneRows, row.r === curRow && !allDone]"
              :class="{ 'tcm-row-ws': row.ws, 'tcm-row-done': row.r <= state.doneRows,
                        'tcm-row-cur': row.r === curRow && !allDone }">
              <span class="tcm-rnog">
                <span class="tcm-rno">r{{ row.r }}</span>
                <span v-if="row.ws" class="tcm-ws-badge">反面</span>
              </span>
              <span class="tcm-txt">
                <span v-for="(g, i) in row.groups" :key="i">
                  <b>{{ g.n }}</b><span :class="{ 'tc-name-tut': g.tut || g.tutText }"
                    @mouseenter="onNameEnter($event, g)" @mouseleave="onNameLeave">{{ g.name }}</span><span
                    v-if="i < row.groups.length - 1" class="tcm-comma">，</span>
                </span>
              </span>
              <span class="tcm-sum">{{ row.count }} 针</span>
            </div>
          </div>
        </div>
      </div>
      <!-- 织法教程 popover：fixed 定位，Esc/滚动内容区/移开关闭；移入弹窗保持显示，点图片看原图 -->
      <div v-if="pop" class="tc-pop" :class="{ 'tc-pop-above': pop.above }"
        :style="{ left: pop.left + 'px',
                  top: pop.top !== null ? pop.top + 'px' : 'auto',
                  bottom: pop.bottom !== null ? pop.bottom + 'px' : 'auto',
                  '--ax': pop.ax + 'px' }"
        @mouseenter="onPopEnter" @mouseleave="delayHide">
        <div class="tc-pop-head">
          <span class="tc-pop-chip">织法教程</span>
          <span class="tc-pop-name">{{ pop.name }}</span>
          <span v-if="pop.sid" class="tc-pop-id">{{ pop.sid }}</span>
        </div>
        <div v-if="pop.url" class="tc-pop-imgbox" :style="{ maxHeight: pop.imgH + 'px' }">
          <img :src="pop.url" alt="" title="点击查看原图" @click="onImgClick">
        </div>
        <div v-if="pop.text" class="tc-pop-text">{{ pop.text }}</div>
      </div>
    </div>
  </div>
</template>
