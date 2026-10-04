import { nextTick } from 'vue';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  state, resetStateForTest, labelFor, applyAt, eraseAt, commitBorder, selectTool,
  upsertCustom, deleteCustom, openEditor, closeEditor, getSym, LS_KEY,
  hideSymbol, restoreSymbol, paletteIds, serializeChart, applyChartJson, resizeGrid, toggleFav,
  undo, redo, histState, copySelection, deleteSelection, pasteAt, clipSel, clipBoard,
  addAnnotation, setColLabel, isChartLocked, toggleChartLocked,
  setDoneRows, stepDoneRows,
  activeWork, activeChart, addChart, switchChart, renameChart, deleteChart,
  addWork, deleteWork, serializeWork, importJson, importArchive, buildWorkZip, importChartCode, load, save, flushPersist,
  contentRev, chartCheckCode,
  THEMES, setTheme,
} from './store.js';
import { chartToCode, codeToChart } from './chartCode.js';
import { putTutorial, putTutorialText, deleteTutorial, deleteTutorialText, tutorialObjectUrl, tutorialU8Entries, tutorialTextEntries } from './tutorialStore.js';
import { ui, ed } from './ui.js';
import { chartToTextRows } from './textChart.js';
import { tutorialUrlForGroup, tutorialUrlForSid, tutorialTextForGroup, tutorialTextForSid } from './tutorials.js';
import { SYMBOLS, PALETTE_ORDER } from './symbols.js';
import { symDataUrl } from './util.js';

