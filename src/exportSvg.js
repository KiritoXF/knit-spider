import { state, activeWork, activeChart, labelFor, getSym, sanitizeFileName } from './store.js';
import { SVGNS, esc, symbolInnerMarkup } from './util.js';

/* 导出当前图解为独立 SVG 文件。
   注意：不能克隆 #chart DOM——画布是三明治结构，符号/网格在 #symCanvas 位图层、
   边框/标注在 #chartTop，克隆底层 SVG 只会得到行号列号（历史 bug）。
   正确做法：从数据直接生成完整矢量 SVG（符号用嵌套 <svg> 内联，纯矢量可打印）。 */
export function exportSvg() {
  const { rows, cols } = state;
  const PAD_L = 1.3, PAD_R = 1.3, PAD_T = 0.7, PAD_B = 1.0; // 与 ChartCanvas 的 viewBox 一致
  const rowTopY = r => rows - r;
  const s = [];
  s.push('<?xml version="1.0" encoding="UTF-8"?>');
  s.push(`<svg xmlns="${SVGNS}" viewBox="${-PAD_L} ${-PAD_T} ${cols + PAD_L + PAD_R} ${rows + PAD_T + PAD_B}" ` +
    `width="${(cols + PAD_L + PAD_R) * 28}" height="${(rows + PAD_T + PAD_B) * 28}">`);

  const w = activeWork(), c = activeChart();
  s.push(`<title>${esc(w && c ? `${w.name} · ${c.name}` : 'knitting-chart')}</title>`);

  /* 白底（略大于网格，包住行列号） */
  s.push(`<rect x="${-PAD_L}" y="${-PAD_T}" width="${cols + PAD_L + PAD_R}" height="${rows + PAD_T + PAD_B}" fill="#fff"/>`);

  /* 网格线 + 外框（与画布位图层同色同粗细） */
  let grid = '';
  for (let i = 0; i <= cols; i++) grid += `M${i} 0V${rows}`;
  for (let i = 0; i <= rows; i++) grid += `M0 ${i}H${cols}`;
  s.push(`<path d="${grid}" stroke="#cbd5e1" stroke-width="0.025" fill="none"/>`);
  s.push(`<rect x="0.03" y="0.03" width="${cols - 0.06}" height="${rows - 0.06}" fill="none" stroke="#475569" stroke-width="0.06"/>`);

  /* 符号：嵌套 <svg> 内联矢量（drawImage 与其等价：按放置宽高铺满格子） */
  for (const p of state.placements) {
    const sym = getSym(p.sym);
    if (!sym) continue;
    const ty = rows - p.row - p.h + 1;
    s.push(`<svg x="${p.col}" y="${ty}" width="${p.w}" height="${p.h}" viewBox="0 0 ${sym.w} ${sym.h}" preserveAspectRatio="none">${symbolInnerMarkup(sym)}</svg>`);
  }

  /* 粗边框（与 #chartTop 一致） */
  for (const b of state.borders)
    s.push(`<rect x="${b.col}" y="${rowTopY(b.row + b.h - 1)}" width="${b.w}" height="${b.h}" fill="none" stroke="#0f172a" stroke-width="0.1"/>`);

  /* 区域标注：青色虚线框 + 上方文字（白描边保证可读） */
  for (const a of state.annotations) {
    const ty = rowTopY(a.row + a.h - 1);
    s.push(`<rect x="${a.col}" y="${ty}" width="${a.w}" height="${a.h}" fill="#14b8a6" fill-opacity="0.07" ` +
      `stroke="#0d9488" stroke-width="0.06" stroke-dasharray="0.18 0.12"/>`);
    s.push(`<text x="${a.col + 0.05}" y="${ty - 0.14}" font-size="0.4" font-weight="bold" fill="#0f766e" ` +
      `stroke="#fff" stroke-width="0.12" style="paint-order:stroke" font-family="sans-serif">${esc(a.text)}</text>`);
  }

  /* 行号：第 1 行位置由 rowStartSide 决定，其后逐行左右交替（与画布规则一致） */
  const row1Right = state.rowStartSide !== 'left';
  for (let r = 1; r <= rows; r++) {
    const onRight = (r % 2 === 1) === row1Right;
    s.push(`<text x="${onRight ? cols + 0.45 : -0.45}" y="${rowTopY(r) + 0.52}" text-anchor="middle" ` +
      `dominant-baseline="central" font-size="0.42" fill="#64748b" font-family="sans-serif">${r}</text>`);
  }

  /* 列号：仅手动标注的列 */
  for (let i = 0; i < cols; i++) {
    const label = labelFor(i);
    if (label !== '')
      s.push(`<text x="${i + 0.5}" y="${rows + 0.42}" text-anchor="middle" dominant-baseline="central" ` +
        `font-size="0.3" fill="#64748b" font-family="sans-serif">${esc(label)}</text>`);
  }

  s.push('</svg>');
  const blob = new Blob([s.join('\n')], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (w && c ? `${sanitizeFileName(w.name)}_${sanitizeFileName(c.name)}` : 'knitting-chart') + '.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}
