<script setup>
/* 歌词浮窗（桌面端 Tauri 专属，?widget=1 加载）：桌面歌词式显示当前待织行。
   - 不论空闲/悬停都只显示当前一行；空闲态整窗透明 + 白字深描边，
     悬停展开完整面板（标题栏 + 控制 + 半透明底色），两态切换均 120ms 延迟
   - 织完这行/退回控制、针数百分比、剩余时间估算（knitEta 共享计速）
   - 针名悬停织法教程 popover：交给独立承载窗（lyric-pop）显示，可伸出主浮窗外
   通过 props.win 拿本窗口对象：popover 定位与视口尺寸用它，不能用全局 document */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { state, activeWork, stepDoneRows, contentRev } from '../store.js';
import { chartToTextRows } from '../textChart.js';
import { tutorialUrlForGroup, tutorialTextForGroup } from '../tutorials.js';
import { etaLabel } from '../knitEta.js';
import { pipSetDoneRows } from '../widgetSync.js';
import { showTauriPop, hideTauriPop, onPopHover, onPopLeave } from '../pipLyrics.js';
import { tutRev } from '../tutorialStore.js';

const props = defineProps({ win: { type: Object, required: true } });

const isTauri = !!props.win.__TAURI__;
/* 桌面端进度只写独立小键经 widgetSync 回传主窗口，不走 store 的整树落盘
   （避免浮窗旧快照覆盖主窗口未落盘的编辑） */
const doPrev = () => pipSetDoneRows(state.doneRows - 1);
const doNext = () => pipSetDoneRows(state.doneRows + 1);
function onCloseWin() {
  props.win.__TAURI__.window.getCurrentWindow().close();
}

/* ---- 根元素背景：空闲态全透明（点击穿透由 setIgnoreCursorEvents 处理，
   不再靠透明度补偿），悬停态正常底色 ---- */
const rootStyle = computed(() => ({
  background: idle.value ? 'transparent' : 'var(--acc-surface-2)',
}));

/* ---- 记忆浮窗位置和大小：移动/缩放防抖存 localStorage，开窗时由 pipLyrics 应用 ---- */
const BOUNDS_KEY = 'lp-win-bounds';
let boundsTimer = 0;
let unlistenBounds = [];
if (isTauri) {
  const cur = props.win.__TAURI__.window.getCurrentWindow();
  const saveBounds = async () => {
    try {
      const [pos, size] = await Promise.all([cur.outerPosition(), cur.outerSize()]);
      localStorage.setItem(BOUNDS_KEY,
        JSON.stringify({ x: pos.x, y: pos.y, w: size.width, h: size.height }));
    } catch (e) {}
  };
  const scheduleSave = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 400);
  };
  cur.listen('tauri://moved', scheduleSave);
  cur.listen('tauri://resize', scheduleSave);
  onUnmounted(() => {
    clearTimeout(boundsTimer);
    unlistenBounds.forEach(fn => fn());
  });
}

/* ---- 行数据：与 TextChartModal 相同的防抖重算（contentRev 变化 250ms 合并） ---- */
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
  if (rowsTimer) return; // 已有待重算，合并
  rowsTimer = setTimeout(() => { rowsTimer = 0; rebuildRowsWithLoading(); }, 250);
});
rebuildRowsWithLoading();
onUnmounted(() => clearTimeout(rowsTimer));

const curRow = computed(() => state.doneRows + 1);
const allDone = computed(() => state.doneRows >= state.rows);
const headTitle = computed(() => {
  const w = activeWork();
  const c = w && w.charts.find(x => x.id === state.activeChartId);
  return (w ? w.name : '') + ' · ' + (c ? c.name : '');
});
/* 只显示当前一行（织完全部时显示最后一行 + 庆祝样式）。
   view 依赖 tutRev.n：教程库（IndexedDB）异步载入完成后强制重算，
   否则 mount 早期求值的结果会永久停留在「未配置教程」状态 */
