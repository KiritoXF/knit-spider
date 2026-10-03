/* ---------------- 塑形（减针 / 加针）自动绘制引擎 ----------------
   规则模型：每 everyRows 行、每次 sts 针、共 times 次，从 startRow 开始。
   规则只配置一侧（scope），另一侧自动镜像；应用时直接改写当前图解
   state.placements（覆盖已有符号），走 save() 进撤销历史。
   关键约定：
   · 伏针减针：配置侧在第 T 行画伏针，镜像侧在第 T+1 行（行尾伏针在
     翻面后的下一行执行）；两侧伏针列从符号行的下一行起画 noSt（不编织）。
   · 其他减针（右上2并1等）：符号画在内侧一格，被减掉的外侧 sts 列
     从本行起整列 noSt；镜像侧用镜像符号（k2tog↔ssk 等）。
   · 加针：图解向边缘方向扩列（左扩列时全部内容右移），符号画在
     新增列上；符号 w>1 时横向占多格。
   规则列表 shaping.rules 仅会话级（不持久化），规则可叠加、可重复应用。 */
import { reactive, toRaw } from 'vue';
import { state, save, getSym, isChartLocked } from './store.js';
import { toast } from './ui.js';

export const DEC_METHODS = ['bindOff', 'k2tog', 'ssk', 'k2togP', 'sskP',
  'd3c', 'd3l', 'd3r', 'd4l', 'd4r', 'd5c', 'd5l', 'd5r', 'd6l', 'd6r', 'd7l', 'd7r'];
export const INC_METHODS = ['inL', 'inR', 'in3', 'yo', 'yot'];

/* 镜像符号映射：左右两侧自动取对应方向的针法；无对应则两侧同符号 */
const MIRROR = {
  k2tog: 'ssk', ssk: 'k2tog', k2togP: 'sskP', sskP: 'k2togP',
  inL: 'inR', inR: 'inL',
  d3l: 'd3r', d3r: 'd3l', d4l: 'd4r', d4r: 'd4l',
  d5l: 'd5r', d5r: 'd5l', d6l: 'd6r', d6r: 'd6l', d7l: 'd7r', d7r: 'd7l',
};

/* ---------------- 规则列表（会话级） ---------------- */
let ruleSeq = 0;
export const shaping = reactive({ rules: [] });
export function addRule() {
  const last = shaping.rules[shaping.rules.length - 1];
  const every = last ? Math.max(1, Math.round(+last.everyRows) || 2) : 2;
  const startRow = last
    ? Math.min(state.rows, Math.max(1, Math.round(+last.startRow) || 1) + Math.round(+last.times) * every)
    : Math.max(1, state.rows - 5);
  shaping.rules.push({
    id: 'sh_' + Date.now().toString(36) + (ruleSeq++),
    type: last ? last.type : 'dec',
    startRow,
    everyRows: every, sts: last ? Math.max(1, Math.round(+last.sts) || 1) : 1,
    times: 4,
    method: last ? last.method : 'bindOff',
    scope: last ? last.scope : 'both',
  });
}
export function removeRule(id) {
  shaping.rules = shaping.rules.filter(r => r.id !== id);
}
export function ruleCode(r) {
  return `${Math.max(1, Math.round(+r.everyRows) || 1)}-${Math.max(1, Math.round(+r.sts) || 1)}-${Math.max(1, Math.round(+r.times) || 1)}`;
}
export function ruleSummary(r) {
  const side = r.scope === 'both' ? '两侧' : r.scope === 'left' ? '仅左侧' : '仅右侧';
  const sym = getSym(r.method);
  return `第 ${Math.max(1, Math.round(+r.startRow) || 1)} 行起 · ${side} · ${ruleCode(r)} · ${sym ? sym.name : r.method}`;
}

/* ---------------- 应用规则 ----------------
   返回新增的符号数（0 表示没有任何可绘制的格子） */
export function applyRule(rule) {
  if (isChartLocked()) { toast('图解已锁定，先解锁再应用塑形', 'warn'); return 0; }
  const d = getSym(rule.method);
  if (!d) { toast('针法符号不存在，请重新选择', 'warn'); return 0; }
  const T0 = Math.max(1, Math.round(+rule.startRow) || 1);
  const every = Math.max(1, Math.round(+rule.everyRows) || 2);
  const sts = Math.max(1, Math.round(+rule.sts) || 1);
  const times = Math.max(1, Math.round(+rule.times) || 1);
  const add = [];
  if (rule.type === 'inc') applyInc(rule, d, add, T0, every, sts, times);
  else applyDec(rule, d, add, T0, every, sts, times);
  if (!add.length) { toast('没有可绘制的格子（超出图解范围？）', 'warn'); return 0; }
  commit(add);
  save();
  return add.length;
}

