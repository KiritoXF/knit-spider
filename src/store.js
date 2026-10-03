import { reactive, toRaw } from 'vue';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { SYMBOLS, PALETTE_ORDER } from './symbols.js';
import { ui, ed, resetEditor, toast } from './ui.js';
import { tutorialU8Entries, tutorialTextEntries, importTutorials, importTutorialTexts } from './tutorialStore.js';
import { chartToCode, codeToChart, hashCustomSym } from './chartCode.js';
import * as textChart from './textChart.js';

export const LS_KEY = 'knitChartProto1';

export const state = reactive({
  /* ---- 作品 / 图解两级结构 ----
     Work  {id, name, charts: [Chart]}
     Chart {id, name, rows, cols, rowStartSide, colLabels,
            placements, borders, annotations, doneRows}
     下面 rows..annotations 这些顶层字段是"当前图解"的编辑投影，
     切换图解/作品时通过 projectActive / syncActiveChart 双向同步 */
  works: [],
  activeWorkId: null,
  activeChartId: null,
  rows: 36, cols: 24,
  placements: [],      // {sym, col, row, w, h}
  borders: [],         // {col, row, w, h}
  annotations: [],     // {col, row, w, h, text} 区域文字标注（如“花样A·12针重复”）
  customSymbols: [],   // {id, name, w, h, shapes:[{type,...color,w}]}
  hiddenSymbols: [],   // 从符号面板移除的内置符号 id（可恢复；已放到图上的不受影响）
  highlight: null,
  doneRows: 0,         // 已织完行数（0..rows），当前待织行 = doneRows + 1
                       // 仅记录织进度：不进撤销指纹，也不刷新「最后更改」
  zoom: 1,
  rowStartSide: 'right',  // 第 1 行行号位置：'right' 右侧（从右往左织）| 'left' 左侧
  colLabels: {},       // {'列索引': '显示文本'}，未设置则不显示
  favorites: [],       // 标记为"常用"的符号 id（仅本机 UI 偏好，不进撤销与 JSON 存档）
  activeCats: ['all'], // 符号面板分类筛选（仅本机 UI 偏好，不进撤销与 JSON 存档）
  theme: 'sage',       // 配色主题 id（见 THEMES；仅本机偏好，不进作品树与 JSON 存档）
  wsMap: {},           // 反面行符号换算的用户覆盖 {正面id: 反面id|''}；'' = 正反面通用。
                       // 与默认规则（textChart.WS_SYM）合并后生效；仅本机偏好，不进作品树与 JSON 存档
  tool: 'knit',        // 'erase' | 'border' | 'select' | 'paste' | 符号 id
});

/* ---------------- 主题（配色） ----------------
   色值一律不写在 JS 里：style.css 用 --acc-* 定义四套调色板，
   在 <html> 上挂 data-theme 即整站换色（组件里的 Tailwind rose-* 类
   经 @theme 重映射到 --acc-*，所以切主题不需要动任何 .vue）。
   这里只负责"当前是哪套"+ 落盘 */
export const THEMES = [
  { id: 'sage', name: '苔绿', desc: '低饱和冷绿 · 默认' },
  { id: 'rose', name: '玫红', desc: '暖纸缝线 · 最初的配色' },
  { id: 'mist', name: '雾霾蓝', desc: '冷静蓝灰，最不挑环境光' },
  { id: 'mauve', name: '灰玫瑰', desc: '暖灰偏藕，比玫红沉' },
];
export function themeName(id) {
  const t = THEMES.find(t => t.id === id);
  return t ? t.name : THEMES[0].name;
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}
export function setTheme(id) {
  if (id === state.theme || !THEMES.some(t => t.id === id)) return;
  state.theme = id;
  applyTheme();
  save();
}
applyTheme(); // 启动即应用（此时是默认值，load() 恢复用户选择后会再应用一次）

/* ---------------- 反面行符号换算（用户覆盖） ----------------
   入口在符号库弹窗（SymbolManagerModal）的「反面织法」模式。
   只存与默认规则（textChart.WS_SYM）不同的覆盖：targetId 为 '' 表示
   该符号改为正反面通用；删除覆盖即回到默认 */
export function setWsMapping(symId, targetId) {
  if (typeof symId !== 'string' || !symId) return;
  if (targetId && typeof targetId !== 'string') return;
  if (targetId === symId) targetId = ''; // 指向自己 = 通用
  if (targetId) state.wsMap[symId] = targetId;
  else if (textChart.WS_SYM[symId]) state.wsMap[symId] = ''; // 默认有映射 → 覆盖为「通用」
  else delete state.wsMap[symId]; // 默认就无映射 → 清掉覆盖即回到默认
  save();
}
/* 清除某符号的覆盖，回到默认规则 */
export function removeWsMapping(symId) {
  if (typeof symId !== 'string') return;
  delete state.wsMap[symId];
  save();
}

/* ---------------- 作品 / 图解管理 ---------------- */
let idSeq = 0;
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + (idSeq++).toString(36) + Math.random().toString(36).slice(2, 5);
}
/* 保 id：存档/导入里的旧 id 有效且未被占用就原样保留——作品/图解 id 需跨会话稳定，
   每次 load 重生成会让依赖 id 的本机数据失联；
   只有缺失/重复时才发新 id。usedIds 惰性播种自现有作品树，批次内自动累积 */
let usedIds = null;
function pickId(old, prefix) {
  if (!usedIds) {
    usedIds = new Set();
    for (const w of state.works) {
      usedIds.add(w.id);
      for (const c of w.charts) usedIds.add(c.id);
    }
  }
  const id = (typeof old === 'string' && old && !usedIds.has(old)) ? old : genId(prefix);
  usedIds.add(id);
  return id;
}
export function activeWork() {
  return state.works.find(w => w.id === state.activeWorkId) || null;
}
export function activeChart() {
  const w = activeWork();
  return w ? (w.charts.find(c => c.id === state.activeChartId) || w.charts[0] || null) : null;
}

/* 当前编辑投影 → 写回作品树里的活动图解（save 前必须调用） */
function syncActiveChart() {
  const c = activeChart();
  if (!c) return;
  c.rows = state.rows; c.cols = state.cols;
  c.rowStartSide = state.rowStartSide;
  c.colLabels = state.colLabels;
  c.placements = state.placements;
  c.borders = state.borders;
  c.annotations = state.annotations;
  c.doneRows = state.doneRows;
}
/* 活动图解 → 装入编辑投影（切换图解/作品后调用） */
function projectActive() {
  const c = activeChart();
  if (!c) return;
  state.rows = c.rows; state.cols = c.cols;
  state.rowStartSide = c.rowStartSide;
  state.colLabels = c.colLabels;
  state.placements = c.placements;
  state.borders = c.borders;
  state.annotations = c.annotations;
  state.highlight = null;
  state.doneRows = Math.min(state.rows, Math.max(0, Math.round(+c.doneRows) || 0));
  if (state.tool !== 'erase' && state.tool !== 'border' && state.tool !== 'select' &&
      state.tool !== 'paste' && !getSym(state.tool)) state.tool = 'knit';
}

