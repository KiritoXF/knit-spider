import { reactive, toRaw } from 'vue';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { SYMBOLS, PALETTE_ORDER } from './symbols.js';
import { ui, ed, resetEditor, toast } from './ui.js';
import { tutorialU8Entries, tutorialTextEntries, importTutorials, importTutorialTexts } from './tutorialStore.js';
import { chartToCode, codeToChart, hashCustomSym } from './chartCode.js';
import * as textChart from './textChart.js';

export const LS_KEY = 'knitChartProto1';
/* 织进度专用小键：主窗口改进度时立即写这里（几十字节，微秒级），
   浮窗据此秒级跟随。绝不为此全量刷 LS_KEY——那会把大图解的整树序列化
   （几百毫秒）压进每次计数器输入，是「文字解里改进度很卡」的根源 */
export const PROG_KEY = LS_KEY + '.prog';
/* 进度变更时间戳：随 PROG_KEY 与整档落盘发出，接收方据此丢弃
   比本端最近一次本地操作更旧的「回声」（快速连点时旧绝对值会把
   新进度拉回去再逐条重放） */
let progT = 0;

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
   入口在符号库弹窗（SymbolCenterModal）中按符号逐个配置。
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
  invalidatePersist(); // 作品树结构变了：全部落盘缓存失效
  save();
  return w.id;
}
export function renameWork(id, name) {
  const w = state.works.find(x => x.id === id);
  const t = String(name || '').trim();
  if (!w || !t) return false;
  w.name = uniqueName(t, state.works.filter(x => x.id !== id).map(x => x.name));
  invalidatePersist(); // 改的可能不是活动作品，缓存全部失效
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
  invalidatePersist();
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
  const raw = toRaw(state.placements);
  state.placements = raw.filter(p => !inside(p.col, p.row, p.w, p.h)); // raw 遍历避开代理陷阱
  state.borders = toRaw(state.borders).filter(b => !inside(b.col, b.row, b.w, b.h));
  state.annotations = toRaw(state.annotations).filter(a => !inside(a.col, a.row, a.w, a.h));
  const n = (pn - state.placements.length) + (bn - state.borders.length) + (an - state.annotations.length);
  if (n) {
    // 选区内的符号/边框/标注全被删，画布脏区=选区（符号只可能落在其内）
    if (state.placements.length !== pn) {
      markCanvasDirty(col0, row0, col1, row1);
    } else {
      markCanvasNone(); // 只删了边框/标注，符号位图无涉
    }
    save(true);
    flashInfo(`已删除选区内 ${n} 项内容`);
  }
  return n;
}

/* ---------------- 撤销 / 重做（会话级，不持久化） ----------------
   引用式补丁历史。前提不变量（务必维持）：图面容器 state.placements /
   borders / annotations / colLabels / customSymbols / hiddenSymbols 只被
   「整体替换」（filter/map/concat/展开重建），绝不允许 push/splice/下标
   赋值/delete key 等原地修改（对「刚 new 出来还没进 state」的数组操作除外）。
   这样历史条目直接持有替换前后的引用，undo/redo = O(1) 引用回填：
   · 无每编辑全量 stringify（旧快照方案在 400×400 下单格编辑/粘贴 500ms
     卡顿的根因），也无恢复时 parse 全图的开销；
   · 每格编辑一个撤销步，粒度与旧版一致；
   · 结构共享：旧数组只多占一个壳，单条目增量内存 O(改动量)。
   （旧版「对象树深拷贝快照」曾致切回大图解 8-10s 长任务，勿回退） */
let history = [];      // 每项 = 变更字段对 {字段: {from, to}}，仅含变化字段
let hIndex = -1;
const UNDO_MAX = 30;
let lastRefs = null;   // 上次 save 时的容器引用（变更检测基线）
let lastFp = '';

export const histState = reactive({ canUndo: false, canRedo: false });
/* 图面内容版本号：图面内容真正变化时自增（编辑走 save 的判定，撤销/重做走
   applyEntry，换图/导入走 resetHistory）。顶栏校验码这类昂贵的派生物只需读它
   即可注册依赖 */
export const contentRev = reactive({ n: 0 });

/* ---- 画布脏区（瓦片层增量更新协议） ----
   变更函数在调用 save() 前标出受影响的格域，瓦片层只重建/重渲相交块，
   避免每次编辑 O(全部放置) 重建瓦片桶（400×400 满图下单格编辑的最大
   剩余开销）。取值：null=未知（save 兜底按全图）| 'none'=图面变了但
   符号层无涉（边框/标注/列号等，画在 SVG 层）| 'all'=全图 |
   {c0,r0,c1,r1}=格域矩形（col 0 起、row 1 起、含符号足迹，删掉的旧符号
   也要并进来，否则其残影留在矩形外的瓦片上） */
