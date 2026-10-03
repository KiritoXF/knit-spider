/* 图解 → 文字解（逐行文字说明）。纯数据/纯函数模块，供弹窗与自测试直调。
   约定（与需求确认）：
   · 图解画的是正面外观；空白格 = 背景针：正面行织上针、反面行织下针
   · 反面行符号转换：下针↔上针互换，扭针→上针的扭针（上针的扭针→扭针），
     其余符号（交叉等）按面板原名输出
   · 正反面按「第1行起始侧」推算，与 ChartCanvas 行号渲染规则一致：
     行号在右 = 正面行（从右往左读、按图解原样），
     行号在左 = 反面行（从左往右读、符号转换）
   · 连续同名称合并计数，如 19下针、1左上两针交叉 */
import { SYMBOLS } from './symbols.js';

/* 反面行实际织法的符号 id 映射（正面 id → 反面 id）。
   图解画的是正面外观，反面行针织动作互换：下针↔上针；扭针(tws)↔上针的扭针(twp)。
   文字解分组的 sid 一律用「实际织法符号 id」——背景针正面=purl、反面=knit，
   教程图按 sid 直查即可，不依赖显示名（按名匹配会挂错图）。
   未列入的符号（交叉针等）正反面通用，sid 保持不变。 */
export const WS_SYM = {
  knit: 'purl', purl: 'knit',
  tws: 'twp', twp: 'tws',
};

/* 生效映射 = 默认 WS_SYM + 用户覆盖（state.wsMap，符号库「反面织法」配置）。
   覆盖值为 ''（空串）表示该符号改为正反面通用，删除默认映射；
   覆盖指向的符号若已不存在（自定义符号被删且未恢复），该条覆盖作废 */
export function effectiveWsMap(st) {
  const out = { ...WS_SYM };
  const ov = st && st.wsMap;
  if (ov) {
    const alive = id => !!SYMBOLS[id] || (st.customSymbols || []).some(c => c.id === id);
    for (const k in ov) {
      if (typeof ov[k] !== 'string') continue;
      if (ov[k] && alive(ov[k])) out[k] = ov[k];
      else delete out[k];
    }
  }
  return out;
}

export function symTextName(symId, customSymbols) {
  const s = SYMBOLS[symId] || (customSymbols || []).find(c => c.id === symId);
  return s ? s.name : symId;
}

/* 返回 [{r, ws, text}]：r 为行号（1 = 最底行），ws = 是否反面行 */
export function chartToTextRows(st) {
  const row1Right = st.rowStartSide !== 'left';
  /* 按行分桶：多行符号放进它覆盖的每一行。之后每行只扫本行的桶，
     总代价 O(Σ w·h)（≈符号覆盖面积），而不是旧行数×放置数（大图解 180 万次循环） */
  const buckets = Array.from({ length: st.rows + 1 }, () => []);
  for (const p of st.placements) {
    const h = p.h || 1, w = p.w || 1;
    const rEnd = Math.min(st.rows, p.row + h - 1);
    for (let r = Math.max(1, p.row); r <= rEnd; r++) buckets[r].push(p);
  }
  const rows = [];
  const wsMap = effectiveWsMap(st);
  for (let r = 1; r <= st.rows; r++) {
    const onRight = (r % 2 === 1) === row1Right;
    const ws = !onRight;
    /* 该行每格 → 放置。宽符号占满 [col, col+w-1] */
    const cell = new Map();
    for (const p of buckets[r]) {
      const w = p.w || 1;
      for (let i = 0; i < w; i++) cell.set(p.col + i, p);
    }
    const emitted = new Set(); // 宽符号只在其读向首格输出一次
    const groups = [];
    let cur = null;
    let noStCells = 0; // 本行「不编织」格数：不进文字解，也不计入针数
    const step = c => {
      const p = cell.get(c);
      let sid;
      if (p && p.sym === 'noSt') { noStCells++; return; }
      if (!p) {
        // 背景针：正面行织上针(purl)、反面行织下针(knit)——同样绑定实际织法符号 id
        sid = ws ? 'knit' : 'purl';
      } else {
        if (emitted.has(p)) return;
        emitted.add(p);
        sid = ws && wsMap[p.sym] ? wsMap[p.sym] : p.sym;
      }
      const name = symTextName(sid, st.customSymbols);
      if (cur && cur.name === name) cur.n++;
      else { cur = { name, n: 1, sid }; groups.push(cur); }
    };
    if (onRight) for (let c = st.cols - 1; c >= 0; c--) step(c);
    else for (let c = 0; c < st.cols; c++) step(c);
    rows.push({
      r, ws, groups,
      count: st.cols - noStCells, // 本行实际编织针数（被减掉的不算）
      text: 'r' + r + (ws ? '（反面）' : '') + '：' + groups.map(g => g.n + g.name).join('，'),
    });
  }
  return rows;
}

export function chartToText(st) {
  return chartToTextRows(st).map(x => x.text).join('\n');
}