function uniqueName(base, taken) {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(base + ' ' + i)) i++;
  return base + ' ' + i;
}
function defaultChartName(w) {
  return uniqueName('图解', w.charts.map(c => c.name));
}
function newChart(name, rows = 36, cols = 24) {
  return {
    id: genId('c'), name: name || '图解',
    rows, cols, rowStartSide: state.rowStartSide === 'left' ? 'left' : 'right',
    colLabels: {}, placements: [], borders: [], annotations: [], locked: false,
    doneRows: 0,
    updatedAt: Date.now(), // 最后更改时间（新建即计），随存档保存
  };
}
/* 兜底：保证至少有一个作品和一个图解，并把投影对准活动图解 */
function ensureSkeleton() {
  if (!state.works.length) {
    const w = { id: genId('w'), name: '我的作品', charts: [] };
    w.charts.push(newChart('图解 1'));
    state.works.push(w);
    state.activeWorkId = w.id;
    state.activeChartId = w.charts[0].id;
  } else if (!activeWork()) {
    state.activeWorkId = state.works[0].id;
  }
  const w = activeWork();
  if (!w.charts.length) w.charts.push(newChart(defaultChartName(w)));
  if (!w.charts.some(c => c.id === state.activeChartId)) state.activeChartId = w.charts[0].id;
  projectActive();
}

export function switchWork(id) {
  const w = state.works.find(x => x.id === id);
  if (!w || id === state.activeWorkId) return;
  syncActiveChart();
  state.activeWorkId = id;
  state.activeChartId = w.charts[0].id;
  projectActive();
  resetHistory(); // 历史按图解隔离
  save();
}
export function switchChart(id) {
  if (id === state.activeChartId) return;
  const w = activeWork();
  if (!w || !w.charts.some(c => c.id === id)) return;
  syncActiveChart();
  state.activeChartId = id;
  projectActive();
  resetHistory();
  save();
}
export function addWork(name) {
  syncActiveChart();
  const w = {
    id: genId('w'),
    name: uniqueName(String(name || '').trim() || '作品', state.works.map(x => x.name)),
    charts: [],
    updatedAt: Date.now(),
  };
  w.charts.push(newChart('图解 1'));
  state.works.push(w);
  state.activeWorkId = w.id;
  state.activeChartId = w.charts[0].id;
  projectActive();
  resetHistory();
  save();
  return w.id;
}
export function renameWork(id, name) {
  const w = state.works.find(x => x.id === id);
  const t = String(name || '').trim();
  if (!w || !t) return false;
  w.name = uniqueName(t, state.works.filter(x => x.id !== id).map(x => x.name));
  save();
  return true;
}
export function deleteWork(id) {
  if (state.works.length <= 1) return false; // 至少保留一个作品
  const w = state.works.find(x => x.id === id);
  if (!w) return false;
  state.works = state.works.filter(x => x.id !== id);
  if (state.activeWorkId === id) {
    // 被删作品的未同步编辑随作品一起丢弃，直接切到第一个作品
    state.activeWorkId = state.works[0].id;
    state.activeChartId = state.works[0].charts[0].id;
    projectActive();
    resetHistory();
  }
  save();
  return true;
}
export function addChart(name) {
  const w = activeWork();
  if (!w) return null;
  syncActiveChart(); // 先把当前编辑面写回旧图解
  const c = newChart(String(name || '').trim() || defaultChartName(w));
  w.charts.push(c);
  state.activeChartId = c.id;
  projectActive();
  resetHistory();
  save();
  return c.id;
}
export function renameChart(id, name) {
  const w = activeWork();
  const c = w && w.charts.find(x => x.id === id);
  const t = String(name || '').trim();
  if (!c || !t) return false;
  c.name = uniqueName(t, w.charts.filter(x => x.id !== id).map(x => x.name));
  save();
  return true;
}
export function deleteChart(id) {
  const w = activeWork();
  if (!w || w.charts.length <= 1) return false; // 最后一个图解不可删
  const i = w.charts.findIndex(c => c.id === id);
  if (i < 0) return false;
  if (w.charts[i].locked) { // 锁定的图解禁止删除，先解锁
    flashInfo(`图解「${w.charts[i].name}」已锁定，请先解锁再删除`);
    return false;
  }
  w.charts.splice(i, 1);
  if (state.activeChartId === id) {
    state.activeChartId = w.charts[Math.max(0, i - 1)].id;
    projectActive();
    resetHistory();
  }
  save();
  return true;
}

/* ---------------- 常用符号收藏 ---------------- */
export function isFav(id) { return state.favorites.includes(id); }
export function toggleFav(id) {
  const i = state.favorites.indexOf(id);
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push(id);
  save(); // favorites 不在撤销指纹里，不会产生历史节点
}

/* 删除选区内所有完整落入的符号与边框，返回删除数量 */
export function deleteSelection() {
  const rect = clipSel.rect;
  if (!rect || guardLocked()) return 0;
  const col0 = Math.min(rect.c0, rect.c1), col1 = Math.max(rect.c0, rect.c1);
  const row0 = Math.min(rect.r0, rect.r1), row1 = Math.max(rect.r0, rect.r1);
  const inside = (c, r, w, h) => c >= col0 && r >= row0 && c + w - 1 <= col1 && r + h - 1 <= row1;
  const pn = state.placements.length, bn = state.borders.length, an = state.annotations.length;
  state.placements = state.placements.filter(p => !inside(p.col, p.row, p.w, p.h));
  state.borders = state.borders.filter(b => !inside(b.col, b.row, b.w, b.h));
  state.annotations = state.annotations.filter(a => !inside(a.col, a.row, a.w, a.h));
  const n = (pn - state.placements.length) + (bn - state.borders.length) + (an - state.annotations.length);
  if (n) { save(); flashInfo(`已删除选区内 ${n} 项内容`); }
  return n;
}

/* ---------------- 撤销 / 重做（会话级，不持久化） ---------------- */
let history = [];      // {fp, snap}：每次图面变更后的内容快照
let hIndex = -1;
/* 快照上限：快照是 JSON 字符串（见 makeSnap），30 份 × ~200KB ≈ 6MB 字符串；
   曾用 100 份对象树深拷贝 ≈ 32 万个对象常驻，真实编辑会话中切回大图解
   触发 8-10 秒主线程长任务（画面已显示但交互冻结，longtask 实测） */