let canvasDirty = null;
export function markCanvasDirty(c0, r0, c1, r1) {
  if (canvasDirty === 'all') return;
  const rect = { c0: Math.max(0, Math.floor(c0)), r0: Math.max(1, Math.floor(r0)), c1, r1 };
  if (!canvasDirty || canvasDirty === 'none') canvasDirty = rect;
  else canvasDirty = {
    c0: Math.min(canvasDirty.c0, rect.c0), r0: Math.min(canvasDirty.r0, rect.r0),
    c1: Math.max(canvasDirty.c1, rect.c1), r1: Math.max(canvasDirty.r1, rect.r1),
  };
}
export function markCanvasAllDirty() { canvasDirty = 'all'; }
export function markCanvasNone() { if (canvasDirty === null) canvasDirty = 'none'; }
export function takeCanvasDirty() { const d = canvasDirty; canvasDirty = null; return d; }

/* 图面快速指纹：不分配字符串的双车道数值哈希（覆盖字段与撤销追踪一致）。
   仅用于过滤「引用换了但内容没变」的空转替换（如 keepRaw 一个都没删），
   避免空转产生撤销节点/刷新「最后更改」。sym 哈希按字符串 memo 化
   （同一符号 id 全图重复几千次，只哈希一次）。 */
const symHashMemo = new Map();
function chartFpFast() {
  let a = 0x811c9dc5 | 0, b = 0x01000193 | 0;
  const m = v => { a = Math.imul(a ^ v, 16777619) | 0; b = Math.imul(b + v | 0, 2246822519) | 0; };
  const ms = s => { // 串尾加分隔值，防不同串拼接同哈希
    for (let i = 0; i < s.length; i++) m(s.charCodeAt(i) | 0);
    m(0x9e3779b9);
  };
  m(state.rows | 0); m(state.cols | 0);
  m(state.rowStartSide === 'left' ? 1 : 2);
  const cl = toRaw(state.colLabels);
  for (const k of Object.keys(cl)) { m(+k || 0); ms(String(cl[k])); }
  const ps = toRaw(state.placements);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    let sh = symHashMemo.get(p.sym);
    if (sh === undefined) {
      const s = String(p.sym);
      sh = 0x811c9dc5 | 0;
      for (let j = 0; j < s.length; j++) sh = Math.imul(sh ^ s.charCodeAt(j), 16777619) | 0;
      symHashMemo.set(p.sym, sh);
    }
    m(sh); m((p.col || 0) | 0); m((p.row || 0) | 0);
    m((p.w || 1) | 0); m((p.h || 1) | 0);
  }
  const bs = toRaw(state.borders);
  for (let i = 0; i < bs.length; i++) {
    const x = bs[i];
    m((x.col || 0) | 0); m((x.row || 0) | 0); m((x.w || 1) | 0); m((x.h || 1) | 0);
  }
  const as = toRaw(state.annotations);
  for (let i = 0; i < as.length; i++) {
    const x = as[i];
    m((x.col || 0) | 0); m((x.row || 0) | 0); m((x.w || 1) | 0); m((x.h || 1) | 0); ms(String(x.text));
  }
  return a + '/' + b;
}

/* 变更检测基线：图面容器 + 网格尺寸/起始侧。全部走「整体替换」纪律后，
   引用比较即可可靠判定变化 */
