/* 纯数据/纯函数模块：内置符号从 symbols.generated.js 导入（由脚本自动生成），
   自定义符号的查找见 store.js 的 getSym()。 */
export { SYMBOLS, PALETTE_ORDER } from './symbols.generated.js';

export function shapeToSvg(sh) {
  const c = sh.color || '#111', w = sh.w || 0.07;
  if (sh.type === 'line')
    return `<line x1="${sh.x1}" y1="${sh.y1}" x2="${sh.x2}" y2="${sh.y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  if (sh.type === 'circle')
    return `<circle cx="${sh.cx}" cy="${sh.cy}" r="${sh.r}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  if (sh.type === 'rect')
    return `<rect x="${sh.x}" y="${sh.y}" width="${sh.rw}" height="${sh.rh}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  return '';
}
export function symSvg(sym) { return sym.shapes ? sym.shapes.map(shapeToSvg).join('') : sym.svg; }