const UNDO_MAX = 30;
/* 快照总字符预算（≈48MB UTF-16）：大图解单份快照可达数 MB，仅靠条数上限
   会内存爆炸；超限从最旧淘汰（undo 可回退步数随之减少，属预期行为） */
const SNAP_CHARS_MAX = 24e6;
let inUndoRedo = false;

/* 图面内容快照：图面、全局库各一次 stringify（不再额外拼一份 fp 字符串，
   大图解下每次编辑少一整份内容的分配）。快照存 JSON 字符串而非对象树：
   字符串对 GC 几乎零压力（无对象图遍历标记），也免去每次保存的
   stringify+parse 双开销；恢复时 parse 出全新对象，从根上杜绝快照与
   state 共享数组引用导致的撤销污染。
   序列化前先 toRaw 剥掉响应式代理：state 是深 reactive，直接 stringify
   会对上万个 placement 逐个触发 Proxy get 陷阱（实测每次 save 53ms→2ms） */
function chartContent() {
  return {
    rows: state.rows, cols: state.cols, rowStartSide: state.rowStartSide,
    colLabels: toRaw(state.colLabels), placements: toRaw(state.placements),
    borders: toRaw(state.borders), annotations: toRaw(state.annotations),
  };
}
function makeSnap() {
  return {
    chartStr: JSON.stringify(chartContent()),
    cs: JSON.stringify([toRaw(state.customSymbols), toRaw(state.hiddenSymbols)]),
  };
}
/* 内容是否相同：直接比字符串（V8 对等长字符串比较接近 memcmp，比先哈希再比更省）
   旧实现额外拼一份 fp 字符串，等于每次编辑多分配一整份图面内容。
   图面与全局库分开比：全局自定义符号库变动要能撤销，但不该刷新图解「最后更改」 */
function sameChart(a, b) { return !!a && a.chartStr === b.chartStr; }
function sameSnap(a, b) { return sameChart(a, b) && a.cs === b.cs; }
export const histState = reactive({ canUndo: false, canRedo: false });
/* 图面内容版本号：图面内容真正变化时自增（编辑走 save 的判定，撤销/重做走
   restoreSnap，换图/导入走 resetHistory）。顶栏校验码这类昂贵的派生物只需读它
   即可注册依赖——不必再为了「感知变化」把整个图解 JSON.stringify 一遍 */
export const contentRev = reactive({ n: 0 });
function syncHistUI() {
  histState.canUndo = hIndex > 0;
  histState.canRedo = hIndex < history.length - 1;
}
export function resetHistory() {
  history = [makeSnap()];
  hIndex = 0;
  contentRev.n++;
  syncHistUI();
}
export function undo() {
  if (hIndex <= 0 || guardLocked()) return;
  hIndex--;
  restoreSnap(history[hIndex]);
  syncHistUI();
}
export function redo() {
  if (hIndex >= history.length - 1 || guardLocked()) return;
  hIndex++;
  restoreSnap(history[hIndex]);
  syncHistUI();
}
function restoreSnap(snap) {
  inUndoRedo = true;
  try {
    const cs = JSON.parse(snap.cs); // [customSymbols, hiddenSymbols]
    applyChartObject({ ...JSON.parse(snap.chartStr), customSymbols: cs[0], hiddenSymbols: cs[1] });
    syncActiveChart();
    contentRev.n++; // 撤销/重做改了图面内容，派生物（如顶栏校验码）需重算
    schedulePersist();
  } finally { inUndoRedo = false; }
}

/* 框选（复制源）与剪贴板：会话级，不进存档 */
export const clipSel = reactive({ rect: null });    // {c0,r0,c1,r1}
export const clipBoard = reactive({
  data: null,  // {w, h, placements, borders}
  info: '',    // 一次性操作提示（工具栏显示）
});
let infoTimer = null;
function flashInfo(text) {
  // clipBoard.info = text;
  toast(text, 'info'); // 右下角轻提示同步展示（工具栏一次性提示保留原逻辑）
  clearTimeout(infoTimer);
  infoTimer = setTimeout(() => { clipBoard.info = ''; }, 2500);
}

/* localStorage 持久化对象：作品树 + 全局库 + 会话状态。
   与 makeSnap 同理先 toRaw，否则整个作品树（含大图解的每个 placement）
   都要走 Proxy 陷阱序列化 */
function persistObject() {
  return {
    version: 2,
    works: toRaw(state.works),
    activeWorkId: state.activeWorkId,
    activeChartId: state.activeChartId,
    customSymbols: toRaw(state.customSymbols),
    hiddenSymbols: toRaw(state.hiddenSymbols),
    favorites: toRaw(state.favorites),
    activeCats: toRaw(state.activeCats),
    zoom: state.zoom, tool: state.tool, highlight: state.highlight,
    theme: state.theme,
    wsMap: toRaw(state.wsMap),
  };
}
/* ---------------- 图解最后更改时间 ----------------
   chart.updatedAt 随存档保存。以图面内容是否真的变化为准（历史是否新增一条）：
   放置/擦除/边框/标注/列号/网格尺寸/正反侧/粘贴/删选区计时；
   锁定切换、重命名、收藏、面板偏好、换配色/换工具等不产生历史节点，不计时。
   图解切换时 resetHistory 会用当前图解重新播种，故无需再记图表 id */

/* ---------------- localStorage 防抖写入 ----------------
   persistObject() 会 stringify 整个作品树（所有作品所有图解），大图解时是
   单次编辑里最大的一笔开销；编辑类操作高频调用 save()，改为 12s 节流式
   落盘（连击期间每 12s 至多写一次，停手后 12s 内补写最后一次），
   Ctrl+S / 页面隐藏/关闭前强制刷出，避免丢档 */
const PERSIST_DELAY = 12000;
let persistTimer = 0;
function persistNow() {
  if (!persistTimer) return;
  persistTimer = 0;
  try { localStorage.setItem(LS_KEY, JSON.stringify(persistObject())); } catch (e) {}
}
/* 自测/关键路径用：立即落盘（平时走 400ms 防抖） */
export function flushPersist() { persistNow(); }
function schedulePersist() {
  if (!persistTimer) persistTimer = setTimeout(persistNow, PERSIST_DELAY);
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', persistNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow(); });
}

