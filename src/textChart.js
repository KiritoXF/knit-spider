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

/* 反面行的符号名称映射（按符号 id） */
const WS_NAME = {
  knit: '上针', purl: '下针',
  tws: '上针的扭针', twist: '上针的扭针', twp: '扭针',
};

export function symTextName(symId, customSymbols) {
  const s = SYMBOLS[symId] || (customSymbols || []).find(c => c.id === symId);
  return s ? s.name : symId;
}

/* 返回 [{r, ws, text}]：r 为行号（1 = 最底行），ws = 是否反面行 */
export function chartToTextRows(st) {
  const row1Right = st.rowStartSide !== 'left';
  const rows = [];
  for (let r = 1; r <= st.rows; r++) {
    const onRight = (r % 2 === 1) === row1Right;
    const ws = !onRight;
    /* 该行每格 → 放置。宽符号占满 [col, col+w-1]；多行符号（h>1）占据 row..row+h-1 */
    const cell = new Map();
    for (const p of st.placements) {
      const h = p.h || 1;
      if (p.row > r || p.row + h <= r) continue;
      for (let i = 0; i < (p.w || 1); i++) cell.set(p.col + i, p);
    }
    const emitted = new Set(); // 宽符号只在其读向首格输出一次
    const groups = [];
    let cur = null;
    const step = c => {
      const p = cell.get(c);
      let name;
      if (!p) name = ws ? '下针' : '上针';
      else {
        if (emitted.has(p)) return;
        emitted.add(p);
        name = ws ? (WS_NAME[p.sym] || symTextName(p.sym, st.customSymbols))
                  : symTextName(p.sym, st.customSymbols);
      }
      if (cur && cur.name === name) cur.n++;
      else { cur = { name, n: 1 }; groups.push(cur); }
    };
    if (onRight) for (let c = st.cols - 1; c >= 0; c--) step(c);
    else for (let c = 0; c < st.cols; c++) step(c);
    rows.push({
      r, ws,
      text: 'r' + r + (ws ? '（反面）' : '') + '：' + groups.map(g => g.n + g.name).join('，'),
    });
  }
  return rows;
}

export function chartToText(st) {
  return chartToTextRows(st).map(x => x.text).join('\n');
}