/* ---------------- 应用全部规则（幂等重放） ----------------
   规则列表是一份完整的塑形计划：「应用到图解」以第一次应用时的图面为
   基线（baseline），先还原基线、再按顺序重放全部规则——重复点击不会
   叠加。手动改了图面后想以新图面为基准，用 resetBaseline 重取基线。 */
let baseline = null;      // {chartId, cols, placements, borders, annotations, colLabels}
let baselineChart = null; // 基线所属图解：切换图解后旧基线作废
export function resetBaseline() {
  baseline = {
    cols: state.cols,
    placements: toRaw(state.placements).map(p => ({ ...p })),
    borders: toRaw(state.borders).map(b => ({ ...b })),
    annotations: toRaw(state.annotations).map(a => ({ ...a })),
    colLabels: { ...toRaw(state.colLabels) },
  };
  baselineChart = state.activeChartId;
}
export function applyRules() {
  if (!shaping.rules.length) { toast('还没有可应用的规则', 'warn'); return 0; }
  if (isChartLocked()) { toast('图解已锁定，先解锁再应用加减针', 'warn'); return 0; }
  if (!baseline || baselineChart !== state.activeChartId) resetBaseline();
  /* 还原到基线（含加针扩列前的 cols/colLabels）再重放 */
  state.cols = baseline.cols;
  state.placements = baseline.placements.map(p => ({ ...p }));
  state.borders = baseline.borders.map(b => ({ ...b }));
  state.annotations = baseline.annotations.map(a => ({ ...a }));
  state.colLabels = { ...baseline.colLabels };
  let total = 0;
  for (const rule of shaping.rules) {
    const d = getSym(rule.method);
    if (!d) { toast(`规则「${ruleCode(rule)}」的针法符号不存在，已跳过`, 'warn'); continue; }
    const T0 = Math.max(1, Math.round(+rule.startRow) || 1);
    const every = Math.max(1, Math.round(+rule.everyRows) || 2);
    const sts = Math.max(1, Math.round(+rule.sts) || 1);
    const times = Math.max(1, Math.round(+rule.times) || 1);
    const add = [];
    if (rule.type === 'inc') applyInc(rule, d, add, T0, every, sts, times);
    else applyDec(rule, d, add, T0, every, sts, times);
    if (add.length) { commit(add); total += add.length; }
  }
  if (total) save();
  else toast('没有可绘制的格子（超出图解范围？）', 'warn');
  return total;
}

/* 覆盖式提交：与新增格子相交的旧符号一律删掉（主动触发，允许覆盖） */
function commit(add) {
  const K = (c, r) => c * 10000 + r;
  const cover = new Set();
  for (const p of add)
    for (let i = 0; i < p.w; i++)
      for (let j = 0; j < p.h; j++) cover.add(K(p.col + i, p.row + j));
  const keep = [];
  for (const p of state.placements) {
    let clash = false;
    for (let i = 0; i < p.w && !clash; i++)
      for (let j = 0; j < p.h; j++)
        if (cover.has(K(p.col + i, p.row + j))) { clash = true; break; }
    if (!clash) keep.push(p);
  }
  state.placements = keep.concat(add);
}

/* 镜像侧符号：有镜像映射且符号存在则用镜像，否则两侧同符号 */
function mirrorOf(method) {
  const m = MIRROR[method];
  return (m && getSym(m)) ? m : method;
}

/* ---------------- 减针 ----------------
   关键：减针游标接续当前图面的有效边缘——从网格边缘向内跳过已经是
   noSt（不编织）的列，得到本次减针的起始边缘；同一条规则内每次减针
   也会把游标向内推进，而不是每次都从网格最外圈减起。 */