export function save() {
  try {
    syncActiveChart();
    const w0 = activeWork(); // 记录最近编辑时间，作品管理页展示用
    if (w0) w0.updatedAt = Date.now();
    /* 大图解下 stringify 是主要开销：图面内容只序列化这一次，同时用于
       撤销历史（去重 + 快照）与「最后更改时间」追踪 */
    const s = makeSnap();
    if (!sameChart(history[hIndex], s)) { // 图面真变了才刷新「最后更改」
      const c = activeChart();
      if (c) c.updatedAt = Date.now();
      contentRev.n++;
    }
    if (!sameSnap(history[hIndex], s) && !inUndoRedo) {
      history = history.slice(0, hIndex + 1);
      history.push(s);
      if (history.length > UNDO_MAX) history.shift();
      /* 字节预算：密集 400×400 单份快照 3-4MB，30 份 ≈ 120MB 字符串常驻，
         必须按总字符数限流（≈48MB UTF-16）——超限从最旧开始淘汰 */
      let total = 0;
      for (const h of history) total += h.chartStr.length + h.cs.length;
      while (history.length > 1 && total > SNAP_CHARS_MAX) {
        total -= history[0].chartStr.length + history[0].cs.length;
        history.shift();
      }
      hIndex = history.length - 1;
      syncHistUI();
    }
    schedulePersist(); // 实际 localStorage 写入防抖合并
  } catch (e) {}
}

/* 图解数据校验/规范化；chosenNames 用于生成不重复的图解名 */
function sanitizeChartIn(c, chosenNames) {
  if (!c || typeof c !== 'object') return null;
  const name = uniqueName(String(c.name || '').trim() || '图解', chosenNames);
  chosenNames.push(name);
  const rows = Math.min(400, Math.max(4, Math.round(+c.rows) || 36));
  const cols = Math.min(400, Math.max(4, Math.round(+c.cols) || 24));
  return {
    id: pickId(c.id, 'c'), name,
    rows, cols,
    rowStartSide: c.rowStartSide === 'left' ? 'left' : 'right',
    locked: !!c.locked,
    doneRows: Math.min(rows, Math.max(0, Math.round(+c.doneRows) || 0)),
    updatedAt: (typeof c.updatedAt === 'number' && c.updatedAt > 0) ? c.updatedAt : Date.now(),
    colLabels: (c.colLabels && typeof c.colLabels === 'object') ? { ...c.colLabels } : {},
    placements: (Array.isArray(c.placements) ? c.placements : []).filter(p => p && p.sym).map(p => ({ ...p })),
    borders: (Array.isArray(c.borders) ? c.borders : []).map(b => ({ ...b })),
    annotations: (Array.isArray(c.annotations) ? c.annotations : [])
      .filter(a => a && typeof a.text === 'string')
      .map(a => ({
        col: +a.col || 0, row: +a.row || 0,
        w: Math.max(1, Math.round(+a.w || 1)), h: Math.max(1, Math.round(+a.h || 1)),
        text: String(a.text),
      })),
  };
}
function sanitizeWorkIn(w, chosenWorkNames) {
  if (!w || typeof w !== 'object') return null;
  const chosenCharts = [];
  const charts = (Array.isArray(w.charts) ? w.charts : [])
    .map(c => sanitizeChartIn(c, chosenCharts)).filter(Boolean);
  return {
    id: pickId(w.id, 'w'),
    name: uniqueName(String(w.name || '').trim() || '作品', chosenWorkNames),
    charts,
    updatedAt: +w.updatedAt || 0,
  };
}
/* 丢弃引用了不存在符号（内置或自定义）的 placement，遍历所有图解 */
function pruneMissingSymbolsAll() {
  for (const w of state.works) for (const c of w.charts) {
    c.placements = c.placements.filter(p => getSym(p.sym));
  }
}

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && s.version === 2 && Array.isArray(s.works) && s.works.length) {
      state.customSymbols = (Array.isArray(s.customSymbols) ? s.customSymbols : [])
        .filter(Boolean).map(c => ({
          ...c, shapes: Array.isArray(c.shapes) ? c.shapes.map(sh => ({ ...sh })) : [],
        }));
      state.hiddenSymbols = Array.isArray(s.hiddenSymbols) ? [...s.hiddenSymbols] : [];
      state.favorites = Array.isArray(s.favorites) ? [...s.favorites] : [];
      state.activeCats = (Array.isArray(s.activeCats) && s.activeCats.every(c => typeof c === 'string'))
        ? [...s.activeCats] : ['all'];
      if (Number.isFinite(+s.zoom) && +s.zoom >= 0.5 && +s.zoom <= 2.5) state.zoom = +s.zoom;
      if (THEMES.some(t => t.id === s.theme)) state.theme = s.theme;
      state.wsMap = (s.wsMap && typeof s.wsMap === 'object' && !Array.isArray(s.wsMap))
        ? Object.fromEntries(Object.entries(s.wsMap).filter(([k, v]) => typeof k === 'string' && k && typeof v === 'string'))
        : {};
      applyTheme();
      const taken = [];
      for (const wIn of s.works) {
        const w = sanitizeWorkIn(wIn, taken);
        if (w && w.charts.length) state.works.push(w); // 跳过损坏的 null 条目，避免 load 半途抛错
      }
      if (!state.works.length) { ensureSkeleton(); return; }
      pruneMissingSymbolsAll();
      state.activeWorkId = state.works.some(w => w.id === s.activeWorkId) ? s.activeWorkId : state.works[0].id;
      const w = activeWork();
      state.activeChartId = w.charts.some(c => c.id === s.activeChartId) ? s.activeChartId : w.charts[0].id;
      projectActive();
      if (s.tool === 'erase' || s.tool === 'border' || s.tool === 'select' ||
          s.tool === 'paste' || getSym(s.tool)) state.tool = s.tool;
      if (Number.isFinite(+s.highlight) && +s.highlight >= 1 && +s.highlight <= state.rows) state.highlight = +s.highlight;
    } else if (s && Number.isFinite(+s.rows) && Number.isFinite(+s.cols)) {
      migrateLegacy(s);
    } else {
      ensureSkeleton();
    }
  } catch (e) { ensureSkeleton(); }
}

/* 旧版（version 1 之前）扁平 localStorage 数据 → 包装为单作品单图解，无感升级 */
function migrateLegacy(s) {
  state.customSymbols = (Array.isArray(s.customSymbols) ? s.customSymbols : []).map(c => ({
    ...c, shapes: Array.isArray(c.shapes) ? c.shapes.map(sh => ({ ...sh })) : [],
  }));
  state.hiddenSymbols = Array.isArray(s.hiddenSymbols) ? [...s.hiddenSymbols] : [];
  state.favorites = Array.isArray(s.favorites) ? [...s.favorites] : [];
  if (Number.isFinite(+s.zoom) && +s.zoom >= 0.5 && +s.zoom <= 2.5) state.zoom = +s.zoom;
  const colLabels = {};
  if (s.colLabels && typeof s.colLabels === 'object') Object.assign(colLabels, s.colLabels);
  else if (s.colOverrides) for (const k in s.colOverrides) if (s.colOverrides[k]) colLabels[k] = s.colOverrides[k];
  const w = {
    id: genId('w'), name: '我的作品', updatedAt: Date.now(),
    charts: [sanitizeChartIn({
      name: '图解 1',
      rows: s.rows, cols: s.cols, rowStartSide: s.rowStartSide,
      colLabels, placements: s.placements, borders: s.borders, annotations: s.annotations,
    }, [])],
  };
  state.works = [w];
  state.activeWorkId = w.id;
  state.activeChartId = w.charts[0].id;
  pruneMissingSymbolsAll();
  projectActive();
}