function chartRefs() {
  return {
    placements: state.placements, borders: state.borders, annotations: state.annotations,
    colLabels: state.colLabels, customSymbols: state.customSymbols,
    hiddenSymbols: state.hiddenSymbols, cols: state.cols, rows: state.rows,
    rowStartSide: state.rowStartSide,
  };
}
function syncHistUI() {
  histState.canUndo = hIndex >= 0;
  histState.canRedo = hIndex < history.length - 1;
}
export function resetHistory() {
  history = [];
  hIndex = -1;
  lastRefs = chartRefs();
  lastFp = chartFpFast();
  contentRev.n++;
  markCanvasAllDirty(); // 换图/导入/测试重置：画布整体重渲
  syncHistUI();
}
/* 撤销/重做：按字段回填引用（只动条目里变化的字段） */
function applyEntry(e, dir) {
  for (const k of ['placements', 'borders', 'annotations', 'colLabels',
    'customSymbols', 'hiddenSymbols']) {
    const f = e[k];
    if (f) state[k] = dir < 0 ? f.from : f.to;
  }
  if (e.cols) state.cols = dir < 0 ? e.cols.from : e.cols.to;
  if (e.rows) state.rows = dir < 0 ? e.rows.from : e.rows.to;
  if (e.rowStartSide) state.rowStartSide = dir < 0 ? e.rowStartSide.from : e.rowStartSide.to;
  syncActiveChart();
  contentRev.n++;
  markCanvasAllDirty(); // 撤销/重做可能涉及任意区域，按全图处理
  schedulePersist();
}
export function undo() {
  if (hIndex < 0 || guardLocked()) return;
  applyEntry(history[hIndex], -1);
  hIndex--;
  syncHistUI();
}
export function redo() {
  if (hIndex >= history.length - 1 || guardLocked()) return;
  hIndex++;
  applyEntry(history[hIndex], +1);
  syncHistUI();
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

/* ---------------- 图解最后更改时间 ----------------
   chart.updatedAt 随存档保存。以图面内容是否真的变化为准（历史是否新增一条）：
   放置/擦除/边框/标注/列号/网格尺寸/正反侧/粘贴/删选区计时；
   锁定切换、重命名、收藏、面板偏好、换配色/换工具等不产生历史节点，不计时。
   图解切换时 resetHistory 会用当前图解重新播种，故无需再记图表 id */

/* ---------------- localStorage 节流写入 ----------------
   persistObject() 会 stringify 整个作品树（所有作品所有图解），大图解时是
   一笔可观的主线程开销（实测 40k 放置 ~300ms）。策略：距上次 save 超过
   2s（用户停手）才真正写；连续编辑期间每次只顺延 3s，自首次待写起 30s
   硬上限——保证编辑动作本身永不被落盘卡住，崩溃丢档窗口也不超过 30s。
   Ctrl+S / 页面隐藏/关闭前强制刷出 */
const PERSIST_DELAY = 12000;
const PERSIST_ACTIVE_DELAY = 3000;
const PERSIST_MAX_DELAY = 30000;
let persistTimer = 0;
let persistFirstAt = 0;
let lastSaveAt = 0;
/* ---- 按作品缓存序列化 ----
   落盘要写整棵作品树：多作品时绝大部分作品没变，全量 stringify 是纯浪费
   （用户实测单次 300-500ms，且 30s 硬上限会在连续编辑中途触发）。
   按 work 缓存 JSON：save() 只把活动作品标脏，落盘只序列化脏作品，
   其余直接拼缓存串。跨作品变更（删自定义符号/导入/增删作品）全部失效 */
const workJsonCache = new WeakMap(); // work(原始对象) → { json }
const workDirtySet = new WeakSet();  // 自上次落盘后变过的作品
let allWorksDirty = true;
function invalidatePersist() { allWorksDirty = true; }
function buildPersistJson() {
  const parts = [];
  for (const w of toRaw(state.works)) {
    let c = workJsonCache.get(w);
    if (!c || allWorksDirty || workDirtySet.has(w)) {
      c = { json: JSON.stringify(w) };
      workJsonCache.set(w, c);
      workDirtySet.delete(w);
    }
    parts.push(c.json);
  }
  allWorksDirty = false;
  return '{"version":2,"works":[' + parts.join(',') + ']' +
    ',"activeWorkId":' + JSON.stringify(state.activeWorkId) +
    ',"activeChartId":' + JSON.stringify(state.activeChartId) +
    ',"customSymbols":' + JSON.stringify(toRaw(state.customSymbols)) +
    ',"hiddenSymbols":' + JSON.stringify(toRaw(state.hiddenSymbols)) +
    ',"favorites":' + JSON.stringify(toRaw(state.favorites)) +
    ',"activeCats":' + JSON.stringify(toRaw(state.activeCats)) +
    ',"zoom":' + JSON.stringify(state.zoom) +
    ',"tool":' + JSON.stringify(state.tool) +
    ',"highlight":' + JSON.stringify(state.highlight) +
    ',"theme":' + JSON.stringify(state.theme) +
    ',"wsMap":' + JSON.stringify(toRaw(state.wsMap)) +
    ',"progT":' + progT +
    '}';
}
/* 只有主窗口允许写 LS_KEY：浮窗（?widget=1）与教程承载窗（?popdoc=1）也加载本模块，
   它们的内存快照滞后于主窗口（主窗口落盘有节流），若允许其 forcePersist，
   浮窗隐藏/关闭时会把旧档整树写回 LS_KEY，覆盖主窗口刚编辑的内容
   （表现为文字解进度改了几秒后「闪一下」又弹回旧值）。浮窗进度走 widgetSync 的 PIP_KEY */
const CAN_PERSIST = typeof location === 'undefined' ||
  (location.search.indexOf('widget=1') < 0 && location.search.indexOf('popdoc=1') < 0);

/* ---- 存档写权锁（防同源第二个实例覆盖存档）----
   dev 模式下浏览器打开的 localhost:5173 与 Tauri 窗口同源、共享 localStorage，
   标签页里跑着另一份完整应用（initSync('main')），它的自动落盘会把它的旧状态
   整树写回 LS_KEY，浮窗跟着 load() 就会切到别的图解/旧进度（表现为浮窗标题
   突变、行号跳回旧值）。用带心跳的持有锁保证同一时刻只有一个主窗口可写；
   检锁失败/异常一律放行（宁可多写，不可因锁丢档）。浮窗/承载窗不参与锁 */
const OWNER_KEY = LS_KEY + '.owner';
const OWNER_TTL = 8000;   // 心跳超过此时长视为持有者已死，可接管
let ownerId = Math.random().toString(36).slice(2);
let ownerWarned = false;
function ownerFreshOther() {
  try {
    const o = JSON.parse(localStorage.getItem(OWNER_KEY));
    return (o && o.id !== ownerId && Date.now() - o.t < OWNER_TTL) ? o : null;
  } catch (e) { return null; } // 锁数据坏了：放行
}
function ownerHeartbeat() {
  try { localStorage.setItem(OWNER_KEY, JSON.stringify({ id: ownerId, t: Date.now() })); } catch (e) {}
}
function ownerRelease() { try { localStorage.removeItem(OWNER_KEY); } catch (e) {} }
function ownerAcquire() { // 返回 true=获得写权
  if (!ownerFreshOther()) { ownerHeartbeat(); return true; }
  if (!ownerWarned) {
    ownerWarned = true;
    try {
      toast('检测到另一个窗口正在使用同一存档（如浏览器里打开的 localhost 页面），'
        + '为避免互相覆盖，本窗口暂停自动保存；请关闭多余窗口', 'warn');
    } catch (e) {}
  }
  return false;
}
if (CAN_PERSIST && typeof window !== 'undefined') {
  /* 只有「锁空闲/过期/属于自己」时才续期：非持有者若也无脑续期，
     会把持有者的锁覆盖成自己的，两边互抢导致双双停写 */
  setInterval(() => { if (!ownerFreshOther()) ownerHeartbeat(); }, 3000);
}
function forcePersist() {
  if (!CAN_PERSIST) return;
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = 0; }
  if (!ownerAcquire()) return;
  try { localStorage.setItem(LS_KEY, buildPersistJson()); } catch (e) {}
}
function persistNow() {
  if (!persistTimer) return;
  persistTimer = 0;
  if (!CAN_PERSIST) return;
  if (Date.now() - lastSaveAt < 2000 && Date.now() - persistFirstAt < PERSIST_MAX_DELAY) {
    persistTimer = setTimeout(persistNow, PERSIST_ACTIVE_DELAY); // 还在连续编辑，顺延
    return;
  }
  if (!ownerAcquire()) return;
  try { localStorage.setItem(LS_KEY, buildPersistJson()); } catch (e) {}
}
/* 自测/关键路径用：立即落盘。显式调用不受 CAN_PERSIST 限制
   （守卫只拦浮窗/承载窗的自动落盘：beforeunload / visibilitychange / 节流写） */
