export const SVGNS = 'http://www.w3.org/2000/svg';
export const CELL = 28; // 1 格在 zoom=1 时的像素
export const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/* 外部链接统一出口：桌面端走 shell 插件（系统默认浏览器），网页端开新标签 */
export function openExternal(url) {
  if (!url) return;
  const T = typeof window !== 'undefined' ? window.__TAURI__ : null;
  if (T && T.shell && T.shell.open) { T.shell.open(url).catch(() => {}); return; }
  window.open(url, '_blank');
}

/* 多色染色：把符号标记里的描边/填充色统一替换为指定色（none 除外）。
   内置符号的 svg 是预生成串、自定义符号 shapes 各自带 color，统一走
   字符串替换，正反两处渲染（canvas 位图 / 导出 SVG）共用 */
export function tintMarkup(markup, color) {
  if (!color) return markup;
  return markup.replace(/(stroke|fill)="(?!none)[^"]*"/g, (m, attr) => `${attr}="${color}"`);
}

/* 符号 → SVG 内部标记字符串（内置符号用预生成 svg，自定义符号由 shapes 拼）。
   SymbolArt 组件与画布符号层（v-html 一次性渲染）共用，保证两处渲染一致。
   color 参数：多色编织时覆盖符号原色（不传 = 原色） */
export function symbolInnerMarkup(sym, color) {
  let s;
  if (sym && Array.isArray(sym.shapes)) {
    s = '';
    for (const sh of sym.shapes) {
      const st = sh.color || '#111', w = sh.w || 0.07;
      if (sh.type === 'line')
        s += `<line x1="${sh.x1}" y1="${sh.y1}" x2="${sh.x2}" y2="${sh.y2}" stroke="${st}" stroke-width="${w}" stroke-linecap="round"/>`;
      else if (sh.type === 'circle')
        s += `<circle cx="${sh.cx}" cy="${sh.cy}" r="${sh.r}" fill="none" stroke="${st}" stroke-width="${w}"/>`;
      else if (sh.type === 'rect')
        s += `<rect x="${sh.x}" y="${sh.y}" width="${sh.rw}" height="${sh.rh}" fill="none" stroke="${st}" stroke-width="${w}"/>`;
      else if (sh.type === 'curve')
        s += `<path d="M${sh.x1} ${sh.y1} C${sh.cx1} ${sh.cy1} ${sh.cx2} ${sh.cy2} ${sh.x2} ${sh.y2}" fill="none" stroke="${st}" stroke-width="${w}" stroke-linecap="round"/>`;
    }
  } else {
    s = (sym && sym.svg) || '';
  }
  return tintMarkup(s, color);
}

/* 符号 → data-URL SVG：canvas 符号层用 Image 位图渲染每个符号；
   自测也用它断言曲线等图元的形状串（与画布实际光栅化内容同源） */
export function symDataUrl(sym, color) {
  const w = (sym && sym.w) || 1, h = (sym && sym.h) || 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${symbolInnerMarkup(sym, color)}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