/* ---------------- JSON 文件存档 ---------------- */
/* v1：单图解格式（兼容旧版档），导出当前图解 */
export function serializeChart() {
  const c = activeChart();
  return {
    app: 'knitting-chart', version: 1, savedAt: new Date().toISOString(),
    name: c ? c.name : '',
    locked: !!(c && c.locked),
    rows: state.rows, cols: state.cols,
    rowStartSide: state.rowStartSide,
    colLabels: JSON.parse(JSON.stringify(state.colLabels)),
    placements: JSON.parse(JSON.stringify(state.placements)),
    borders: JSON.parse(JSON.stringify(state.borders)),
    annotations: JSON.parse(JSON.stringify(state.annotations)),
    doneRows: state.doneRows,
    customSymbols: JSON.parse(JSON.stringify(state.customSymbols)),
    hiddenSymbols: [...state.hiddenSymbols],
  };
}

/* v2：整个作品（含全部图解） */
export function serializeWork() {
  syncActiveChart();
  const w = activeWork();
  return {
    app: 'knitting-chart', version: 2, savedAt: new Date().toISOString(),
    works: [{ name: w.name, charts: JSON.parse(JSON.stringify(w.charts)) }],
    customSymbols: JSON.parse(JSON.stringify(state.customSymbols)),
  };
}

/* 文件名安全化：去掉路径/保留名等非法字符 */
export function sanitizeFileName(t) {
  return String(t).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 40) || 'untitled';
}

function defaultFileName() {
  const w = activeWork(), c = activeChart();
  return `${sanitizeFileName(w ? w.name : 'work')}_${sanitizeFileName(c ? c.name : 'chart')}.json`;
}

function anchorDownload(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* 优先弹出系统"另存为"对话框，可选择已有文件覆盖保存；
   浏览器不支持 File System Access API（如 Firefox）时降级为直接下载 */
async function writeFileJson(text, name) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'JSON 存档', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 用户在对话框点了取消
      // 其他异常落到下面的下载降级
    }
  }
  anchorDownload(name, text, 'application/json');
}

/* zip 等二进制存档另存为：与 writeFileJson 同策略（File System Access 优先，降级下载） */
async function writeFileBlob(data, name, desc) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: desc, accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 用户在对话框点了取消
      // 其他异常落到下面的下载降级
    }
  }
  anchorDownload(name, data, 'application/zip');
}

/* 存档：导出整个作品为 zip（work.json = v2 作品树 + tutorials/ = 用户上传的教程图原样） */
export async function saveJson() {
  const w = activeWork();
  const u8 = await buildWorkZip();
  await writeFileBlob(new Blob([u8], { type: 'application/zip' }),
    sanitizeFileName(w ? w.name : 'work') + '.zip', '作品存档 (zip)');
}

/* zip 打包：work.json（v2 作品树，与旧 JSON 存档内容一致）+ tutorials/<文件名>。
   图片按 符号id.<图片扩展名>，文字按 符号id.txt，sid 唯一不会互相覆盖。
   供 saveJson 与自测使用；纯数据组装，不弹对话框 */
export async function buildWorkZip() {
  const files = { 'work.json': strToU8(JSON.stringify(serializeWork(), null, 2)) };
  const EXT = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
  for (const t of await tutorialU8Entries()) {
    if (!t.u8 || !t.u8.length) continue;
    /* 按符号 id 命名：sid 唯一，同名原始文件不会互相覆盖，导入时也能精确还原 sid */
    files['tutorials/' + sanitizeFileName(t.sid) + (EXT[t.type] || '.png')] = t.u8;
  }
  for (const t of tutorialTextEntries()) {
    files['tutorials/' + sanitizeFileName(t.sid) + '.txt'] = strToU8(t.text);
  }
  return zipSync(files);
}

/* 载入 zip 作品包：work.json 走 importJson 追加逻辑（失败即抛错，教程不写入）；
   tutorials/<符号id>.<图片扩展名> 写回图片、tutorials/<符号id>.txt 写回文字，
   无这些目录不报错。返回 {works, charts, tutorials, tutorialTexts} */
export async function importArchive(blob) {
  let entries;
  try {
    entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  } catch (e) {
    throw new Error('不是有效的 zip 作品包');
  }
  const workU8 = entries['work.json'];
  if (!workU8) throw new Error('zip 包中缺少 work.json');
  const res = importJson(strFromU8(workU8));
  const tuts = [], texts = [];
  for (const path in entries) {
    if (!/^tutorials\/[^/]+$/.test(path)) continue;
    const u8 = entries[path];
    if (!u8 || !u8.length) continue;
    const base = path.slice(10);
    const dot = base.lastIndexOf('.');
    const ext = (dot > 0 ? base.slice(dot + 1) : 'png').toLowerCase();
    if (ext === 'txt') { // 文字说明：文件名即符号 id
      texts.push({ sid: base.slice(0, dot), text: strFromU8(u8) });
      continue;
    }
    tuts.push({
      sid: dot > 0 ? base.slice(0, dot) : base,
      name: base,
      u8,
      type: ext === 'svg' ? 'image/svg+xml' : ext === 'gif' ? 'image/gif' :
        ext === 'webp' ? 'image/webp' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png',
    });
  }
  return {
    ...res,
    tutorials: await importTutorials(tuts),
    tutorialTexts: await importTutorialTexts(texts),
  };
}

/* 导出当前图解（v1 单图解格式，可被旧版工具载入） */
export async function saveChartJson() {
  await writeFileJson(JSON.stringify(serializeChart(), null, 2), defaultFileName());
}

/* 合并文件带来的自定义符号：按 id 去重，只补充本机缺少的 */
function mergeCustomSymbols(list) {
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !Array.isArray(c.shapes)) continue;
    if (!state.customSymbols.some(x => x.id === c.id)) {
      state.customSymbols.push({ ...c, shapes: c.shapes.map(sh => ({ ...sh })) });
    }
  }
}

/* 载入 JSON：v2 作品包 → 导入为新作品；v1 单图解 → 追加为当前作品的新图解。
   一律追加、不覆盖现有内容；失败抛错由调用方提示。返回 {works, charts} */