export function flushPersist() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = 0; }
  if (CAN_PERSIST && !ownerAcquire()) return; // 有别的活实例持锁时同样让位
  try { localStorage.setItem(LS_KEY, buildPersistJson()); } catch (e) {}
}
function schedulePersist() {
  lastSaveAt = Date.now();
  if (!persistTimer) {
    persistFirstAt = Date.now();
    persistTimer = setTimeout(persistNow, PERSIST_DELAY);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    forcePersist();   // 最后一次落盘（本人持锁，必然放行）
    ownerRelease();   // 随即释放锁：同窗口刷新/重启后新页面可立即接管
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) forcePersist(); });
}

export function save(definite = false) {
  try {
    syncActiveChart();
    const w0 = activeWork(); // 记录最近编辑时间，作品管理页展示用
    if (w0) {
      w0.updatedAt = Date.now();
      workDirtySet.add(toRaw(w0)); // 按作品落盘缓存：只标脏活动作品
    }
    if (!lastRefs) { lastRefs = chartRefs(); lastFp = chartFpFast(); }
    /* 变更检测：引用比较（O(字段数)）。曾在此处每次编辑对整个图解
       JSON.stringify（快照方案）——400×400 下单格编辑/粘贴 500ms 卡顿的根因 */
    const refs = chartRefs();
    let changed = false;
    for (const k in refs) if (refs[k] !== lastRefs[k]) { changed = true; break; }
    /* 指纹只用于过滤「引用换了内容没变」的空转替换；definite=true 表示
       调用方确定内容已变（高频编辑路径），跳过这道 O(全部放置) 的扫描 */
    if (changed && !definite && lastFp !== null && chartFpFast() === lastFp) {
      changed = false;       // 引用换了但内容没变（空转替换）：只对准基线
      lastRefs = refs;
    }
    if (changed) {
      if (canvasDirty === null) markCanvasAllDirty(); // 未标的路径兜底按全图
      const e = {};
      for (const k of ['placements', 'borders', 'annotations', 'colLabels',
        'customSymbols', 'hiddenSymbols', 'cols', 'rows', 'rowStartSide']) {
        if (refs[k] !== lastRefs[k]) e[k] = { from: lastRefs[k], to: refs[k] };
      }
      history = history.slice(0, hIndex + 1); // 编辑作废重做分支
      history.push(e);
      if (history.length > UNDO_MAX) history.shift();
      hIndex = history.length - 1;
      syncHistUI();
      lastRefs = refs;
      lastFp = definite ? null : chartFpFast(); // definite 时指纹留待下次需要再算
      const c = activeChart();
      if (c) c.updatedAt = Date.now();
      contentRev.n++;
    }
    schedulePersist(); // 实际 localStorage 写入节流合并
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
    /* 必须先清空再重建：load 会被浮窗在每次 LS_KEY 存储事件里重复调用
       （跨窗口同步），若不清空，works 会整体翻倍追加，而 activeWorkId 命中
       排在前面的旧副本 → projectActive 把织进度/图面回滚成旧档（浮窗进度
       弹回旧值、主窗口进度被旧基准的步进不断推高的根源） */
    state.works = [];
    /* usedIds 同样必须重播种：它惰性播种自 load 开始时的 state.works，
       且跨调用持久。重复 load 时档内 id 全都“已被占用”→ pickId 把每个
       作品/图解都换成新生成的 id → activeChartId/activeWorkId 必然匹配
       失败 → 回退 charts[0]/works[0]（浮窗自己换图解/换作品的根源）。
       load 是整树重建，档内 id 即全集，重新播种去重语义不变 */
    usedIds = null;
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
      /* activeWorkId/activeChartId 在档内匹配不上时落到第一项（换作品/换图解
         由主窗口显式操作驱动，正常存档必然能命中；命中失败只可能发生在
         存档被外部改坏等异常场景，回退到首项保证应用仍可用） */
      const workHit = state.works.some(w => w.id === s.activeWorkId);
      state.activeWorkId = workHit ? s.activeWorkId : state.works[0].id;
      const w = activeWork();
      const chartHit = w.charts.some(c => c.id === s.activeChartId);
      state.activeChartId = chartHit ? s.activeChartId : w.charts[0].id;
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

/* 合并文件带来的自定义符号：按 id 去重，只补充本机缺少的（整体替换，不原地 push） */
function mergeCustomSymbols(list) {
  if (!Array.isArray(list)) return;
  const add = [];
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !Array.isArray(c.shapes)) continue;
    if (!state.customSymbols.some(x => x.id === c.id) && !add.some(x => x.id === c.id)) {
      add.push({ ...c, shapes: c.shapes.map(sh => ({ ...sh })) });
    }
  }
  if (add.length) state.customSymbols = state.customSymbols.concat(add);
}

