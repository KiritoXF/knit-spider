/* ---- 用时估算（共享模块）：按 doneRows 的变化节奏粗略估算织完剩余工作量还需多久 ----
   从 TextChartModal 抽出：文字解弹窗与歌词浮窗（画中画）两处都要显示剩余时间，
   计速必须只有一份，否则两个界面各自采样会得出不同速度。
   单位是「针」而不是「行」：每行针数 = 该行被符号占用的格子数（无符号的空行退化为 cols），
   剩余工作量 = 待织各行针数之和；速度 = 针/分钟，剩余针数 ÷ 速度 = 预计还需时间。
   规则（粗略即可）：两次变化间隔 5s~20min 才算有效织行时间——
   间隔 <5s 视为在测试（连点不计入，锚点后移）；间隔 >20min 视为离开去干别的事
   （清空历史重新计速）；一次跳多行（|Δ|>2，直接输入）也不计入速度。
   采样条件：弹窗开 或 浮窗开（ui.textChartOpen / ui.pipOpen），两个都不开时暂停计速 */
import { ref, computed, watch } from 'vue';
import { state } from './store.js';
import { ui } from './ui.js';

export const eta = ref(null); // { mins } 剩余分钟数；null = 数据不足/不显示
let etaAnchor = null;         // { t, done, sts } 计速锚点（done=已织行，sts=已织针数）
let etaSegs = [];             // 有效区间 [{ dt(s), sts }]，只保留最近几个
const ETA_MIN_GAP = 5, ETA_MAX_GAP = 20 * 60, ETA_MAX_JUMP = 2, ETA_WIN = 6;

/* 第 r 行的针数：所有覆盖到该行的符号宽度之和；整行没符号时按 cols 算 */
function rowStitches(r) {
  let n = 0;
  for (const p of state.placements) {
    const row = p.row ?? 0, h = p.h ?? 1;
    if (row <= r && r < row + h) n += (p.w ?? 1);
  }
  return n || state.cols || 1;
}

/* 前 n 行（1..n）针数之和 */
function stitchesUpTo(n) {
  let s = 0;
  for (let r = 1; r <= n; r++) s += rowStitches(r);
  return s;
}

/* 剩余工作量（针）：待织各行 doneRows+1..rows 的针数之和 */
function remainStitches() {
  return stitchesUpTo(state.rows) - stitchesUpTo(state.doneRows);
}

export function etaText(m) {
  if (m < 1) return '不到 1 分钟';
  if (m < 60) return `约 ${Math.round(m)} 分钟`;
  return `约 ${Math.floor(m / 60)} 小时 ${Math.round(m % 60)} 分`;
}

export const etaLabel = computed(() => {
  if (!eta.value) return '';
  const remain = Math.max(0, state.rows - state.doneRows);
  return remain > 0 ? etaText(eta.value.mins) : '';
});

function etaNote() {
  const now = Date.now();
  const done = state.doneRows, sts = stitchesUpTo(done);
  if (etaAnchor) {
    const dt = (now - etaAnchor.t) / 1000;
    const dRows = done - etaAnchor.done, dSts = sts - etaAnchor.sts;
    if (dt < ETA_MIN_GAP) { /* 连点：在测试，不动历史 */ }
    else if (dt > ETA_MAX_GAP) { etaSegs = []; } // 离开太久：重新计速
    else if (Math.abs(dRows) >= 1 && Math.abs(dRows) <= ETA_MAX_JUMP) {
      if (dSts !== 0) {
        etaSegs.push({ dt, sts: Math.abs(dSts) });
        if (etaSegs.length > ETA_WIN) etaSegs.shift();
      }
    }
  }
  etaAnchor = { t: now, done, sts };
  const tSec = etaSegs.reduce((s, x) => s + x.dt, 0);
  const doneSts = etaSegs.reduce((s, x) => s + x.sts, 0);
  eta.value = tSec >= 60 && doneSts > 0
    ? { mins: remainStitches() / (doneSts / (tSec / 60)) }
    : null;
}

const etaActive = () => ui.textChartOpen || ui.pipOpen;
let wasActive = false;
/* 开始采样时重置锚点（打开弹窗/浮窗都从头计速，离开期间不算） */
watch(etaActive, active => {
  if (active && !wasActive) {
    etaAnchor = { t: Date.now(), done: state.doneRows, sts: stitchesUpTo(state.doneRows) };
    etaSegs = []; eta.value = null;
  }
  wasActive = active;
});
/* 步进、直接输入、撤销等对 doneRows 的一切修改都汇到这里采样 */
watch(() => state.doneRows, () => { if (etaActive()) etaNote(); });