export function importJson(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object') throw new Error('不是本工具导出的存档文件');
  if (s.version === 2 || Array.isArray(s.works) || s.work) {
    const worksIn = Array.isArray(s.works) ? s.works : (s.work ? [s.work] : []);
    if (!worksIn.length) throw new Error('文件中没有作品数据');
    mergeCustomSymbols(s.customSymbols);
    const taken = state.works.map(w => w.name);
    let charts = 0, lastId = null;
    for (const wIn of worksIn) {
      const w = sanitizeWorkIn(wIn, taken);
      if (!w.charts.length) continue;
      charts += w.charts.length;
      state.works.push(w);
      lastId = w.id;
    }
    if (!charts) throw new Error('文件中没有有效的图解');
    pruneMissingSymbolsAll();
    switchWork(lastId);
    return { works: worksIn.length, charts };
  }
  if (!Number.isFinite(+s.rows) || !Number.isFinite(+s.cols)) {
    throw new Error('缺少 rows/cols，不是本工具导出的图解文件');
  }
  mergeCustomSymbols(s.customSymbols);
  const w = activeWork();
  const c = sanitizeChartIn({ ...s, name: String(s.name || '').trim() || '导入图解' },
    w.charts.map(x => x.name));
  w.charts.push(c);
  pruneMissingSymbolsAll();
  switchChart(c.id);
  return { works: 0, charts: 1 };
}

/* 从图解代码（DSL）导入：追加为当前作品的新图解。
   代码里的自定义符号按「名字+内容哈希」匹配本机符号库，缺失则抛
   ChartCodeError('MISSING_CUSTOM') 并带 detail=缺失名字数组。
   成功返回新图解 id。 */
export async function importChartCode(code) {
  const { chart, customRefs } = await codeToChart(code);
  /* 本机自定义符号按 名字+hash 建索引，回填 ~n → 本机 id */
  const local = new Map();
  for (const c of state.customSymbols) local.set(c.name + '*' + (await hashCustomSym(c)), c.id);
  const missing = [];
  const refToId = new Map();
  for (const r of customRefs) {
    const id = local.get(r.name + '*' + r.hash);
    if (id) refToId.set('~' + r.n, id);
    else missing.push(r.name);
  }
  if (missing.length) {
    const e = new Error('代码用到本机没有的自定义符号：' + missing.join('、'));
    e.kind = 'MISSING_CUSTOM'; e.detail = missing;
    throw e;
  }
  const raw = {
    ...chart,
    placements: chart.placements.map(p => ({ ...p, sym: refToId.get(p.sym) || p.sym })),
    name: '导入图解',
  };
  const w = activeWork();
  const c = sanitizeChartIn(raw, w.charts.map(x => x.name));
  syncActiveChart(); // 先把当前编辑面写回旧图解（与 addChart 同惯例）
  w.charts.push(c);
  pruneMissingSymbolsAll();
  switchChart(c.id);
  return c.id;
}

/* 图解校验码（顶栏常驻展示）：即当前图解的 KC2 代码末 8 位 SHA-256——
   与「图解代码」弹窗里展示的校验码完全一致（用户要求两处统一，避免困扰）。
   异步计算（deflate + SHA-256，大图解几毫秒）；调用方负责响应式触发与竞态防护。
   口径 = KC2：网格/列号/放置/边框/标注 + 被引用的自定义符号（名+形状哈希+尺寸），
   全部规范化排序——同一图解跨导入/跨设备必同码 */
export async function chartCheckCode() {
  const c = activeChart();
  if (!c) return '';
  /* 传原始数组：编码器会逐放置读 col/row/w/h，走 reactive 代理会逐次触发
     Proxy get 陷阱（大图解几毫秒～十几毫秒） */
  const raw = {
    ...c,
    placements: toRaw(c.placements), borders: toRaw(c.borders),
    annotations: toRaw(c.annotations), colLabels: toRaw(c.colLabels),
  };
  return (await chartToCode(raw, toRaw(state.customSymbols))).slice(-8);
}

/* 把存档对象套到 state 上（校验 + 清理），不写 localStorage；供文件载入与撤销恢复共用 */
function applyChartObject(s) {
  const cols = Math.min(400, Math.max(4, Math.round(+s.cols)));
  const rows = Math.min(400, Math.max(4, Math.round(+s.rows)));
  state.cols = cols; state.rows = rows;
  // 必须逐项拷贝：state 不能与快照/存档对象共享数组引用，
  // 否则 push 等原地修改会污染撤销历史里的快照
  state.placements = (Array.isArray(s.placements) ? s.placements : []).map(p => ({ ...p }));
  state.borders = (Array.isArray(s.borders) ? s.borders : []).map(b => ({ ...b }));
  state.annotations = (Array.isArray(s.annotations) ? s.annotations : [])
    .filter(a => a && typeof a.text === 'string')
    .map(a => ({
      col: +a.col || 0, row: +a.row || 0,
      w: Math.max(1, Math.round(+a.w || 1)), h: Math.max(1, Math.round(+a.h || 1)),
      text: String(a.text),
    }));
  state.customSymbols = (Array.isArray(s.customSymbols) ? s.customSymbols : []).map(c => ({
    ...c, shapes: Array.isArray(c.shapes) ? c.shapes.map(sh => ({ ...sh })) : [],
  }));
  state.hiddenSymbols = Array.isArray(s.hiddenSymbols) ? [...s.hiddenSymbols] : [];
  state.colLabels = (s.colLabels && typeof s.colLabels === 'object') ? { ...s.colLabels } : {};
  state.rowStartSide = s.rowStartSide === 'left' ? 'left' : 'right';
  state.highlight = null;
  /* 织进度不在撤销快照里：快照无 doneRows 字段时保留当前值，只做行数越界收敛 */
  if ('doneRows' in s) state.doneRows = Math.min(rows, Math.max(0, Math.round(+s.doneRows) || 0));
  else if (state.doneRows > rows) state.doneRows = rows;
  state.placements = state.placements.filter(p => p && getSym(p.sym));
  if (state.tool !== 'erase' && state.tool !== 'border' && state.tool !== 'select' &&
      state.tool !== 'paste' && !getSym(state.tool)) state.tool = 'knit';
}

/* 解析 JSON 文本并整体覆盖当前画布；失败时抛错由调用方提示 */
export function applyChartJson(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || !Number.isFinite(+s.rows) || !Number.isFinite(+s.cols)) {
    throw new Error('缺少 rows/cols，不是本工具导出的图解文件');
  }
  applyChartObject(s);
  save();
}