function noStCols() {
  const s = new Set();
  for (const p of state.placements) if (p.sym === 'noSt') s.add(p.col);
  return s;
}
function applyDec(rule, d, add, T0, every, sts, times) {
  const R = state.rows, C = state.cols;
  const bindOff = rule.method === 'bindOff';
  const symR = rule.method;
  const symL = mirrorOf(rule.method);
  const wantR = rule.scope !== 'left';   // 'both' | 'right'
  const wantL = rule.scope !== 'right';  // 'both' | 'left'
  /* 针法符号占用的格（可能 w>1），画 noSt 时跳过，避免同一批内自相冲突 */
  const symCover = new Set();
  const putSym = (sym, col, row) => {
    const sd = getSym(sym);
    if (!sd || row < 1 || row > R || col < 0 || col + sd.w > C) return false;
    for (let i = 0; i < sd.w; i++) for (let j = 0; j < sd.h; j++) symCover.add((col + i) * 10000 + (row + j));
    add.push({ sym, col, row, w: sd.w, h: sd.h });
    return true;
  };
  const putNoStCol = (col, fromRow) => {
    if (col < 0 || col >= C) return;
    for (let r = Math.max(1, fromRow); r <= R; r++) {
      if (symCover.has(col * 10000 + r)) continue;
      add.push({ sym: 'noSt', col, row: r, w: 1, h: 1 });
    }
  };
  /* 游标：有效边缘列（跳过之前规则减掉的 noSt 列） */
  const dead = noStCols();
  let re = C - 1;
  if (wantR) while (re >= 0 && dead.has(re)) re--;
  let le = 0;
  if (wantL) while (le < C && dead.has(le)) le++;
  for (let k = 0; k < times; k++) {
    const T = T0 + k * every;
    if (T > R) break;
    if (wantR) {
      if (bindOff) {
        if (re - sts + 1 < 0) break;
        for (let i = 0; i < sts; i++) {
          putSym('bindOff', re - i, T);
          putNoStCol(re - i, T + 1);
        }
        re -= sts; // 下一次从伏针段内侧继续
      } else {
        if (re - sts < 0) break;
        putSym(symR, re - sts, T);           // 符号在内侧一格
        for (let i = 0; i < sts; i++) putNoStCol(re - i, T); // 被减掉的外侧列
        re -= sts; // 符号列是幸存针目：作为下一次减针的新边缘，届时才变 noSt
      }
    }
    if (wantL) {
      const Tl = bindOff ? T + 1 : T; // 伏针镜像侧滞后 1 行
      if (bindOff) {
        if (le + sts - 1 < C && Tl <= R) {
          for (let i = 0; i < sts; i++) {
            putSym('bindOff', le + i, Tl);
            putNoStCol(le + i, Tl + 1);
          }
          le += sts;
        }
      } else {
        if (le + sts < C) {
          putSym(symL, le + sts, T);
          for (let i = 0; i < sts; i++) putNoStCol(le + i, T);
          le += sts; // 符号列是幸存针目：作为下一次减针的新边缘
        }
      }
    }
  }
}

/* ---------------- 加针 ---------------- */
function applyInc(rule, d, add, T0, every, sts, times) {
  const R = state.rows;
  const wantR = rule.scope !== 'left';
  const wantL = rule.scope !== 'right';
  const addR = wantR ? sts * times : 0;
  const addL = wantL ? sts * times : 0;
  const total = addR + addL;
  if (state.cols + total > 400) { toast('加针超出网格上限（400 列），请减少次数', 'warn'); return; }
  /* 左侧扩列：现有内容整体右移，新列落在最左 */
  if (addL) shiftAll(addL);
  if (total) state.cols += total;
  const symR = rule.method;
  const symL = mirrorOf(rule.method);
  const baseR = state.cols - addR;         // 右侧新增列起点
  const baseL = addL ? 0 : -1;             // 左侧新增列起点（已右移）
  for (let k = 0; k < times; k++) {
    const T = T0 + k * every;
    if (T > R) break;
    if (wantR) {
      let c = baseR + k * sts;
      for (let i = 0; i < sts && c + d.w <= state.cols; i += d.w)
        { add.push({ sym: symR, col: c, row: T, w: d.w, h: d.h }); c += d.w; }
    }
    if (wantL) {
      let c = baseL + k * sts;
      for (let i = 0; i < sts && c + d.w <= state.cols; i += d.w)
        { add.push({ sym: symL, col: c, row: T, w: d.w, h: d.h }); c += d.w; }
    }
  }
}

/* 左扩列：全部图面内容右移 delta 列 */
function shiftAll(delta) {
  for (const p of state.placements) p.col += delta;
  for (const b of state.borders) b.col += delta;
  for (const a of state.annotations) a.col += delta;
  const nl = {};
  for (const k in state.colLabels) nl[+k + delta] = state.colLabels[k];
  state.colLabels = nl;
}