const view = computed(() => {
  void tutRev.n; // 订阅教程库版本：IDB 载入/增删后 view 重算
  const r = allDone.value ? state.rows : curRow.value;
  const row = rows.value[r - 1];
  if (!row) return [];
  return [{
    r: row.r, ws: row.ws, count: row.count,
    groups: (row.groups || []).map(g => ({
      ...g, tut: tutorialUrlForGroup(g), tutText: tutorialTextForGroup(g),
    })),
  }];
});
/* 编织进度（针数口径）：与文字解侧栏同一算法（空白格按背景针计入） */
const stitchStat = computed(() => {
  let total = 0, remain = 0;
  for (const row of rows.value) {
    total += row.count;
    if (row.r > state.doneRows) remain += row.count;
  }
  const pct = total ? Math.round(((total - remain) / total) * 100) : 0;
  return { total, remain, pct };
});

/* ---- 空闲/悬停两态（仿音乐软件桌面歌词）----
   不依赖 DOM hover / 透明像素命中（透明窗口上天生不可靠），改用「全局光标轮询」：
   - 空闲态：setIgnoreCursorEvents(true) 整窗点击穿透 + 背景全透明，只留当前行文字
   - 光标进入窗口范围（cursorPosition 是 OS 级查询，穿透也读得到）→ 关闭穿透 + 展开
   - 光标离开 + 120ms → 收起并恢复穿透。两态切换干脆，不靠运气 */
const idle = ref(true); // 初始即空闲态
const idleMode = computed(() => isTauri && idle.value);
const popActive = ref(false); // 教程承载窗正在显示
const popHovered = ref(false); // 光标在教程承载窗上
/* 空闲态文字颜色：白字（浅背景）或深字（深背景），手动切换存偏好 ——
   桌面歌词软件的做法也是用户手选而非感知桌面背景 */
const IDLE_LIGHT_KEY = 'lp-idle-light';
const idleLight = ref((() => {
  try { return localStorage.getItem(IDLE_LIGHT_KEY) !== 'dark'; } catch (e) { return true; }
})());
function toggleIdleLight() {
  idleLight.value = !idleLight.value;
  try { localStorage.setItem(IDLE_LIGHT_KEY, idleLight.value ? 'light' : 'dark'); } catch (e) {}
}
let idleTimer = 0, pollTimer = 0, pollBusy = false;
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    idle.value = true;
    if (isTauri) {
      try { await props.win.__TAURI__.window.getCurrentWindow().setIgnoreCursorEvents(true); } catch (e) {}
    }
  }, 120);
}
async function pollCursor() {
  if (pollBusy) { pollTimer = setTimeout(pollCursor, 150); return; }
  pollBusy = true;
  try {
    const T = props.win.__TAURI__;
    const cur = T.window.getCurrentWindow();
    const [c, pos, size] = await Promise.all([
      T.window.cursorPosition(), cur.outerPosition(), cur.outerSize(),
    ]);
    const inside = c.x >= pos.x && c.x <= pos.x + size.width &&
                   c.y >= pos.y && c.y <= pos.y + size.height;
    if (inside) {
      clearTimeout(idleTimer);
      if (idle.value) {
        idle.value = false;
        await cur.setIgnoreCursorEvents(false).catch(() => {});
      }
    } else if (!idle.value && !popHovered.value) {
      /* 光标既不在主浮窗也不在教程窗上：收 popover（若还开着）并按节奏回空闲 */
      if (popActive.value) hidePop();
      scheduleIdle();
    }
  } catch (e) { /* 查询失败下一轮重试 */ }
  pollBusy = false;
  pollTimer = setTimeout(pollCursor, 150);
}

/* ---- 织法教程 popover：桌面端交给独立承载窗（lyric-pop）显示 ----
   可伸出主浮窗之外，imgH 上限放宽到 700，内容完整展示不滚动 */