/* ---------------- 框选复制 / 粘贴 ---------------- */
/* 把选区内容（完整落入选区的符号与边框）存入剪贴板，返回复制的符号数；无选区返回 0 */
export function copySelection() {
  const rect = clipSel.rect;
  if (!rect) return 0;
  const col0 = Math.min(rect.c0, rect.c1), col1 = Math.max(rect.c0, rect.c1);
  const row0 = Math.min(rect.r0, rect.r1), row1 = Math.max(rect.r0, rect.r1);
  const inside = (c, r, w, h) => c >= col0 && r >= row0 && c + w - 1 <= col1 && r + h - 1 <= row1;
  const placements = state.placements.filter(p => inside(p.col, p.row, p.w, p.h))
    .map(p => ({ sym: p.sym, col: p.col - col0, row: p.row - row0 }));
  const borders = state.borders.filter(b => inside(b.col, b.row, b.w, b.h))
    .map(b => ({ col: b.col - col0, row: b.row - row0, w: b.w, h: b.h }));
  const annotations = state.annotations.filter(a => inside(a.col, a.row, a.w, a.h))
    .map(a => ({ col: a.col - col0, row: a.row - row0, w: a.w, h: a.h, text: a.text }));
  if (!placements.length && !borders.length && !annotations.length) { flashInfo('选区内没有可复制的内容'); return 0; }
  clipBoard.data = { w: col1 - col0 + 1, h: row1 - row0 + 1, placements, borders, annotations };
  const parts = [`${placements.length} 个符号`];
  if (borders.length) parts.push(`${borders.length} 个边框`);
  if (annotations.length) parts.push(`${annotations.length} 个标注`);
  flashInfo(`已复制 ${parts.join('、')}，点击“粘贴”放到目标位置`);
  return placements.length;
}

/* 以点击格为复制块左下角粘贴；越界或符号缺失的部分自动跳过 */
export function pasteAt(c, r) {
  const cb = clipBoard.data;
  if (!cb || guardLocked()) return;
  /* 先算出所有能落位的符号，并把它们覆盖的格收进 Set；
     再用一趟遍历剔掉与这些格相交的旧符号、一次性拼上新符号。
     旧实现对每个新符号都 filter 一遍全数组（O(放置数×粘贴数)），
     上万放置的图解粘贴大块时会卡住 */
  const add = [];
  let cover = null;
  for (const rp of cb.placements) {
    const d = getSym(rp.sym);
    if (!d) continue;
    const col = c + rp.col, row = r + rp.row;
    if (!fits(col, row, d.w, d.h)) continue;
    add.push({ sym: rp.sym, col, row, w: d.w, h: d.h });
    if (!cover) cover = new Set();
    for (let i = 0; i < d.w; i++)
      for (let j = 0; j < d.h; j++) cover.add((col + i) * 10000 + (row + j));
  }
  if (add.length) {
    const keep = [];
    for (const p of toRaw(state.placements)) {
      let clash = false;
      for (let i = 0; i < p.w && !clash; i++)
        for (let j = 0; j < p.h; j++)
          if (cover.has((p.col + i) * 10000 + (p.row + j))) { clash = true; break; }
      if (!clash) keep.push(p);
    }
    state.placements = keep.concat(add);
  }
  for (const rb of cb.borders) {
    const col = c + rb.col, row = r + rb.row;
    if (!fits(col, row, rb.w, rb.h)) continue;
    const dup = state.borders.some(b => b.col === col && b.row === row && b.w === rb.w && b.h === rb.h);
    if (!dup) state.borders.push({ col, row, w: rb.w, h: rb.h });
  }
  for (const ra of (cb.annotations || [])) { // 旧剪贴板数据无 annotations，兜底
    const col = c + ra.col, row = r + ra.row;
    if (!fits(col, row, ra.w, ra.h)) continue;
    const dup = state.annotations.some(a => a.col === col && a.row === row && a.w === ra.w && a.h === ra.h);
    if (!dup) state.annotations.push({ col, row, w: ra.w, h: ra.h, text: ra.text });
  }
  save();
}

/* ---------------- 区域标注 ---------------- */
/* 给当前框选区域加文字标注；消去工具/右键点选区域内可删除 */
export function addAnnotation(text) {
  const rect = clipSel.rect;
  if (!rect || guardLocked()) return false;
  const t = String(text || '').trim();
  if (!t) { flashInfo('未输入标注文字，已取消'); return false; }
  const col = Math.min(rect.c0, rect.c1), row = Math.min(rect.r0, rect.r1);
  const w = Math.abs(rect.c1 - rect.c0) + 1, h = Math.abs(rect.r1 - rect.r0) + 1;
  state.annotations.push({ col, row, w, h, text: t });
  save();
  flashInfo(`已添加标注“${t}”（用消去工具/右键点区域内可删除）`);
  return true;
}

/* ---------------- 列号 ---------------- */
export function labelFor(c) {
  return state.colLabels[String(c)] || '';
}

/* ---------------- 符号查找：内置 + 自定义 ---------------- */
export function getSym(id) {
  return SYMBOLS[id] || state.customSymbols.find(x => x.id === id);
}
export function paletteIds() {
  return [...PALETTE_ORDER, ...state.customSymbols.map(s => s.id)]
    .filter(id => !state.hiddenSymbols.includes(id));
}
/* 内置符号只能从面板移除（隐藏），定义仍在；自定义符号走 deleteCustom 真删除 */
export function hideSymbol(id) {
  if (!state.hiddenSymbols.includes(id)) state.hiddenSymbols.push(id);
  if (state.tool === id) selectTool('knit');
  save();
}
export function restoreSymbol(id) {
  state.hiddenSymbols = state.hiddenSymbols.filter(x => x !== id);
  save();
}
export function hiddenSyms() {
  return state.hiddenSymbols.map(id => ({ id, sym: getSym(id) })).filter(x => x.sym);
}
export function setColLabel(c, text) {
  if (guardLocked()) return;
  const t = String(text).trim();
  if (t === '') delete state.colLabels[String(c)];
  else state.colLabels[String(c)] = t;
  save();
}
export function clearColLabels() {
  if (guardLocked()) return;
  state.colLabels = {};
  save();
}

/* ---------------- 工具选择 ---------------- */
export function selectTool(id) {
  state.tool = id;
  if (id !== 'select') clipSel.rect = null; // 离开框选模式即清除选区
  save();
}

/* ---------------- 放置 / 删除 ---------------- */
const hit = (p, c, r) => c >= p.col && c < p.col + p.w && r >= p.row && r < p.row + p.h;
const borderHit = (b, c, r) => c >= b.col && c < b.col + b.w && r >= b.row && r < b.row + b.h;
/* 从原始数组里按谓词筛出保留项：大图解下对 reactive 代理数组做 filter 会
   逐元素触发 Proxy get 陷阱（每次绘制 6ms 量级），走 raw 只做纯数值比较 */
function keepRaw(arr, drop) {
  const out = [];
  for (const x of toRaw(arr)) if (!drop(x)) out.push(x);
  return out;
}

export function fits(c, r, w, h) {
  return c >= 0 && r >= 1 && c + w <= state.cols && r + h - 1 <= state.rows;
}