/* 载入 JSON：v2 作品包 → 导入为新作品；v1 单图解 → 追加为当前作品的新图解。
   一律追加、不覆盖现有内容；失败抛错由调用方提示。返回 {works, charts} */
export function importJson(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object') throw new Error('不是本工具导出的存档文件');
  invalidatePersist(); // 导入会增作品并清理全部作品的失效符号引用
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
  /* fx/fy：符号图形自身的水平/垂直镜像标记（镜像粘贴产生），复制时随块带走 */
  const placements = state.placements.filter(p => inside(p.col, p.row, p.w, p.h))
    .map(p => {
      const q = { sym: p.sym, col: p.col - col0, row: p.row - row0 };
      if (p.fx) q.fx = true;
      if (p.fy) q.fy = true;
      return q;
    });
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

/* 以点击格为复制块左下角粘贴；越界或符号缺失的部分自动跳过。
   ui.mirrorH / ui.mirrorV 开着时对复制块做一次性镜像变换：布局按符号
   占格整块翻转（多格麻花不拆散），符号图形翻转发 fx/fy 标记由渲染层
   镜像绘制；再对已带镜像标记的符号粘贴会抵消回正向（fx = toggle） */
export function pasteAt(c, r) {
  const cb = clipBoard.data;
  if (!cb || guardLocked()) return;
  const mH = !!ui.mirrorH, mV = !!ui.mirrorV;
  /* 先算出所有能落位的符号，并把它们覆盖的格收进 Set；
     再用一趟遍历剔掉与这些格相交的旧符号、一次性拼上新符号。
     旧实现对每个新符号都 filter 一遍全数组（O(放置数×粘贴数)），
     上万放置的图解粘贴大块时会卡住 */
  const add = [];
  let cover = null;
  for (const rp of cb.placements) {
    const d = getSym(rp.sym);
    if (!d) continue;
    const col = c + (mH ? cb.w - rp.col - d.w : rp.col);
    const row = r + (mV ? cb.h - rp.row - d.h : rp.row);
    const fx = mH ? !rp.fx : !!rp.fx;
    const fy = mV ? !rp.fy : !!rp.fy;
    const q = { sym: rp.sym, col, row, w: d.w, h: d.h };
    if (fx) q.fx = true;
    if (fy) q.fy = true;
    if (!fits(col, row, d.w, d.h)) continue;
    add.push(q);
    if (!cover) cover = new Set();
    for (let i = 0; i < d.w; i++)
      for (let j = 0; j < d.h; j++) cover.add((col + i) * 10000 + (row + j));
  }
  let any = false;
  if (add.length) {
    const keep = [];
    const bb = [c, r, c, r]; // 粘贴块足迹 ∪ 被覆盖旧符号足迹（画布脏区）
    for (const p of toRaw(state.placements)) {
      let clash = false;
      for (let i = 0; i < p.w && !clash; i++)
        for (let j = 0; j < p.h; j++)
          if (cover.has((p.col + i) * 10000 + (p.row + j))) { clash = true; break; }
      if (clash) {
        if (p.col < bb[0]) bb[0] = p.col;
        if (p.row < bb[1]) bb[1] = p.row;
        if (p.col + p.w - 1 > bb[2]) bb[2] = p.col + p.w - 1;
        if (p.row + p.h - 1 > bb[3]) bb[3] = p.row + p.h - 1;
      } else keep.push(p);
    }
    for (const q of add) {
      if (q.col < bb[0]) bb[0] = q.col;
      if (q.row < bb[1]) bb[1] = q.row;
      if (q.col + q.w - 1 > bb[2]) bb[2] = q.col + q.w - 1;
      if (q.row + q.h - 1 > bb[3]) bb[3] = q.row + q.h - 1;
    }
    state.placements = keep.concat(add);
    markCanvasDirty(bb[0], bb[1], bb[2], bb[3]);
    any = true;
  } else {
    markCanvasNone(); // 没有符号落位（越界或剪贴板只有边框/标注），符号位图无涉
  }
  for (const rb of (cb.borders || [])) { // 旧剪贴板数据无 borders，兜底
    const col = c + (mH ? cb.w - rb.col - rb.w : rb.col);
    const row = r + (mV ? cb.h - rb.row - rb.h : rb.row);
    if (!fits(col, row, rb.w, rb.h)) continue;
    const dup = state.borders.some(b => b.col === col && b.row === row && b.w === rb.w && b.h === rb.h);
    if (!dup) { state.borders = state.borders.concat([{ col, row, w: rb.w, h: rb.h }]); any = true; }
  }
  for (const ra of (cb.annotations || [])) { // 旧剪贴板数据无 annotations，兜底
    const col = c + (mH ? cb.w - ra.col - ra.w : ra.col);
    const row = r + (mV ? cb.h - ra.row - ra.h : ra.row);
    if (!fits(col, row, ra.w, ra.h)) continue;
    const dup = state.annotations.some(a => a.col === col && a.row === row && a.w === ra.w && a.h === ra.h);
    if (!dup) { state.annotations = state.annotations.concat([{ col, row, w: ra.w, h: ra.h, text: ra.text }]); any = true; }
  }
  save(any); // any=true 时确定变更，跳过指纹扫描
}

/* ---------------- 区域标注 ---------------- */
/* 给当前框选区域加文字标注；消去工具点选区域内可删除 */
export function addAnnotation(text) {
  const rect = clipSel.rect;
  if (!rect || guardLocked()) return false;
  const t = String(text || '').trim();
  if (!t) { flashInfo('未输入标注文字，已取消'); return false; }
  const col = Math.min(rect.c0, rect.c1), row = Math.min(rect.r0, rect.r1);
  const w = Math.abs(rect.c1 - rect.c0) + 1, h = Math.abs(rect.r1 - rect.r0) + 1;
  state.annotations = state.annotations.concat([{ col, row, w, h, text: t }]);
  markCanvasNone(); // 标注画在顶层 SVG，符号位图无涉
  save();
  flashInfo(`已添加标注“${t}”（用消去工具点区域内可删除）`);
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
  if (!state.hiddenSymbols.includes(id)) state.hiddenSymbols = state.hiddenSymbols.concat([id]);
  if (state.tool === id) selectTool('knit');
  markCanvasNone(); // 隐藏只影响符号面板，画布位图不变
  save();
}
export function restoreSymbol(id) {
  state.hiddenSymbols = state.hiddenSymbols.filter(x => x !== id);
  markCanvasNone();
  save();
}
export function hiddenSyms() {
  return state.hiddenSymbols.map(id => ({ id, sym: getSym(id) })).filter(x => x.sym);
}
export function setColLabel(c, text) {
  if (guardLocked()) return;
  const t = String(text).trim();
  const k = String(c);
  if (t === '') {
    if (!(k in toRaw(state.colLabels))) return; // 原本就没有：no-op
    const { [k]: _drop, ...rest } = toRaw(state.colLabels);
    state.colLabels = rest;
  } else {
    if (toRaw(state.colLabels)[k] === t) return; // 同值：no-op
    state.colLabels = { ...toRaw(state.colLabels), [k]: t };
  }
  markCanvasNone(); // 列号画在底层 SVG，符号位图无涉
  save();
}
export function clearColLabels() {
  if (guardLocked()) return;
  state.colLabels = {};
  markCanvasNone(); // 列号画在底层 SVG，符号位图无涉
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
   逐元素触发 Proxy get 陷阱（每次绘制 6ms 量级），走 raw 只做纯数值比较。
   没有命中时直接返回原数组（引用不变 → 变更检测零成本判定 no-op）。
   传入 bbox（[c0,r0,c1,r1] 数组）时把被删项的足迹并进去（画布脏区用） */
function keepRaw(arr, drop, bbox) {
  const raw = toRaw(arr);
  let out = null;
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i];
    if (drop(x)) {
      if (!out) out = raw.slice(0, i);
      if (bbox) {
        bbox[0] = Math.min(bbox[0], x.col);
        bbox[1] = Math.min(bbox[1], x.row);
        bbox[2] = Math.max(bbox[2], x.col + (x.w || 1) - 1);
        bbox[3] = Math.max(bbox[3], x.row + (x.h || 1) - 1);
      }
    } else if (out) out.push(x);
  }
  return out || raw;
}