const POP_MAX_IMG = 700;
const POP_GRACE = 120;
let popTimer = 0;
function hidePop() {
  clearTimeout(popTimer);
  popTimer = 0;
  popActive.value = false;
  if (isTauri) hideTauriPop();
}
function hidePopSoon() {
  clearTimeout(popTimer);
  popTimer = setTimeout(hidePop, POP_GRACE);
}
/* 针名换行时取鼠标所在那一行的文字碎片 rect（多行名才不会锚错位置） */
function lineRectAt(x, y) {
  try {
    const d = props.win.document;
    let rg = d.caretRangeFromPoint ? d.caretRangeFromPoint(x, y) : null;
    if (!rg && d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(x, y);
      if (p) { rg = d.createRange(); rg.setStart(p.offsetNode, p.offset); }
    }
    if (!rg) return null;
    let rc = rg.getBoundingClientRect();
    if (rc.width || rc.height) return rc;
    rg.expand && rg.expand('character');
    rc = rg.getBoundingClientRect();
    return (rc.width || rc.height) ? rc : null;
  } catch { return null; }
}
function onNameEnter(ev, g) {
  if (!isTauri || (!g.tut && !g.tutText)) return;
  const el = ev.currentTarget;
  const mx = ev.clientX, my = ev.clientY;
  clearTimeout(popTimer);
  popTimer = setTimeout(async () => {
    const W = Math.min(640, props.win.innerWidth - 24);
    const vh = props.win.innerHeight;
    const r = lineRectAt(mx, my) || el.getBoundingClientRect();
    /* 展开方向按「浮窗在屏幕上的位置」决定，而不是浮窗内部位置：
       浮窗贴着屏幕底部时向下弹会看不见，改向上弹。用显示器工作区算上下剩余空间 */
    let above = r.top > vh / 2;
    let monLeft = null, monRight = null;
    try {
      const T = props.win.__TAURI__;
      const cur = T.window.getCurrentWindow();
      const [pos, sf, mon] = await Promise.all([
        cur.outerPosition(), cur.scaleFactor(), T.window.currentMonitor(),
      ]);
      if (mon) {
        /* 统一换算成 CSS px：锚点屏幕坐标 = 窗口外框位置 + 视口坐标 */
        const nameY = pos.y / sf + (above ? r.top - 6 : r.bottom + 6);
        const mTop = mon.workArea ? mon.workArea.position.y / sf : mon.position.y / sf;
        const mH = (mon.workArea ? mon.workArea.size.height : mon.size.height) / sf;
        const mLeft = mon.workArea ? mon.workArea.position.x / sf : mon.position.x / sf;
        const mW = (mon.workArea ? mon.workArea.size.width : mon.size.width) / sf;
        above = (nameY - mTop) > (mTop + mH - nameY); // 上方剩余空间更大就向上弹
        monLeft = mLeft;
        monRight = mLeft + mW;
      }
    } catch (e) { /* 拿不到显示器信息就退回浮窗内部判断 */ }
    const left = monRight !== null
      ? Math.max(monLeft + 8, Math.min(r.left + r.width / 2 - W / 2, monRight - W - 8))
      : Math.max(12, Math.min(r.left + r.width / 2 - W / 2, props.win.innerWidth - W - 12));
    showTauriPop(
      { name: g.name, sid: g.sid, url: g.tut, text: g.tutText, imgH: POP_MAX_IMG },
      { x: left, y0: above ? r.top - 6 : r.bottom + 6, above, W },
    );
    popActive.value = true;
  }, 300);
}
function onNameLeave() { hidePopSoon(); }

/* 桌面端：教程承载窗的鼠标进出 —— 移入取消隐藏倒计时（看图不被收走）；
   移出后由光标轮询决定收起（去桌面）还是保持（回主浮窗） */
if (isTauri) {
  onPopHover(() => { popHovered.value = true; clearTimeout(popTimer); });
  onPopLeave(() => { popHovered.value = false; });
}
/* ---- 窗口高度自适应内容 ----
   底部大块空白来自窗口高度（创建默认 300px / 上次记忆的 bounds）远大于
   「标题栏 + 一行文字」的实际内容高。挂载后把外窗高度钉到内容高（宽度不动）。
   与 pipLyrics.openPip 的记忆 bounds 恢复存在时序竞态，这里轮询逼近直到
   窗口高 == 内容高（文字解是异步生成的，行 DOM 可能晚几帧出现，靠轮询兜住） */