export function applyAt(c, r) {
  if (guardLocked()) return;
  const tool = state.tool;
  if (tool === 'erase') {
    const pn = state.placements.length, bn = state.borders.length, an = state.annotations.length;
    state.placements = keepRaw(state.placements, p => hit(p, c, r));
    state.borders = keepRaw(state.borders, b => borderHit(b, c, r));
    state.annotations = keepRaw(state.annotations, a => hit(a, c, r));
    if (state.placements.length !== pn || state.borders.length !== bn ||
        state.annotations.length !== an) save();
    return;
  }
  if (tool === 'border') { commitBorder(c, r, c, r); return; }
  const d = getSym(tool);
  if (!d || !fits(c, r, d.w, d.h)) return;
  // 覆盖：删掉与新区块相交的旧符号
  state.placements = keepRaw(state.placements, p =>
    c < p.col + p.w && p.col < c + d.w && r < p.row + p.h && p.row < r + d.h);
  state.placements.push({ sym: tool, col: c, row: r, w: d.w, h: d.h });
  save();
}

export function commitBorder(c0, r0, c1, r1) {
  if (guardLocked()) return;
  const col = Math.min(c0, c1), row = Math.min(r0, r1);
  const w = Math.abs(c1 - c0) + 1, h = Math.abs(r1 - r0) + 1;
  if (!fits(col, row, w, h)) return;
  const dup = state.borders.some(b => b.col === col && b.row === row && b.w === w && b.h === h);
  if (!dup) state.borders.push({ col, row, w, h });
  save();
}

export function eraseAt(c, r) {
  if (guardLocked()) return;
  state.placements = keepRaw(state.placements, p => hit(p, c, r));
  state.borders = keepRaw(state.borders, b => borderHit(b, c, r));
  state.annotations = keepRaw(state.annotations, a => hit(a, c, r));
  save();
}

/* ---------------- 网格 / 清空 ---------------- */
export function resizeGrid(cols, rows) {
  if (guardLocked()) return;
  state.cols = cols; state.rows = rows;
  state.placements = keepRaw(state.placements, p => !(p.col + p.w <= cols && p.row + p.h - 1 <= rows));
  state.borders = keepRaw(state.borders, b => !(b.col + b.w <= cols && b.row + b.h - 1 <= rows));
  state.annotations = keepRaw(state.annotations, a => !(a.col + a.w <= cols && a.row + a.h - 1 <= rows));
  for (const k of Object.keys(state.colLabels)) if (+k >= cols) delete state.colLabels[k];
  if (state.highlight && state.highlight > rows) state.highlight = null;
  if (state.doneRows > rows) state.doneRows = rows;
  save();
}
export function clearAll() {
  if (guardLocked()) return;
  state.placements = []; state.borders = []; state.annotations = []; state.highlight = null;
  state.doneRows = 0;
  save();
}
export function setZoom(v) { state.zoom = v; save(); }
export function setRowStartSide(v) {
  if (guardLocked()) return;
  state.rowStartSide = v === 'left' ? 'left' : 'right';
  save();
}
export function toggleHighlight(r) {
  state.highlight = state.highlight === r ? null : r;
  save();
}

/* ---------------- 织进度 ----------------
   doneRows = 已织完的行数（0..rows），当前待织行 = doneRows + 1；
   行号自下而上编号、织的方向也自下而上，两者天然对齐。
   织进度记录的是「照图施工」的进度而非图面内容：不进撤销指纹、不刷新
   「最后更改」，锁定图解也允许推进（见 guardLocked 的调用处都不经过这里） */
export function setDoneRows(n) {
  const v = Math.round(+n);
  state.doneRows = Math.min(state.rows, Math.max(0, Number.isFinite(v) ? v : 0));
  save();
}
export function stepDoneRows(delta) {
  setDoneRows(state.doneRows + (Math.round(+delta) || 0));
}

/* ---------------- 图解锁定 ----------------
   锁定后拦截一切改动图面/图解数据的操作，防止完成的图解被误改。
   locked 存在图解对象上（随作品树自动进 localStorage 与 JSON 存档）；
   不在撤销指纹里，锁定/解锁本身不产生历史节点 */
export function isChartLocked() {
  const c = activeChart();
  return !!(c && c.locked);
}
export function toggleChartLocked() {
  const c = activeChart();
  if (!c) return false;
  c.locked = !c.locked;
  save();
  flashInfo(c.locked ? `已锁定「${c.name}」，页签栏锁按钮可解锁` : `已解锁「${c.name}」，可继续编辑`);
  return c.locked;
}
/* 修改类操作的统一入口守卫，返回 true 表示已拦截 */
function guardLocked() {
  const c = activeChart();
  if (c && c.locked) { flashInfo('图解已锁定，点页签栏的锁按钮解锁后再编辑'); return true; }
  return false;
}

/* ---------------- 自定义符号 ---------------- */
export function upsertCustom(data) {
  if (data.id) {
    const i = state.customSymbols.findIndex(s => s.id === data.id);
    if (i >= 0) state.customSymbols[i] = data;
  } else {
    data.id = 'custom_' + Date.now().toString(36);
    state.customSymbols.push(data);
  }
  save();
  return data.id;
}
export function deleteCustom(id) {
  state.customSymbols = state.customSymbols.filter(s => s.id !== id);
  syncActiveChart();
  // 自定义符号是全局库：删除时清理所有作品所有图解里的引用
  for (const w of state.works) for (const c of w.charts) {
    c.placements = c.placements.filter(p => p.sym !== id);
  }
  projectActive(); // 活动图解的 placements 数组被替换，重新对准投影
  if (state.tool === id) selectTool('knit');
  save();
}

/* ---------------- 自定义符号编辑器开关 ---------------- */
export function openEditor(id) {
  const data = id ? state.customSymbols.find(s => s.id === id) : null;
  resetEditor(data
    ? { id: data.id, name: data.name, w: data.w, h: data.h, shapes: JSON.parse(JSON.stringify(data.shapes)) }
    : null);
  ui.editorOpen = true;
}
export function closeEditor() {
  ui.editorOpen = false;
  ed.drawing = null;
}

/* ---------------- 自测试辅助 ---------------- */
export function resetStateForTest() {
  Object.assign(state, {
    works: [], activeWorkId: null, activeChartId: null,
    rows: 36, cols: 24, placements: [], borders: [], annotations: [], customSymbols: [],
    hiddenSymbols: [], highlight: null, zoom: 1, rowStartSide: 'right', colLabels: {}, tool: 'knit',
    doneRows: 0, theme: 'sage', wsMap: {},
  });
  ensureSkeleton();
  applyTheme();
  clipSel.rect = null; clipBoard.data = null; clipBoard.info = '';
  resetHistory();
}