export function fits(c, r, w, h) {
  return c >= 0 && r >= 1 && c + w <= state.cols && r + h - 1 <= state.rows;
}

export function applyAt(c, r) {
  if (guardLocked()) return;
  const tool = state.tool;
  if (tool === 'erase') {
    const pn = state.placements.length, bn = state.borders.length, an = state.annotations.length;
    const bb = [c, r, c, r]; // 被删符号足迹并入脏区（可能比点击格大得多）
    state.placements = keepRaw(state.placements, p => hit(p, c, r), bb);
    state.borders = keepRaw(state.borders, b => borderHit(b, c, r));
    state.annotations = keepRaw(state.annotations, a => hit(a, c, r));
    if (state.placements.length !== pn || state.borders.length !== bn ||
        state.annotations.length !== an) {
      markCanvasDirty(bb[0], bb[1], bb[2], bb[3]);
      save(true);
    }
    return;
  }
  if (tool === 'border') { commitBorder(c, r, c, r); return; }
  const d = getSym(tool);
  if (!d || !fits(c, r, d.w, d.h)) return;
  // 覆盖：删掉与新区块相交的旧符号。两个分支都必须产生新数组——
  // 容器只许整体替换（撤销历史按引用追踪），绝不在原数组上 push。
  // 先找首个相交项：不相交走 concat（少分配一份 N 槽数组，连点时 GC 更轻）
  const clashPred = p => c < p.col + p.w && p.col < c + d.w && r < p.row + p.h && p.row < r + d.h;
  const raw = toRaw(state.placements);
  const add = { sym: tool, col: c, row: r, w: d.w, h: d.h };
  let clashIdx = -1, clashes = 0, identical = false;
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (clashPred(p)) {
      clashes++;
      if (clashIdx < 0) clashIdx = i;
      // 与将放置的符号完全相同 → 连点同格是纯 no-op，直接短路
      if (p.sym === tool && p.col === c && p.row === r &&
          (p.w || 1) === d.w && (p.h || 1) === d.h) identical = true;
    }
  }
  if (clashes === 1 && identical) return;
  if (clashIdx < 0) {
    state.placements = raw.concat([add]);
  } else {
    const bb = [c, r, c + d.w - 1, r + d.h - 1]; // 新符号足迹 ∪ 被删符号足迹
    const kept = raw.slice(0, clashIdx);
    for (let i = clashIdx; i < raw.length; i++) {
      const p = raw[i];
      if (clashPred(p)) {
        if (p.col < bb[0]) bb[0] = p.col;
        if (p.row < bb[1]) bb[1] = p.row;
        if (p.col + p.w - 1 > bb[2]) bb[2] = p.col + p.w - 1;
        if (p.row + p.h - 1 > bb[3]) bb[3] = p.row + p.h - 1;
      } else kept.push(p);
    }
    state.placements = kept.concat([add]);
    markCanvasDirty(bb[0], bb[1], bb[2], bb[3]);
  }
  if (clashIdx < 0) markCanvasDirty(c, r, c + d.w - 1, r + d.h - 1);
  save(true); // 落格必然改变内容，跳过指纹扫描
}