async function fitHeight() {
  const T = props.win.__TAURI__;
  try {
    const cur = T.window.getCurrentWindow();
    const sf = await cur.scaleFactor();
    const contentH = () => {
      const head = document.querySelector('.lp-head');
      const row = document.querySelector('.lp-row');
      if (!head) return 0;
      // 4 = .lp-lyrics 的上下 padding（2px × 2）
      return Math.ceil(((row ? row.offsetHeight : 22) + 4 + head.offsetHeight) * sf);
    };
    for (let i = 0; i < 30; i++) {
      const ch = contentH();
      if (!ch) { await new Promise(r => setTimeout(r, 100)); continue; }
      const size = await cur.outerSize();
      if (Math.abs(size.height - ch) <= 2) return; // 已贴合（含 pipLyrics 抢先设置后我们再校正）
      await cur.setSize(new T.window.PhysicalSize(size.width, ch));
      await new Promise(r => setTimeout(r, 100));
    }
  } catch (e) { /* 拿不到窗口对象就保持原尺寸 */ }
}
/* fitHeight 只在 mount 时量一次高度，但当前行会随织进行切换：新行文字更长时
   折成 3 行而窗口还钉在 2 行的高度，超出部分被 .lp-lyrics 的 overflow:hidden 裁掉
   （表现为“这行应该有三行文字只显示两行”）。所以 view 变化 / 字体加载完成后都要重贴 */
let fitting = false;
async function refit() {
  if (fitting || !isTauri) return;
  fitting = true;
  try { await fitHeight(); } finally { fitting = false; }
}
watch(view, () => { setTimeout(refit, 300); }); // 略等字号 .12s 过渡结束再量
if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
onMounted(async () => {
  if (!isTauri) return;
  try { await props.win.__TAURI__.window.getCurrentWindow().setIgnoreCursorEvents(true); } catch (e) {}
  pollCursor();
  fitHeight();
});
onUnmounted(() => {
  clearTimeout(popTimer);
  clearTimeout(idleTimer);
  clearTimeout(pollTimer);
  hidePop();
});
</script>

<template>
  <div class="lp-root" :class="{ 'lp-tauri': isTauri, 'lp-idle': idleMode,
    'lp-idle-light': idleLight, 'lp-idle-dark': !idleLight }" :style="rootStyle">
    <!-- 标题栏两态常驻（空闲态 visibility:hidden 隐藏而非移除）：
         布局完全一致，切换时文字位置/间距纹丝不动 -->
    <div class="lp-head" data-tauri-drag-region>
      <span class="lp-dot" data-tauri-drag-region></span>
      <span class="lp-title" data-tauri-drag-region :title="headTitle">{{ headTitle }}</span>
      <button class="lp-btn" :disabled="state.doneRows <= 0" title="退回一行"
        @click="doPrev">◀</button>
      <span class="lp-pct" :title="'按各行针数估算（空白格按背景针计入）：剩 ' + stitchStat.remain
        + ' 针 · 已织 ' + (stitchStat.total - stitchStat.remain) + ' / ' + stitchStat.total
        + (etaLabel ? ' · 照这个节奏' + etaLabel + '织完' : '')">{{ stitchStat.pct }}%</span>
      <button class="lp-btn lp-btn-main" :disabled="allDone" title="把下一行记为已织完"
        @click="doNext">✓</button>
      <button class="lp-btn" title="切换空闲态文字颜色（白字适合浅色桌面，黑字适合深色桌面）"
        @click="toggleIdleLight">{{ idleLight ? '白' : '黑' }}</button>
      <button class="lp-x" title="关闭浮窗" @click="onCloseWin">×</button>
    </div>
    <div class="lp-lyrics">
      <div v-if="genLoading && !idleMode" class="tcm-gen lp-gen"><div class="loading-yarn">🧶</div><span>正在生成文字解…</span></div>
      <template v-else>
        <p v-if="!rows.length && !idleMode" class="lp-empty">该图解还没有内容。</p>
        <div v-for="row in view" :key="row.r" class="lp-row lp-row-cur"
          :class="{ 'lp-row-done': allDone && row.r <= state.doneRows }">
          <span class="lp-rno">
            <span class="lp-rn">{{ row.r }}</span>
            <span v-if="row.ws" class="lp-ws">反</span>
          </span>
          <span class="lp-txt">
            <span v-for="(g, i) in row.groups" :key="i">
              <b>{{ g.n }}</b><span :class="{ 'tc-name-tut': g.tut || g.tutText }"
                @mouseenter="onNameEnter($event, g)" @mouseleave="onNameLeave">{{ g.name }}</span><span
                v-if="i < row.groups.length - 1" class="lp-comma">，</span>
            </span>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