/* ---------------- 自测试：访问 ?test=1 时由 main.js 调用（Vue 响应式渲染，全程 async） ---------------- */
export async function runSelfTest() {
  /* 后台/被遮挡窗口的 requestAnimationFrame 会永久冻结：瓦片层的 schedule/
     ready() 都挂在 rAF 上，会假死在 await L.ready()（自动化测试常见）。
     测试环境下改用 setTimeout 模拟 16ms 帧，保证任何窗口状态都能跑 */
  if (!window.__rafFallback) {
    window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
    window.__rafFallback = true;
  }
  const results = [];
  const tick = () => nextTick();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const t = async (name, fn) => {
    let ok = false;
    try { ok = !!(await fn()); } catch (e) { results.push('ERR:' + name + ':' + e.message); return; }
    results.push((ok ? 'PASS:' : 'FAIL:') + name);
  };

  localStorage.clear();
  resetStateForTest();
  ui.view = 'editor'; // 自测试需要画布 DOM，先切到编辑页
  await tick();

  /* ---- canvas 符号层断言助手：同步建图缓存 → 等位图解码 → 重绘 → 取像素 ----
     符号层已瓦片化（16 格/块，tileLayer.js）：symCanvasReady 返回 #symLayer 容器；
     blockHasInk 按格子坐标定位所在瓦片（data-tc/data-tr），对块与瓦片的交集采样 */
  const TILE = 16, CELL_PX = 28;
  const symCanvasReady = async (c0, ty) => {
    await tick();
    const L = window.__symLayer;
    if (!L) return null;
    /* 瓦片只渲染可视区：断言目标格若在视口外，先把该格滚进可视区 */
    if (c0 !== undefined) {
      const sc = document.querySelector('.canvas-scroll');
      if (sc) {
        const p = CELL_PX * state.zoom;
        sc.scrollLeft = Math.max(0, (c0 - 2) * p);
        sc.scrollTop = Math.max(0, (ty - 2) * p);
      }
    }
    L.redraw();
    await L.ready();
    L.redraw();
    return document.getElementById('symLayer');
  };
  /* 格块内采样（向内缩 18% 避开边缘网格线/外框）：test(r,g,b,a) 任一像素命中即真。
     块可跨瓦片：对覆盖的每个瓦片采样其与块的交集，任一命中即真 */
  const blockHasInk = (cv, c0, ty, wCells, hCells, test = (r, g, b, a) => a > 8) => {
    if (!cv) return false;
    const px = CELL_PX * state.zoom;
    const cols = state.cols, rows = state.rows;
    const tcs0 = Math.floor(c0 / TILE), tcs1 = Math.floor((c0 + wCells - 1) / TILE);
    const trs0 = Math.floor(ty / TILE), trs1 = Math.floor((ty + hCells - 1) / TILE);
    for (let tr = trs0; tr <= trs1; tr++) for (let tc = tcs0; tc <= tcs1; tc++) {
      const el = cv.querySelector(`canvas[data-tc="${tc}"][data-tr="${tr}"]`);
      if (!el || !el.width || !el.height) continue;
      const oc = tc * TILE, or = tr * TILE;
      const aCols = Math.min(TILE, cols - oc), aRows = Math.min(TILE, rows - or);
      const cx0 = Math.max(c0, oc), cx1 = Math.min(c0 + wCells, oc + aCols);
      const cy0 = Math.max(ty, or), cy1 = Math.min(ty + hCells, or + aRows);
      if (cx1 <= cx0 || cy1 <= cy0) continue;
      const s = el.width / (aCols * px); // 该瓦片 backing / CSS 像素比
      const x = Math.round((cx0 - oc + 0.18) * px * s);
      const y = Math.round((cy0 - or + 0.18) * px * s);
      const w = Math.max(1, Math.round((cx1 - cx0 - 0.36) * px * s));
      const h = Math.max(1, Math.round((cy1 - cy0 - 0.36) * px * s));
      const d = el.getContext('2d').getImageData(x, y, w, h).data;
      for (let i = 0; i < d.length; i += 4) if (test(d[i], d[i + 1], d[i + 2], d[i + 3])) return true;
    }
    return false;
  };
  const RED_PIX = (r, g, b, a) => a > 200 && r > 170 && g < 90 && b < 90;

  await t('place-knit', async () => {
    applyAt(10, 5);
    const cv = await symCanvasReady(10, state.rows - 5);
    return state.placements.length === 1 && !!cv &&
      blockHasInk(cv, 10, state.rows - 5, 1, 1) &&   // 该格有符号笔迹
      !blockHasInk(cv, 0, state.rows - 1, 1, 1);     // 空白格无笔迹
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
    // 行号已虚拟化（只渲染可视区±2 格），行号 1/2 在图解底部，先滚到底。
    // 用 __chartVis.update 同步刷新可视范围（scroll→rAF 链在节流环境下时序不定）
    const sc = document.querySelector('.canvas-scroll');
    const vis = window.__chartVis;
    const goBottom = async () => {
      sc.scrollTop = 999999;
      if (vis) vis.update();
      await tick();
    };
    await goBottom();
    const r1right0 = document.querySelector('.rownum[data-r="1"]').getAttribute('x') === String(state.cols + 0.45);
    const r2left0 = document.querySelector('.rownum[data-r="2"]').getAttribute('x') === '-0.45';
    state.rowStartSide = 'left'; await goBottom();
    const leftOk = document.querySelector('.rownum[data-r="1"]').getAttribute('x') === '-0.45';
    const r2right = document.querySelector('.rownum[data-r="2"]').getAttribute('x') === String(state.cols + 0.45);
    state.rowStartSide = 'right'; await goBottom();
    const rightOk = document.querySelector('.rownum[data-r="1"]').getAttribute('x') === String(state.cols + 0.45);
    sc.scrollTop = 0;
    if (vis) vis.update();
    await tick();
    return r1right0 && r2left0 && leftOk && r2right && rightOk;
  });
  await t('collabel-pointerdown', async () => {
    const oldPrompt = window.prompt;
    window.prompt = () => '7';
    let el = document.querySelector('.colhit[data-c="4"]');
    if (!el) {
      // 诊断：虚拟化列号应在可视范围内，若缺失记录现场
      const sc = document.querySelector('.canvas-scroll');
      window.__colDbg = {
        n: document.querySelectorAll('.colhit').length,
        cs: [...document.querySelectorAll('.colhit')].map(x => x.dataset.c).join(','),
        sl: sc && sc.scrollLeft, st: sc && sc.scrollTop,
        cw: sc && sc.clientWidth, cols: state.cols, zoom: state.zoom,
      };
      sc.scrollLeft = 0; sc.scrollTop = 0;
      if (window.__chartVis) window.__chartVis.update();
      await tick();
      el = document.querySelector('.colhit[data-c="4"]');
    }
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    window.prompt = oldPrompt;
    await tick();
    const ok = labelFor(4) === '7' && document.querySelector('.colnum[data-c="4"]').textContent === '7';
    state.colLabels = { ...state.colLabels }; delete state.colLabels['4']; await tick();
    return ok;
  });
  await t('place-cable-2x2', async () => {
    selectTool('c22L'); applyAt(2, 2); selectTool('knit');
    const cv = await symCanvasReady(2, state.rows - 2);
    const p = state.placements[1];
    return state.placements.length === 2 && !!p && p.col === 2 && p.row === 2 &&
      p.w === 4 && p.h === 1 && !!cv && blockHasInk(cv, 2, state.rows - 2, 4, 1);
  });
  await t('oob-reject', () => {
    selectTool('c22L'); applyAt(state.cols - 1, 1); selectTool('knit');
    return state.placements.length === 2;
  });
  await t('highlight-row3-click', async () => {
    // 行号 3 在图解底部，虚拟化后需先滚到底再点
    const sc = document.querySelector('.canvas-scroll');
    sc.scrollTop = 999999;
    if (window.__chartVis) window.__chartVis.update();
    await tick();
    const el = document.querySelector('.rownum[data-r="3"]');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const ok = state.highlight === 3 && !!document.querySelector('#hlLayer rect') &&
      (flushPersist(), JSON.parse(localStorage.getItem(LS_KEY)).highlight === 3);
    sc.scrollTop = 0;
    if (window.__chartVis) window.__chartVis.update();
    await tick();
    return ok;
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
    const cv = await symCanvasReady(4, state.rows - 11);
    const p = state.placements.find(x => x.sym === id);
    return !!p && p.w === 3 && p.h === 2 &&
      !!document.querySelector('.palette-btn[data-tool="' + id + '"]') &&
      !!cv && blockHasInk(cv, 4, state.rows - 11, 3, 2, RED_PIX);
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
    const cv = await symCanvasReady(4, state.rows - 6);
    const p = state.placements.find(x => x.sym === id);
    const ok = !!p && !!cv &&
      decodeURIComponent(symDataUrl(getSym(id))).includes('M0 0 C1 0 2 3 3 3') &&
      blockHasInk(cv, 4, state.rows - 6, 3, 3, RED_PIX);
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
    state.colLabels = { ...state.colLabels, '2': 'A' }; await tick();
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
    // 400×400 + 1 万符号的大图解，切换渲染必须远小于用户可感的"几秒"
    resizeGrid(400, 400); // 新上限：瓦片渲染必须扛住 400×400
    const bulk = [];
    for (let r = 1; r <= 100; r++) {
      for (let c = 0; c < 400; c += 4) {
        bulk.push({ sym: 'k2tog', col: c, row: r, w: 1, h: 1 });
      }
    }
    state.placements = state.placements.concat(bulk); // 整体替换（撤销按引用追踪）
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
    const cv = await symCanvasReady(0, state.rows - 8);
    const inkOk = !!cv && blockHasInk(cv, 0, state.rows - 8, 8, 8);
    deleteChart(idB);
    await tick();
    resetStateForTest(); // 还原干净状态
    await tick();
    return inkOk && ms < 2000 && state.placements.length === 0;
  });

  await t('big-chart-edit-perf', async () => {
    // 120×150 满图（9000 放置）下的编辑与粘贴必须迅速返回。曾有两处把大图拖垮：
    // ① 每次 save 做 4~5 次全量 stringify（含整个作品树落 localStorage）；
    // ② 粘贴对每个新符号 filter 一遍全数组（O(放置数×粘贴数)）。
    // 阈值取得很宽松（约 5~10 倍余量），只拦「退化成秒级」的算法性回归
    resizeGrid(120, 150);
    const bulk = [];
    for (let r = 1; r <= 150; r++)
      for (let c = 0; c < 120; c += 2)
        bulk.push({ sym: 'k2tog', col: c, row: r, w: 1, h: 1 });
    state.placements = state.placements.concat(bulk); // 整体替换（撤销按引用追踪）
    save(); await tick();
    // 手绘/擦除：连续 100 次落格
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) applyAt(1 + (i % 118), 1 + ((i * 7) % 150));
    const editMs = performance.now() - t0;
    await tick();
    // 框选 30×60 个符号并整块粘贴到右侧
    clipSel.rect = { c0: 0, r0: 1, c1: 59, r1: 60 };
    const n = copySelection();
    const t1 = performance.now();
    pasteAt(60, 1);
    const pasteMs = performance.now() - t1;
    await tick();
    // 文字解：正文生成曾按「行数×放置数」全量扫描（150×9000≈135 万次），
    // 打开弹窗时卡住主线程
    const t2 = performance.now();
    chartToTextRows(state);
    const textMs = performance.now() - t2;
    const t3 = performance.now();
    ui.textChartOpen = true; await tick();
    const openMs = performance.now() - t3;
    ui.textChartOpen = false; await tick();
    // 单次点击（落一格）的端到端耗时：applyAt + Vue 刷新（画布/顶栏等 watchEffect）。
    // 顶栏校验码曾在这里把整个图解 JSON.stringify 一遍来注册响应依赖，加上
    // deflate+SHA-256，每点一下堵主线程数十毫秒，表现为「卡 + 攒几笔才生效」
    selectTool('knit');
    const t4 = performance.now();
    for (let i = 0; i < 20; i++) { applyAt(2 + i * 5, 149); await tick(); }
    const clickMs = (performance.now() - t4) / 20;
    window.__bigChartPerf = JSON.stringify({ placements: state.placements.length, n, editMs, pasteMs, textMs, openMs, clickMs });
    const ok = n > 0 && editMs < 1500 && pasteMs < 800 && textMs < 200 && openMs < 3000 && clickMs < 25;
    resetStateForTest(); // 还原干净状态
    await tick();
    return ok;
  });

  await t('overwrite-redraw', async () => {
    // 同格覆盖绘制（长度不变）：画布必须立刻重绘。曾把重绘依赖写成
    // placements.length，覆盖时长度不变导致漏触发，改动攒到下次编辑才出现
    resetStateForTest(); await tick();
    selectTool('knit'); applyAt(2, 2); await tick();
    const ty = state.rows - 2;
    let cv = await symCanvasReady(5, ty);
    const blankBefore = !blockHasInk(cv, 5, ty, 1, 1); // knit 只有 1 格，col5 应空白
    selectTool('c22L'); applyAt(2, 2); await tick();   // 4×1 交叉针覆盖同格
    cv = await symCanvasReady(5, ty);
    const inkAfter = blockHasInk(cv, 5, ty, 1, 1);     // col5 出现墨迹 = 重绘已发生
    selectTool('knit');
    resetStateForTest(); await tick();
    return blankBefore && inkAfter;
  });

  await t('dirty-region-neighbors', async () => {
    // 脏区增量重渲回归：编辑格所在瓦片里、编辑矩形之外的相邻符号必须保留。
    // 曾按「瓦片清桶、矩形回填」导致同瓦片邻居从渲染中消失
    resetStateForTest(); await tick();
    selectTool('knit');
    applyAt(1, 2); applyAt(2, 2); applyAt(20, 2); // 三枚 knit；col20 在下一块瓦片
    applyAt(5, 2); // 在同瓦片内、与已有符号不相交的位置再落一格
    await tick();
    const ty = state.rows - 2;
    const cv = await symCanvasReady(20, ty);
    const ok = !!cv &&
      blockHasInk(cv, 1, ty, 1, 1) && blockHasInk(cv, 2, ty, 1, 1) &&
      blockHasInk(cv, 5, ty, 1, 1) && blockHasInk(cv, 20, ty, 1, 1);
    selectTool('knit');
    resetStateForTest(); await tick();
    return ok;
  });

  await t('tile-straddle-cable', async () => {
    // 跨瓦片宽符号（4×1 交叉针骑在 16 格瓦片边界上）必须完整渲染：
    // 两块各画裁剪段，拼缝处像素连续、无双线无缝
    resetStateForTest(); await tick();
    resizeGrid(40, 20); // 瓦片边界在 col16/row(顶部数)16
    const col = 14;     // 足迹 [14,17] 跨 col16 边界
    const row = 10;
    selectTool('c22L'); applyAt(col, row); await tick();
    const ty = state.rows - row;
    const cv = await symCanvasReady(15, ty);
    // 符号 4 格宽：col14..17，每格都应有墨迹（含边界两侧的 15/16 列）
    const ok = blockHasInk(cv, 14, ty, 1, 1) && blockHasInk(cv, 15, ty, 1, 1) &&
      blockHasInk(cv, 16, ty, 1, 1) && blockHasInk(cv, 17, ty, 1, 1);
    selectTool('knit');
    resetStateForTest(); await tick();
    return ok;
  });

  await t('content-rev', async () => {
    // 顶栏校验码的响应依赖：从「每次编辑把整个图解 JSON.stringify 一遍」换成
    // store 的 contentRev（O(1)）。要求——图面内容变化必自增；纯会话态变化
    // （换工具）不得自增；撤销/重做（改回图面内容）也要自增
    const r0 = contentRev.n;
    selectTool('knit'); applyAt(3, 3); await tick();
    const r1 = contentRev.n;
    selectTool('erase'); await tick();          // 换工具：非内容变化
    const r2 = contentRev.n;
    const c1 = await chartCheckCode();
    selectTool('knit'); applyAt(6, 6); await tick();
    const r3 = contentRev.n;
    const c2 = await chartCheckCode();
    undo(); await tick();
    const r4 = contentRev.n;
    const ok = r1 > r0 && r2 === r1 && r3 > r2 && r4 > r3 &&
      /^[0-9a-f]{8}$/.test(c1) && c2 !== c1;
    resetStateForTest(); await tick();
    return ok;
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
      { sym: 'tws', col: 1, row: 2, w: 1, h: 1 },
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
    // 分组 sid = 实际织法符号 id：背景针正面 purl / 反面 knit；反面符号经 WS_SYM 映射
    // （r1 正面：空白×3→purl、tws→tws、purl→purl、knit→knit；
    //  r2 反面：knit→purl、tws→twp、空白×4→knit）
    const sidOk =
      JSON.stringify(rows[0].groups.map(g => g.sid)) === JSON.stringify(['purl', 'tws', 'purl', 'knit']) &&
      JSON.stringify(rows[1].groups.map(g => g.sid)) === JSON.stringify(['purl', 'twp', 'knit']);
    // c22L 已无内置教程图：未配置返回 null（本机若上传过则是 objectURL）
    const c22 = tutorialUrlForSid('c22L');
    // 教程纯按 sid 解析：分组 sid 与直查结果一致；无 sid/空组返回 null
    const purlUrl = tutorialUrlForSid('purl');
    const twpUrl = tutorialUrlForSid('twp');
    const tutOk = (c22 === null || String(c22).indexOf('blob:') === 0) &&
      tutorialUrlForGroup({ sid: 'purl', name: '上针' }) === purlUrl &&
      tutorialUrlForGroup({ sid: 'twp', name: '上针的扭针' }) === twpUrl &&
      tutorialUrlForGroup({ sid: null, name: '上针' }) === null &&
      tutorialUrlForGroup(null) === null;
    // 反面织法用户覆盖（符号库「反面织法」配置）：knit→twp、tws→通用
    // 原本 r2 反面 sid 序列为 ['purl','twp','knit']（knit→purl、tws→twp、背景 knit）；
    // 覆盖后 knit→twp、tws 不再换算 → ['twp','tws','knit']
    state.wsMap = { knit: 'twp', tws: '' };
    const rowsM = chartToTextRows(state);
    const wsMapOk = JSON.stringify(rowsM[1].groups.map(g => g.sid)) === JSON.stringify(['twp', 'tws', 'knit']);
    resetStateForTest();
    await tick();
    return ok1 && ok2 && ok3 && sidOk && tutOk && wsMapOk;
  });

  await t('chart-code-roundtrip', async () => {
    // 图解代码：往返无损（宽/多行符号、边框、含转义字符的标注、列号、自定义符号）
    resetStateForTest(); await tick();
    const cid = upsertCustom({ name: '码上麻花', w: 2, h: 1, shapes: [
      { type: 'line', x1: 0, y1: 0, x2: 2, y2: 1, color: '#d00000', w: 0.08 } ] });
    selectTool('knit'); applyAt(0, 1); applyAt(1, 1); applyAt(2, 1); // 同行连块 → RLE
    selectTool(cid); applyAt(0, 2);
    selectTool('c22L'); applyAt(4, 3); // 宽符号
    selectTool('purl'); applyAt(6, 4);
    commitBorder(0, 0, 3, 3);
    addAnnotation('中\n心;测试,转\\义:!感叹');
    setColLabel(2, '甲,乙');
    const chart = JSON.parse(JSON.stringify(activeChart()));
    chart.rowStartSide = 'left';
    const code = await chartToCode(chart, state.customSymbols);
    const { chart: back, customRefs } = await codeToChart(code);
    /* KC2 按「格内容」编码：解码侧会把同行同符号连块合并成宽放置，
       且一个宽放置与多个 1×1 等价——所以比较基准用格内容矩阵而非放置对象 */
    const cellsOf = c => {
      const g = Array.from({ length: c.rows }, () => Array(c.cols).fill(null));
      for (const p of c.placements)
        for (let dy = 0; dy < (p.h || 1); dy++)
          for (let dx = 0; dx < (p.w || 1); dx++)
            g[p.row - 1 + dy][p.col + dx] = p.sym === '~0' ? cid : p.sym;
      return g;
    };
    const okRt = eq({ rows: back.rows, cols: back.cols, rowStartSide: back.rowStartSide,
        colLabels: back.colLabels, borders: back.borders, annotations: back.annotations,
        cells: cellsOf(back) },
      { rows: chart.rows, cols: chart.cols, rowStartSide: chart.rowStartSide,
        colLabels: chart.colLabels, borders: chart.borders, annotations: chart.annotations,
        cells: cellsOf(chart) }) &&
      customRefs.length === 1 && customRefs[0].name === '码上麻花' &&
      code.startsWith('KC2!');
    // 确定性：打乱 placements 顺序重编仍同串
    const shuffled = { ...chart, placements: [...chart.placements].reverse() };
    const okDet = await chartToCode(shuffled, state.customSymbols) === code;
    // 篡改 → TAMPERED
    let kind = '';
    try { await codeToChart(code.slice(0, -2) + 'zz'); } catch (e) { kind = e.kind; }
    const okTamper = kind === 'TAMPERED';
    deleteCustom(cid); await tick();
    resetStateForTest(); await tick();
    return okRt && okDet && okTamper;
  });

  await t('chart-code-import', async () => {
    // 图解代码导入：追加为新图解；缺自定义符号报 MISSING_CUSTOM 且名单正确
    resetStateForTest(); await tick();
    const nCharts0 = activeWork().charts.length;
    const code = await chartToCode({
      rows: 8, cols: 6, rowStartSide: 'right', colLabels: {},
      placements: [{ sym: 'knit', col: 0, row: 1, w: 1, h: 1 }],
      borders: [], annotations: [],
    }, []);
    const id1 = await importChartCode(' \n ' + code + ' '); // 夹带空白应容错
    await tick();
    const okAppend = activeWork().charts.length === nCharts0 + 1 &&
      state.activeChartId === id1 && activeChart().rows === 8 && activeChart().cols === 6 &&
      state.placements.length === 1 && state.placements[0].sym === 'knit';
    // 引用自定义符号的代码：本机没有 → MISSING_CUSTOM
    const cid = 'custom_absent';
    const codeC = await chartToCode({
      rows: 8, cols: 6, rowStartSide: 'right', colLabels: {},
      placements: [{ sym: cid, col: 0, row: 1, w: 1, h: 1 }],
      borders: [], annotations: [],
    }, [{ id: cid, name: '不存在的符号', w: 1, h: 1, shapes: [] }]);
    let kind = '', names = [];
    try { await importChartCode(codeC); } catch (e) { kind = e.kind; names = e.detail; }
    const okMissing = kind === 'MISSING_CUSTOM' && eq(names, ['不存在的符号']);
    resetStateForTest(); await tick();
    return okAppend && okMissing;
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
    flushPersist();
    const saved = JSON.parse(localStorage.getItem(LS_KEY))
      .works[0].charts.find(x => x.id === activeChart().id).updatedAt;
    resetStateForTest(); await tick();
    // saved 是第二次编辑落盘的值，应等于 uEdit2；锁定切换期间不被刷新
    return typeof tCreate === 'number' && uTool === tCreate && tEdit > tCreate &&
      uLock === tEdit && uEdit2 > tEdit && saved === uEdit2;
  });

  await t('done-rows', async () => {
    // 织进度：工具条 ＋/－ 与文字解左栏步进器都写回 doneRows 并落盘；改进度不算「最后更改」，
    // 行数缩减时自动收敛，图解 JSON / zip 存档往返带回进度
    resetStateForTest(); await tick();
    await new Promise(r => setTimeout(r, 12));
    const tCreate = activeChart().updatedAt;
    const next = document.getElementById('btnDoneNext');
    next.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    next.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const okStep = state.doneRows === 2 && activeChart().updatedAt === tCreate &&
      (flushPersist(), JSON.parse(localStorage.getItem(LS_KEY)).works[0].charts[0].doneRows === 2) &&
      document.getElementById('doneRowsText').textContent.replace(/\s/g, '') === '2/36' &&
      document.getElementById('btnDonePrev').disabled === false;
    // 撤回应只回退图面内容，不动织进度（进度不进撤销快照）
    applyAt(1, 1); await tick();
    undo(); await tick();
    const okUndo = state.doneRows === 2 && state.placements.length === 0;
    // 文字解：左栏步进器改进度；已织行淡化、当前待织行高亮带「下一行」；
    // 正文里不再有勾选框，进度只靠高亮体现。
    // 打开有「正在生成文字解」过渡（大图解重算可感），先等它结束
    ui.textChartOpen = true; await tick();
    for (let i = 0; i < 200 && document.getElementById('tcmGen'); i++)
      await new Promise(r => setTimeout(r, 20));
    for (let i = 0; i < 4; i++) {
      document.getElementById('tcDoneNext').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await tick();
    }
    const okCheck = state.doneRows === 6 &&
      document.querySelectorAll('.tcm-row-done').length === 6 &&
      document.querySelector('.tcm-row-cur .tcm-rno').textContent === 'r7' &&
      document.querySelector('#tcProgNum').value === '6';
    // 编织进度（针数口径）：24 列全按背景针计，6/36 行已织 → 剩 720 针、已织 144/864（17%）
    const stNum = document.querySelector('.tcm-prog-st-num');
    const okStitch = !!stNum && stNum.querySelector('b').textContent === '720' &&
      /已织\s*144\s*\/\s*864（17%）/.test(stNum.textContent.replace(/\s+/g, ' ')) &&
      !!document.querySelector('.tcm-prog-bar i');
    // 退回一行
    document.getElementById('tcDonePrev').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const okBack = state.doneRows === 5 &&
      document.querySelectorAll('.tcm-row-done').length === 5 &&
      document.querySelector('.tcm-row-cur .tcm-rno').textContent === 'r6' &&
      document.querySelectorAll('.tcm-check').length === 0;
    // 计数器可直接输入：合法值生效、非法值还原
    const progInput = document.getElementById('tcProgNum');
    progInput.value = '10';
    progInput.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    const okProgInput = state.doneRows === 10 && progInput.value === '10';
    progInput.value = 'abc';
    progInput.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    const okProgRevert = state.doneRows === 10 && progInput.value === '10';
    ui.textChartOpen = false; await tick();
    // 越界收敛 + 行数缩减
    setDoneRows(999); await tick();
    const okMax = state.doneRows === state.rows;
    resizeGrid(state.cols, 5); await tick();
    const okShrink = state.doneRows === 5;
    // 存档往返：v1 单图解 JSON 带 doneRows，zip 作品包（v2）里的图解也带
    setDoneRows(3);
    const okV1 = serializeChart().doneRows === 3;
    const zipSaved = JSON.parse(strFromU8(unzipSync(await buildWorkZip())['work.json']));
    const okV2 = zipSaved.works[0].charts[0].doneRows === 3;
    resetStateForTest(); await tick();
    if (!(okStep && okUndo && okCheck && okStitch && okBack && okProgInput && okProgRevert &&
        okMax && okShrink && okV1 && okV2))
      window.__doneDetail = JSON.stringify({ okStep, okUndo, okCheck, okStitch, okBack, okProgInput, okProgRevert, okMax, okShrink, okV1, okV2 });
    return okStep && okUndo && okCheck && okStitch && okBack && okProgInput && okProgRevert &&
      okMax && okShrink && okV1 && okV2;
  });

  await t('zip-roundtrip', async () => {
    // 作品 zip 导出/导入往返：work.json + 用户教程（图 + 文字说明）打包，导入后全部还原
    window.__zipDetail = null;
    try {
      resetStateForTest(); await tick();
      const aw0 = activeWork();
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      await putTutorial('zztest', new Blob([bytes], { type: 'image/png' }), 'zztest.png');
      await putTutorialText('zztest', '滑一针不织，线在前方');
      await putTutorialText('zztest2', '纯文字教程，无图片'); // 纯文字记录（无图）
      const u8 = await buildWorkZip();
      const entries = unzipSync(u8);
      const saved = JSON.parse(strFromU8(entries['work.json']));
      const okZip = !!entries['work.json'] && !!entries['tutorials/zztest.png'] &&
        !!entries['tutorials/zztest.txt'] && !!entries['tutorials/zztest2.txt'] &&
        !entries['tutorials/zztest2.png'] &&
        strFromU8(entries['tutorials/zztest.txt']) === '滑一针不织，线在前方' &&
        tutorialTextForGroup({ sid: 'zztest', name: 'x' }) === '滑一针不织，线在前方' &&
        tutorialTextForGroup(null) === null &&
        saved.version === 2 && saved.works.length === 1;
      // zip 里带的是整个本机教程库（含既有上传），条数不定，按实际数量比对
      const nTut = (await tutorialU8Entries()).length;
      const nTxt = tutorialTextEntries().length;
      const nWorks0 = state.works.length;
      const res = await importArchive(new Blob([u8], { type: 'application/zip' }));
      const wNew = activeWork(); // 导入后新作品成为活动作品（importJson → switchWork）
      const okImp = res.works === 1 && res.charts >= 1 && res.tutorials === nTut &&
        res.tutorialTexts === nTxt &&
        state.works.length === nWorks0 + 1 &&
        !!wNew && wNew.id !== aw0.id &&
        String(tutorialObjectUrl('zztest')).indexOf('blob:') === 0 &&
        tutorialTextForSid('zztest') === '滑一针不织，线在前方' &&
        tutorialUrlForSid('zztest2') === null && // 纯文字记录无图
        tutorialTextForSid('zztest2') === '纯文字教程，无图片';
      // 缺 work.json 的 zip 应报错
      let okErr = false;
      try { await importArchive(new Blob([zipSync({ 'other.txt': strToU8('x') })])); }
      catch (e) { okErr = true; }
      if (!(okZip && okImp && okErr))
        window.__zipDetail = JSON.stringify({ okZip, okImp, okErr, nTut, nTxt, nWorks0, res,
          awId: aw0 && aw0.id, newWid: wNew && wNew.id, aw: !!activeWork() });
      return okZip && okImp && okErr;
    } catch (e) {
      window.__zipDetail = 'THROW: ' + String(e && e.stack || e);
      return false;
    } finally {
      await deleteTutorial('zztest');      // 删图（文字保留）
      await deleteTutorialText('zztest');  // 再删字 → 整条记录消失
      await deleteTutorialText('zztest2'); // 纯文字记录清理
      resetStateForTest(); await tick();
    }
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

  await t('theme', async () => {
    // 配色主题：切主题只改 <html data-theme>，色值全在 CSS 里；
    // 选择随 localStorage 记住，load() 时还原并重新应用
    resetStateForTest(); await tick();
    const ids = THEMES.map(x => x.id);
    const okIds = ids.length === 4 && ids[0] === 'sage';
    const okDefault = state.theme === 'sage' &&
      document.documentElement.dataset.theme === 'sage';
    // 端到端证明 @theme 重映射 + data-theme 真的让 Tailwind 类跟着变
    const probe = document.createElement('div');
    probe.className = 'text-rose-600';
    document.body.appendChild(probe);
    setTheme('mist'); await tick();
    const cMist = getComputedStyle(probe).color;
    setTheme('sage'); await tick();
    const cSage = getComputedStyle(probe).color;
    probe.remove();
    const okCss = cMist !== cSage && cSage === 'rgb(63, 122, 95)'; // #3f7a5f
    setTheme('mist'); await tick();
    const okSet = state.theme === 'mist' &&
      document.documentElement.dataset.theme === 'mist' &&
      (flushPersist(), JSON.parse(localStorage.getItem(LS_KEY)).theme === 'mist');
    const t0 = activeChart().updatedAt;
    setTheme('mauve'); await tick();
    const okNoTrack = activeChart().updatedAt === t0; // 换配色不算「最后更改」
    setTheme('nope'); await tick();
    const okBad = state.theme === 'mauve';            // 未知 id 直接忽略
    // 模拟刷新：先把 mauve 落盘（写入已防抖），再清掉内存状态，load() 应从 localStorage 还原
    flushPersist();
    state.theme = 'sage';
    document.documentElement.dataset.theme = 'sage';
    state.works = []; state.activeWorkId = null; state.activeChartId = null;
    load(); await tick();
    const okLoad = state.theme === 'mauve' &&
      document.documentElement.dataset.theme === 'mauve';
    resetStateForTest(); await tick();
    if (!(okIds && okDefault && okCss && okSet && okNoTrack && okBad && okLoad))
      window.__themeDetail = JSON.stringify({ okIds, okDefault, okCss, cMist, cSage, okSet, okNoTrack, okBad, okLoad });
    return okIds && okDefault && okCss && okSet && okNoTrack && okBad && okLoad;
  });

  const pass = results.every(r => r.indexOf('PASS:') === 0);
  save(); flushPersist(); // 把收尾的干净状态落盘，避免测试中途的大图解等残留在 localStorage
  const div = document.createElement('div');
  div.id = 'selftest';
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;font-size:18px;padding:10px;font-family:monospace;' +
    (pass ? 'background:#bbf7d0;color:#14532d' : 'background:#fecaca;color:#7f1d1d');
  div.textContent = 'SELF-TEST ' + (pass ? 'ALL PASS' : 'HAS FAIL') + ' => ' + results.join(' | ');
  document.body.appendChild(div);
  document.title = pass ? 'ALL PASS' : 'SOME FAIL';
}