export function commitBorder(c0, r0, c1, r1) {
  if (guardLocked()) return;
  const col = Math.min(c0, c1), row = Math.min(r0, r1);
  const w = Math.abs(c1 - c0) + 1, h = Math.abs(r1 - r0) + 1;
  if (!fits(col, row, w, h)) return;
  const dup = state.borders.some(b => b.col === col && b.row === row && b.w === w && b.h === h);
  if (!dup) state.borders = state.borders.concat([{ col, row, w, h }]);
  markCanvasNone(); // 边框画在顶层 SVG，符号位图无涉
  save();
}

export function eraseAt(c, r) {
  if (guardLocked()) return;
  const bb = [c, r, c, r];
  const pn = state.placements.length;
  state.placements = keepRaw(state.placements, p => hit(p, c, r), bb);
  state.borders = keepRaw(state.borders, b => borderHit(b, c, r));
  state.annotations = keepRaw(state.annotations, a => hit(a, c, r));
  if (state.placements.length !== pn) markCanvasDirty(bb[0], bb[1], bb[2], bb[3]);
  markCanvasNone(); // 边框/标注变化不影响符号位图
  save();
}

/* ---------------- 网格 / 清空 ---------------- */
export function resizeGrid(cols, rows) {
  if (guardLocked()) return;
  if (cols === state.cols && rows === state.rows) return; // 同尺寸：空转防御
  state.cols = cols; state.rows = rows;
  state.placements = keepRaw(state.placements, p => !(p.col + p.w <= cols && p.row + p.h - 1 <= rows));
  state.borders = keepRaw(state.borders, b => !(b.col + b.w <= cols && b.row + b.h - 1 <= rows));
  state.annotations = keepRaw(state.annotations, a => !(a.col + a.w <= cols && a.row + a.h - 1 <= rows));
  /* 列号对象重建（不许原地 delete key——撤销历史按引用追踪容器） */
  const cl = toRaw(state.colLabels);
  const ncl = {};
  for (const k of Object.keys(cl)) if (+k < cols) ncl[k] = cl[k];
  state.colLabels = ncl;
  if (state.highlight && state.highlight > rows) state.highlight = null;
  if (state.doneRows > rows) state.doneRows = rows;
  markCanvasAllDirty(); // 尺寸变化牵动全部瓦片布局
  save();
}
export function clearAll() {
  if (guardLocked()) return;
  if (!state.placements.length && !state.borders.length && !state.annotations.length &&
      !state.doneRows && !state.highlight) return; // 已是空：空转防御
  state.placements = []; state.borders = []; state.annotations = []; state.highlight = null;
  state.doneRows = 0;
  markCanvasAllDirty();
  save(true);
}
export function setZoom(v) { state.zoom = v; save(); }
export function setRowStartSide(v) {
  if (guardLocked()) return;
  const nv = v === 'left' ? 'left' : 'right';
  if (state.rowStartSide === nv) return; // 同值：空转防御
  state.rowStartSide = nv;
  markCanvasNone(); // 行号画在底层 SVG，符号位图无涉
  save(true);
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
  /* 进度秒级广播走专用小键；整档仍走 save 的节流落盘。
     progT 严格递增（同毫秒自增），保证接收方能比较新旧 */
  progT = Math.max(progT + 1, Date.now());
  if (CAN_PERSIST) {
    try {
      localStorage.setItem(PROG_KEY, JSON.stringify({
        chartId: state.activeChartId, doneRows: state.doneRows, progT,
      }));
    } catch (e) {}
  }
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
    // 整体替换（不许原地改下标——撤销历史按引用追踪容器）
    if (i >= 0) state.customSymbols = state.customSymbols.map((s, j) => j === i ? data : s);
  } else {
    data.id = 'custom_' + Date.now().toString(36);
    state.customSymbols = state.customSymbols.concat([data]);
  }
  save();
  markCanvasAllDirty(); // 符号定义变了，所有含它的瓦片都要重画
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
  markCanvasAllDirty();
  invalidatePersist(); // 跨作品清理，全部落盘缓存失效
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
  invalidatePersist();
  resetHistory();
}
