/* ---- 用时估算（共享模块）：按 doneRows 的变化节奏粗略估算织完剩余行还需多久 ----
   从 TextChartModal 抽出：文字解弹窗与歌词浮窗（画中画）两处都要显示剩余时间，
   计速必须只有一份，否则两个界面各自采样会得出不同速度。
   规则（粗略即可）：两次变化间隔 5s~20min 才算有效织行时间——
   间隔 <5s 视为在测试（连点不计入，锚点后移）；间隔 >20min 视为离开去干别的事
   （清空历史重新计速）；一次跳多行（|Δ|>2，直接输入）也不计入速度。
   速度 = 最近几个有效区间的 行数 ÷ 分钟数（时间加权），剩余行 ÷ 速度 = 预计还需时间
   采样条件：弹窗开 或 浮窗开（ui.textChartOpen / ui.pipOpen），两个都不开时暂停计速 */
import { ref, computed, watch } from 'vue';
import { state } from './store.js';
import { ui } from './ui.js';

export const eta = ref(null); // { mins } 剩余分钟数；null = 数据不足/不显示
let etaAnchor = null;         // { t, done } 计速锚点
let etaSegs = [];             // 有效区间 [{ dt(s), d(rows) }]，只保留最近几个
const ETA_MIN_GAP = 5, ETA_MAX_GAP = 20 * 60, ETA_MAX_JUMP = 2, ETA_WIN = 6;

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
  const done = state.doneRows;
  if (etaAnchor) {
    const dt = (now - etaAnchor.t) / 1000, d = done - etaAnchor.done;
    if (dt < ETA_MIN_GAP) { /* 连点：在测试，不动历史 */ }
    else if (dt > ETA_MAX_GAP) { etaSegs = []; } // 离开太久：重新计速
    else if (Math.abs(d) >= 1 && Math.abs(d) <= ETA_MAX_JUMP) {
      etaSegs.push({ dt, d: Math.abs(d) });
      if (etaSegs.length > ETA_WIN) etaSegs.shift();
    }
  }
  etaAnchor = { t: now, done };
  const tSec = etaSegs.reduce((s, x) => s + x.dt, 0);
  const rows = etaSegs.reduce((s, x) => s + x.d, 0);
  eta.value = tSec >= 60 && rows > 0
    ? { mins: (Math.max(0, state.rows - done)) / (rows / (tSec / 60)) }
    : null;
}

const etaActive = () => ui.textChartOpen || ui.pipOpen;
let wasActive = false;
/* 开始采样时重置锚点（打开弹窗/浮窗都从头计速，离开期间不算） */
watch(etaActive, active => {
  if (active && !wasActive) {
    etaAnchor = { t: Date.now(), done: state.doneRows };
    etaSegs = []; eta.value = null;
  }
  wasActive = active;
});
/* 步进、直接输入、撤销等对 doneRows 的一切修改都汇到这里采样 */
watch(() => state.doneRows, () => { if (etaActive()) etaNote(); });
