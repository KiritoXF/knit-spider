import { nextTick } from 'vue';
import {
  state, resetStateForTest, labelFor, applyAt, eraseAt, commitBorder, selectTool,
  upsertCustom, deleteCustom, openEditor, closeEditor, getSym, LS_KEY,
  hideSymbol, restoreSymbol, paletteIds, serializeChart, applyChartJson, resizeGrid, toggleFav,
  undo, redo, histState, copySelection, deleteSelection, pasteAt, clipSel, clipBoard,
  addAnnotation, setColLabel, isChartLocked, toggleChartLocked,
  activeWork, activeChart, addChart, switchChart, renameChart, deleteChart,
  addWork, deleteWork, serializeWork, importJson, load, save,
} from './store.js';
import { ui, ed } from './ui.js';
import { chartToTextRows } from './textChart.js';
import { SYMBOLS, PALETTE_ORDER } from './symbols.js';
import { symDataUrl } from './util.js';

/* ---------------- 自测试：访问 ?test=1 时由 main.js 调用（Vue 响应式渲染，全程 async） ---------------- */
export async function runSelfTest() {
  const results = [];
  const tick = () => nextTick();
  const t = async (name, fn) => {
    let ok = false;
    try { ok = !!(await fn()); } catch (e) { results.push('ERR:' + name + ':' + e.message); return; }
    results.push((ok ? 'PASS:' : 'FAIL:') + name);
  };

  localStorage.clear();
  resetStateForTest();
  ui.view = 'editor'; // 自测试需要画布 DOM，先切到编辑页
  await tick();

  /* ---- canvas 符号层断言助手：同步建图缓存 → 等位图解码 → 重绘 → 取像素 ---- */
  const symCanvasReady = async () => {
    await tick();
    const L = window.__symLayer;
    if (!L) return null;
    L.redraw();
    await L.ready();
    L.redraw();
    return document.getElementById('symCanvas');
  };
  /* 格块内采样（向内缩 18% 避开边缘网格线/外框）：test(r,g,b,a) 任一像素命中即真。
     视口渲染下远处的块不在 canvas 上：先 reveal 滚进视口再按 blockRect 采样 */
  const blockHasInk = async (cv, c0, ty, wCells, hCells, test = (r, g, b, a) => a > 8) => {
    if (!cv) return false;
    const L = window.__symLayer;
    L.reveal(c0, ty, wCells, hCells);
    const rc = L.blockRect(c0, ty, wCells, hCells);
    if (!rc) return false;
    const scr = document.querySelector('.canvas-scroll');
    window.__inkDebug = { c0, ty, st: scr && scr.scrollTop, sl: scr && scr.scrollLeft, rc: { ...rc } };
    const d = cv.getContext('2d').getImageData(rc.x, rc.y, rc.w, rc.h).data;
    for (let i = 0; i < d.length; i += 4) if (test(d[i], d[i + 1], d[i + 2], d[i + 3])) return true;
    return false;
  };
  const RED_PIX = (r, g, b, a) => a > 200 && r > 170 && g < 90 && b < 90;

  await t('place-knit', async () => {
    applyAt(10, 5);
    const cv = await symCanvasReady();
    return state.placements.length === 1 && !!cv &&
      !!(await blockHasInk(cv, 10, state.rows - 5, 1, 1)) &&   // 该格有符号笔迹
      !(await blockHasInk(cv, 0, state.rows - 1, 1, 1));       // 空白格无笔迹
  });
  await t('jis-normalize', () => {
    // knit.svg 转换后应为 x=0.5 居中竖线，y 从 0.0909 到 0.9091
    const d = SYMBOLS.knit.svg;
    return d.includes('M0.5 0.0909') && d.includes('V0.9091');
  });
  await t('jis-palette-complete', () => {
    const bad = PALETTE_ORDER.filter(id => {
      const s = getSym(id);
      return !s || !s.svg || s.w < 1 || s.h < 1 || !s.svg.includes('<');
    });
    return bad.length === 0 && PALETTE_ORDER.length >= 40;
  });
  await t('jis-arc-fill', () => {
    // 伏せ目：原 SVG 的椭圆弧经转换后保留黑色填充
    return SYMBOLS.bindOff.svg.includes('fill="#000000"');
  });
  await t('rowside-flip', async () => {
    state.rowStartSide = 'left'; await tick();
    const leftOk = document.querySelector('.rownum[data-r="1"]').getAttribute('x') === '-0.45';
    const r2right = document.querySelector('.rownum[data-r="2"]').getAttribute('x') === String(state.cols + 0.45);
    state.rowStartSide = 'right'; await tick();
    const rightOk = document.querySelector('.rownum[data-r="1"]').getAttribute('x') === String(state.cols + 0.45);
    return leftOk && r2right && rightOk;
  });
  await t('collabel-pointerdown', async () => {
    const oldPrompt = window.prompt;
    window.prompt = () => '7';
    const el = document.querySelector('.colhit[data-c="4"]');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    window.prompt = oldPrompt;
    await tick();
    const ok = labelFor(4) === '7' && document.querySelector('.colnum[data-c="4"]').textContent === '7';
    delete state.colLabels['4']; await tick();
    return ok;
  });
  await t('place-cable-2x2', async () => {
    selectTool('c22L'); applyAt(2, 2); selectTool('knit');
    const cv = await symCanvasReady();
    const p = state.placements[1];
    return state.placements.length === 2 && !!p && p.col === 2 && p.row === 2 &&
      p.w === 4 && p.h === 1 && !!cv && !!(await blockHasInk(cv, 2, state.rows - 2, 4, 1));
  });
  await t('oob-reject', () => {
    selectTool('c22L'); applyAt(state.cols - 1, 1); selectTool('knit');
    return state.placements.length === 2;
  });
  await t('highlight-row3-click', async () => {
    const el = document.querySelector('.rownum[data-r="3"]');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    return state.highlight === 3 && !!document.querySelector('#hlLayer rect') &&
      JSON.parse(localStorage.getItem(LS_KEY)).highlight === 3;
  });
  await t('erase-knit', async () => {
    selectTool('erase'); applyAt(10, 5); selectTool('knit');
    await tick();
    return state.placements.length === 1 && state.placements[0].sym === 'c22L';
  });

  await t('border-add', async () => {
    commitBorder(3, 3, 5, 5);
    await tick();
    const r = state.borders[0];
    return state.borders.length === 1 && r.col === 3 && r.row === 3 && r.w === 3 && r.h === 3 &&
      !!document.querySelector('#borderLayer rect');
  });
  await t('border-dedup', () => {
    commitBorder(5, 5, 3, 3); // 反向拖选，同一矩形不应重复
    return state.borders.length === 1;
  });
  await t('border-erase', async () => {
    selectTool('erase'); applyAt(4, 4); selectTool('knit');
    await tick();
    return state.borders.length === 0 && state.placements.length === 1; // 交叉针不在边框区域，保留
  });

  await t('custom-create-place', async () => {
    const id = upsertCustom({ name: '试做符号', w: 3, h: 2, shapes: [
      { type: 'line', x1: 0, y1: 0, x2: 3, y2: 2, color: '#d00000', w: 0.08 } ] });
    selectTool(id); applyAt(4, 10); selectTool('knit');
    const cv = await symCanvasReady();
    const p = state.placements.find(x => x.sym === id);
    return !!p && p.w === 3 && p.h === 2 &&
      !!document.querySelector('.palette-btn[data-tool="' + id + '"]') &&
      !!cv && !!(await blockHasInk(cv, 4, state.rows - 11, 3, 2, RED_PIX));
  });
  await t('custom-delete-cascade', async () => {
    const id = state.customSymbols[0].id;
    deleteCustom(id);
    await tick();
    return !state.placements.some(p => p.sym === id) &&
      !document.querySelector('.palette-btn[data-tool="' + id + '"]');
  });

  await t('symbol-hide-restore', async () => {
    hideSymbol('yo');
    await tick();
    const hidden = !paletteIds().includes('yo') &&
      !document.querySelector('.palette-btn[data-tool="yo"]');
    restoreSymbol('yo');
    await tick();
    const restored = paletteIds().includes('yo') &&
      !!document.querySelector('.palette-btn[data-tool="yo"]');
    return hidden && restored;
  });

  await t('palette-category-filter', async () => {
    const click = sel => document.querySelector(sel)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const allOk = !!document.querySelector('.palette-btn[data-tool="knit"]') &&
      !!document.querySelector('.palette-btn[data-tool="ssk"]');
    click('.cat-chip[data-cat="dec"]');
    await tick();
    const decOnly = !!document.querySelector('.palette-btn[data-tool="ssk"]') &&
      !document.querySelector('.palette-btn[data-tool="knit"]');
    // 多选：再点"基础"，两个分类同时显示
    click('.cat-chip[data-cat="basic"]');
    await tick();
    const multi = !!document.querySelector('.palette-btn[data-tool="ssk"]') &&
      !!document.querySelector('.palette-btn[data-tool="knit"]');
    // 再点一次"减针"取消该分类，只剩基础
    click('.cat-chip[data-cat="dec"]');
    await tick();
    const toggleOff = !!document.querySelector('.palette-btn[data-tool="knit"]') &&
      !document.querySelector('.palette-btn[data-tool="ssk"]');
    click('.cat-chip[data-cat="all"]');
    await tick();
    return allOk && decOnly && multi && toggleOff &&
      !!document.querySelector('.palette-btn[data-tool="knit"]') &&
      !!document.querySelector('.palette-btn[data-tool="ssk"]');
  });

  await t('palette-favorites', async () => {
    const click = sel => document.querySelector(sel)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    toggleFav('yo');
    click('.cat-chip[data-cat="fav"]');
    await tick();
    const favOnly = !!document.querySelector('.palette-btn[data-tool="yo"]') &&
      !document.querySelector('.palette-btn[data-tool="knit"]');
    toggleFav('yo'); // 还原收藏
    click('.cat-chip[data-cat="all"]');
    await tick();
    return favOnly && !!document.querySelector('.palette-btn[data-tool="knit"]') &&
      state.favorites.length === 0;
  });

  await t('editor-resize-live', async () => {
    openEditor(null);
    await tick(); // 等弹窗与画布渲染
    const edW = document.getElementById('edW'), edH = document.getElementById('edH');
    edW.value = '5'; edW.dispatchEvent(new Event('input', { bubbles: true }));
    edH.value = '3'; edH.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const vb = document.getElementById('edCanvas').getAttribute('viewBox');
    const w = ed.w;
    closeEditor();
    await tick();
    return w === 5 && ui.editorOpen === false && vb === '-0.06 -0.06 5.12 3.12';
  });

  await t('custom-curve-shape', async () => {
    // 曲线图元：三次贝塞尔经 symDataUrl 生成 path C 命令（canvas 位图同源内容）
    const id = upsertCustom({ name: '曲线符号', w: 3, h: 3, shapes: [
      { type: 'curve', x1: 0, y1: 0, cx1: 1, cy1: 0, cx2: 2, cy2: 3, x2: 3, y2: 3, color: '#d00000', w: 0.08 } ] });
    selectTool(id); applyAt(4, 4); selectTool('knit');
    const cv = await symCanvasReady();
    const p = state.placements.find(x => x.sym === id);
    const ok = !!p && !!cv &&
      decodeURIComponent(symDataUrl(getSym(id))).includes('M0 0 C1 0 2 3 3 3') &&
      !!(await blockHasInk(cv, 4, state.rows - 6, 3, 3, RED_PIX));
    deleteCustom(id);
    await tick();
    return ok;
  });

  await t('collabel-manual-only', async () => {
    state.colLabels = {}; await tick();
    return labelFor(0) === '' && !document.querySelector('.colnum[data-c="0"]') &&
      !!document.querySelector('.colhit[data-c="0"]');
  });
  await t('collabel-set-text', async () => {
    state.colLabels['2'] = 'A'; await tick();
    const el = document.querySelector('.colnum[data-c="2"]');
    return labelFor(2) === 'A' && el && el.textContent === 'A';
  });
  await t('collabel-restart-mid', async () => {
    state.colLabels = { '5': '1', '6': '2', '9': '3' }; await tick();
    return labelFor(5) === '1' && labelFor(6) === '2' && labelFor(9) === '3' && labelFor(4) === '';
  });

  await t('json-save-load', async () => {
    commitBorder(1, 1, 2, 2);
    const snap = JSON.stringify(serializeChart());
    const oldCols = state.cols, oldRows = state.rows;
    applyAt(8, 8); resizeGrid(30, 40); await tick(); // 载入前先弄乱画布
    applyChartJson(snap); await tick();
    return state.cols === oldCols && state.rows === oldRows &&
      state.placements.length === 1 && state.placements[0].sym === 'c22L' &&
      state.borders.length === 1 && state.borders[0].col === 1 &&
      labelFor(5) === '1' &&
      JSON.parse(JSON.stringify(serializeChart())).savedAt !== undefined;
  });

  await t('undo-redo', async () => {
    const snap = () => JSON.stringify([state.placements, state.borders, state.cols, state.rows]);
    const before = snap();
    const canUndoBefore = histState.canUndo;
    applyAt(20, 20); // 放一个 knit
    const after = snap();
    undo();
    const afterUndo = snap();
    redo();
    const afterRedo = snap();
    undo(); // 清理：退回测试前状态
    return canUndoBefore && after !== before && afterUndo === before &&
      afterRedo === after &&
      !state.placements.some(p => p.col === 20 && p.row === 20);
  });

  await t('copy-paste', async () => {
    // 框选覆盖 c22L(col2-5,row2) 与边框(col1-2,row1-2)
    selectTool('select');
    clipSel.rect = { c0: 0, r0: 1, c1: 5, r1: 3 };
    const n = copySelection();
    const cbOk = clipBoard.data && clipBoard.data.w === 6 &&
      clipBoard.data.placements.length === 1 && clipBoard.data.borders.length === 1;
    selectTool('paste');
    pasteAt(8, 6); // 以复制块左下角对齐 (8,6) 粘贴
    await tick();
    const ok = n === 1 && cbOk &&
      state.placements.some(p => p.sym === 'c22L' && p.col === 10 && p.row === 7) &&
      state.borders.some(b => b.col === 9 && b.row === 6 && b.w === 2 && b.h === 2);
    undo(); // 清理：撤销这次粘贴
    await tick();
    return ok;
  });

  await t('delete-selection', async () => {
    // 当前状态（copy-paste 清理后）：c22L@2,2 + 边框{1,1,2,2}
    selectTool('select');
    clipSel.rect = { c0: 0, r0: 1, c1: 5, r1: 3 };
    const n = deleteSelection();
    await tick();
    const ok = n === 2 && state.placements.length === 0 && state.borders.length === 0;
    clipSel.rect = null;
    selectTool('knit'); // 清理
    return ok;
  });

  await t('redo-button-state', async () => {
    // undo 后 canRedo 必须变为 true（曾因漏调 syncHistUI 导致重做按钮永远置灰）
    applyAt(6, 6);
    const canRedoBefore = histState.canRedo;
    undo();
    const canRedoAfterUndo = histState.canRedo;
    redo();
    const canRedoAfterRedo = histState.canRedo;
    undo(); // 清理
    return !canRedoBefore && canRedoAfterUndo && !canRedoAfterRedo;
  });

  await t('toolbar-buttons', async () => {
    // 工具栏按钮存在，且消去/边框已从符号面板移除
    const ids = ['btnUndo', 'btnRedo', 'btnCopy', 'btnPaste', 'btnDelete', 'btnAnnotate'];
    const allThere = ids.every(id => !!document.getElementById(id));
    const toolBtns = ['select', 'erase', 'border']
      .every(t => !!document.querySelector('[data-toolbtn="' + t + '"]'));
    const paletteClean = !document.querySelector('#palette .palette-btn[data-tool="erase"]') &&
      !document.querySelector('#palette .palette-btn[data-tool="border"]');
    return allThere && toolBtns && paletteClean;
  });

  await t('annotation-lifecycle', async () => {
    // 加标注 → 渲染 → 存档往返 → 消去删除
    selectTool('select');
    clipSel.rect = { c0: 2, r0: 4, c1: 5, r1: 6 };
    const added = addAnnotation('花样A·重复');
    await tick();
    const a = state.annotations[0];
    const renderOk = !!document.querySelector('#annoLayer text') &&
      a && a.col === 2 && a.row === 4 && a.w === 4 && a.h === 3;
    const snap = JSON.stringify(serializeChart());
    state.annotations = []; await tick(); // 载入前先清空制造差异
    applyChartJson(snap); await tick();
    const reloadOk = state.annotations.length === 1 &&
      state.annotations[0].text === '花样A·重复';
    selectTool('erase'); applyAt(3, 5); // 消去工具点击区域内 → 标注删除
    await tick();
    const eraseOk = state.annotations.length === 0;
    clipSel.rect = null; selectTool('knit');
    return added && renderOk && reloadOk && eraseOk;
  });

  await t('work-chart-lifecycle', async () => {
    // 在图解A放符号 → 新建图解B（自动切换、应为空）→ 切回A内容还在 → 重命名 → 删除B
    applyAt(10, 5);
    await tick();
    const w0 = activeWork();
    const idA = state.activeChartId;
    const idB = addChart();
    await tick();
    const emptyOk = state.activeChartId === idB && state.placements.length === 0 &&
      w0.charts.length === 2;
    switchChart(idA);
    await tick();
    const backOk = state.activeChartId === idA && state.placements.length === 1;
    renameChart(idA, '后片');
    await tick();
    const nameOk = w0.charts.find(c => c.id === idA).name === '后片' &&
      !!document.querySelector('.ctab.ctab-on') &&
      document.querySelector('.ctab.ctab-on .ctab-name').textContent === '后片';
    const delOk = deleteChart(idB) && w0.charts.length === 1 && state.activeChartId === idA;
    await tick();
    // 清理画布
    selectTool('erase'); applyAt(10, 5); selectTool('knit');
    await tick();
    return emptyOk && backOk && nameOk && delOk && state.placements.length === 0;
  });

  await t('work-add-delete', async () => {
    const n = state.works.length;
    addWork('测试作品');
    await tick();
    const w2 = activeWork();
    const added = state.works.length === n + 1 && w2.name === '测试作品' &&
      w2.charts.length === 1 && w2.charts[0].name === '图解 1';
    const del = deleteWork(w2.id);
    await tick();
    return added && del && state.works.length === n;
  });

  await t('work-json-roundtrip', async () => {
    // 整作品存档 → 打乱当前图解 → 载入为新作品 → 内容还原 → 清理
    applyAt(3, 3);
    await tick();
    const n = state.works.length;
    const snap = JSON.stringify(serializeWork());
    selectTool('erase'); applyAt(3, 3); selectTool('knit');
    await tick();
    const r = importJson(snap);
    await tick();
    const wNew = activeWork();
    const ok = r.works === 1 && r.charts === 1 && state.works.length === n + 1 &&
      state.placements.length === 1 &&
      state.placements[0].col === 3 && state.placements[0].row === 3;
    deleteWork(wNew.id);
    await tick();
    const cleanupOk = state.works.length === n;
    selectTool('erase'); applyAt(3, 3); selectTool('knit'); // 清理原作品里的符号
    await tick();
    return ok && cleanupOk && state.placements.length === 0;
  });

  await t('chart-import-as-new-tab', async () => {
    // v1 单图解档 → 追加为当前作品的新图解
    const nCharts = activeWork().charts.length;
    const v1 = JSON.stringify({
      app: 'knitting-chart', version: 1, name: '外来图解',
      rows: 20, cols: 15, rowStartSide: 'left',
      colLabels: { '2': 'X' },
      placements: [{ sym: 'knit', col: 1, row: 1, w: 1, h: 1 }],
      borders: [], annotations: [], customSymbols: [], hiddenSymbols: [],
    });
    const r = importJson(v1);
    await tick();
    const w = activeWork();
    const c = w.charts[w.charts.length - 1];
    const ok = r.charts === 1 && w.charts.length === nCharts + 1 &&
      c.name === '外来图解' && state.activeChartId === c.id &&
      state.cols === 15 && state.rows === 20 && state.rowStartSide === 'left' &&
      state.placements.length === 1 && labelFor(2) === 'X';
    deleteChart(c.id); // 清理
    await tick();
    return ok && w.charts.length === nCharts;
  });

  await t('legacy-ls-migrate', async () => {
    // 旧版扁平 localStorage 数据 → 载入时自动包装为单作品单图解
    localStorage.setItem(LS_KEY, JSON.stringify({
      rows: 20, cols: 15,
      placements: [{ sym: 'knit', col: 1, row: 1, w: 1, h: 1 }],
      borders: [], colOverrides: { '2': 'X' },
    }));
    load();
    await tick();
    const ok = state.works.length === 1 && state.works[0].charts.length === 1 &&
      state.works[0].name === '我的作品' && state.cols === 15 && state.rows === 20 &&
      state.placements.length === 1 && labelFor(2) === 'X' &&
      !!document.querySelector('.ctab');
    resetStateForTest(); // 恢复干净状态
    await tick();
    return ok;
  });

  await t('switch-perf-big-chart', async () => {
    // 200×200 + 2500 符号的大图解，切换渲染必须远小于用户可感的"几秒"
    resizeGrid(200, 200);
    for (let r = 1; r <= 50; r++) {
      for (let c = 0; c < 200; c += 4) {
        state.placements.push({ sym: 'k2tog', col: c, row: r, w: 1, h: 1 });
      }
    }
    save();
    await tick();
    const idBig = state.activeChartId;
    const idB = addChart();
    await tick();
    const t0 = performance.now();
    switchChart(idBig);
    await tick(); // 包含 Vue 渲染 flush
    window.__symLayer.redraw(); // 计入符号位图重绘（canvas 方案的实际渲染开销）
    const ms = performance.now() - t0;
    const cv = await symCanvasReady();
    const inkOk = !!cv && !!(await blockHasInk(cv, 0, state.rows - 8, 8, 8));
    /* 视口渲染核心保证：backing 必须是视口×dpr 满分辨率（不许按世界尺寸压缩） */
    const scr = document.querySelector('.canvas-scroll');
    const crispOk = !!scr && cv.width >= Math.round(scr.clientWidth * (window.devicePixelRatio || 1)) - 2;
    deleteChart(idB);
    await tick();
    resetStateForTest(); // 还原干净状态
    await tick();
    return inkOk && crispOk && ms < 2000 && state.placements.length === 0;
  });

  await t('chart-lock', async () => {
    // 锁定后：放置/擦除/边框/改网格/列号/撤销重做全部被拦截；解锁后恢复编辑
    selectTool('knit'); applyAt(3, 3); await tick();
    const n = state.placements.length, cols0 = state.cols;
    toggleChartLocked(); // 锁定
    applyAt(8, 8); eraseAt(3, 3); commitBorder(0, 1, 2, 2);
    resizeGrid(10, 10); setColLabel(2, 'x');
    undo(); redo(); // 若守卫失效，undo 会把 placements 退回空
    await tick();
    const okLocked = isChartLocked() && state.placements.length === n &&
      !state.borders.length && state.cols === cols0 && !labelFor(2);
    toggleChartLocked(); // 解锁
    applyAt(8, 8);
    await tick();
    return okLocked && !isChartLocked() && state.placements.length === n + 1;
  });

  await t('text-chart', async () => {
    // 小图解验证文字解：正面原样读（右→左）、反面转换读（左→右）、空白=背景针
    resizeGrid(6, 2);
    state.placements = [
      { sym: 'knit', col: 0, row: 1, w: 1, h: 1 },
      { sym: 'purl', col: 1, row: 1, w: 1, h: 1 },
      { sym: 'tws', col: 2, row: 1, w: 1, h: 1 },
      { sym: 'knit', col: 0, row: 2, w: 1, h: 1 },
      { sym: 'twist', col: 1, row: 2, w: 1, h: 1 },
    ];
    await tick();
    const rows = chartToTextRows(state);
    const ok1 = !rows[0].ws && rows[0].text === 'r1：3上针，1扭针，1上针，1下针';
    const ok2 = rows[1].ws && rows[1].text === 'r2（反面）：1上针，1上针的扭针，4下针';
    // 第1行起始=左 时奇偶对调：r1 变反面行，r2 变正面行
    state.rowStartSide = 'left';
    const rowsL = chartToTextRows(state);
    state.rowStartSide = 'right';
    const ok3 = rowsL[0].ws && rowsL[0].text === 'r1（反面）：1上针，1下针，1上针的扭针，3下针' &&
      !rowsL[1].ws && rowsL[1].text === 'r2：4上针，1扭针，1下针';
    resetStateForTest();
    await tick();
    return ok1 && ok2 && ok3;
  });

  await t('chart-updated-at', async () => {
    // 图解最后更改时间：图面操作计时；锁定切换/工具切换等非内容操作不计时
    resetStateForTest(); await tick();
    await new Promise(r => setTimeout(r, 12));
    const tCreate = activeChart().updatedAt;
    selectTool('knit'); await tick(); // 非内容操作
    const uTool = activeChart().updatedAt;
    applyAt(1, 1); await tick(); // 图面操作 → 计时
    const tEdit = activeChart().updatedAt;
    toggleChartLocked(); toggleChartLocked(); await tick(); // 锁定切换不计时
    const uLock = activeChart().updatedAt;
    await new Promise(r => setTimeout(r, 12));
    applyAt(2, 1); await tick();
    const uEdit2 = activeChart().updatedAt;
    const saved = JSON.parse(localStorage.getItem(LS_KEY))
      .works[0].charts.find(x => x.id === activeChart().id).updatedAt;
    resetStateForTest(); await tick();
    // saved 是第二次编辑落盘的值，应等于 uEdit2；锁定切换期间不被刷新
    return typeof tCreate === 'number' && uTool === tCreate && tEdit > tCreate &&
      uLock === tEdit && uEdit2 > tEdit && saved === uEdit2;
  });

  await t('home-view-navigation', async () => {
    // 作品管理页：卡片数量正确，点击卡片进入编辑页
    const n = state.works.length;
    ui.view = 'home';
    await tick();
    const cards = document.querySelectorAll('.work-card[data-wid]');
    const okCards = cards.length === n;
    cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60)); // withLoading 延迟 30ms
    await tick();
    return okCards && ui.view === 'editor' && !!document.getElementById('chart');
  });

  const pass = results.every(r => r.indexOf('PASS:') === 0);
  save(); // 把收尾的干净状态落盘，避免测试中途的大图解等残留在 localStorage
  const div = document.createElement('div');
  div.id = 'selftest';
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;font-size:18px;padding:10px;font-family:monospace;' +
    (pass ? 'background:#bbf7d0;color:#14532d' : 'background:#fecaca;color:#7f1d1d');
  div.textContent = 'SELF-TEST ' + (pass ? 'ALL PASS' : 'HAS FAIL') + ' => ' + results.join(' | ');
  document.body.appendChild(div);
  document.title = pass ? 'ALL PASS' : 'SOME FAIL';
}
