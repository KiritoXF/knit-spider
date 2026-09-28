/**
 * 从 knitting_symbols 库的 JIS/*.svg 自动生成内置符号数据。
 * 用法：node scripts/generate-symbols.mjs
 * 输出：src/symbols.generated.js
 *
 * 坐标转换：
 *   原 SVG 为扁格，1 格 = 29/3 宽 × 22/3 高，<g transform="translate(tx, -y0)">
 *   路径 y 坐标在 1045（1 行符号）或 1038（2 行符号）附近。
 *   本工具用单位方格（1 格 = 1×1），故：
 *     sx = 3/29, sy = 3/22
 *     先 apply translate(tx, -y0)，再 scale(sx, sy)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { SVGPathCommander } from 'svg-path-commander';

const SRC_DIR = 'D:/patterns/knitting_symbols-0.7.2/JIS';
const OUT = 'src/symbols.generated.js';
const SX = 3 / 29, SY = 3 / 22;

// 源库只在本地机器上存在（如 CI 环境）：跳过生成，保留仓库里已有的 symbols.generated.js
if (!existsSync(SRC_DIR)) {
  console.warn(`[gen-symbols] source dir not found: ${SRC_DIR} — skip, keep existing ${OUT}`);
  process.exit(0);
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

/* ---------- 符号清单：id → { file, name, cat, w(格), h(格) } ----------
   cat 分类：basic 基础 / dec 减针 / inc 增针 / cross 扭针交叉 / cable 交叉针 / slip 滑针·引上 */
const SYMBOL_DEFS = [
  // 基础
  { id: 'knit',    file: 'knit',          name: '下针',             cat: 'basic' },
  { id: 'purl',    file: 'purl',          name: '上针',             cat: 'basic' },
  { id: 'yo',      file: 'yarnover',      name: '挂针',           cat: 'basic' },
  { id: 'yot',     file: 'yarnovertwist', name: '卷针加针',     cat: 'basic' },
  // { id: 'tw',      file: 'twist',         name: 'ねじり目',         cat: 'basic' },
  { id: 'tws',     file: 'twist.straight',name: '扭针', cat: 'basic' },
  { id: 'twp',     file: 'twist_purl',    name: '上针的扭针',       cat: 'basic' },
  // { id: 'slL',     file: 'slantleft',     name: '左斜線',           cat: 'basic' },
  // { id: 'slR',     file: 'slantright',    name: '右斜線',           cat: 'basic' },
  { id: 'noSt',    file: 'nostitch',      name: '不编织', cat: 'basic' },
  { id: 'bindOff', file: 'bindoff',       name: '伏针',           cat: 'basic' },
  // 減針
  { id: 'ssk',     file: 'decreaseleft',           name: '左上2目一度',       cat: 'dec' },
  { id: 'k2tog',   file: 'decreaseright',          name: '右上2目一度',       cat: 'dec' },
  { id: 'ss2',     file: 'decreaseleft.2w',        name: '左上2目一度(幅2)',  cat: 'dec' },
  { id: 'ks2',     file: 'decreaseright.2w',       name: '右上2目一度(幅2)',  cat: 'dec' },
  { id: 'sskP',    file: 'decreaseleft_purl',      name: '左上2目一度(裏)',   cat: 'dec' },
  { id: 'k2togP',  file: 'decreaseright_purl',     name: '右上2目一度(裏)',   cat: 'dec' },
  { id: 'd3c',     file: 'decrease3to1centered',   name: '中上3目一度',       cat: 'dec' },
  { id: 'd3l',     file: 'decrease3to1left',       name: '左上3目一度',       cat: 'dec' },
  { id: 'd3r',     file: 'decrease3to1right',      name: '右上3目一度',       cat: 'dec' },
  { id: 'd4l',     file: 'decrease4to1left',       name: '左上4目一度',       cat: 'dec' },
  { id: 'd4r',     file: 'decrease4to1right',      name: '右上4目一度',       cat: 'dec' },
  { id: 'd5c',     file: 'decrease5to1centered',   name: '中上5目一度',       cat: 'dec' },
  { id: 'd5l',     file: 'decrease5to1left',       name: '左上5目一度',       cat: 'dec' },
  { id: 'd5r',     file: 'decrease5to1right',      name: '右上5目一度',       cat: 'dec' },
  { id: 'd6l',     file: 'decrease6to1left',       name: '左上6目一度',       cat: 'dec' },
  { id: 'd6r',     file: 'decrease6to1right',      name: '右上6目一度',       cat: 'dec' },
  { id: 'd7c',     file: 'decrease7to1',           name: '中上7目一度',       cat: 'dec' },
  { id: 'd7l',     file: 'decrease7to1left',       name: '左上7目一度',       cat: 'dec' },
  { id: 'd7r',     file: 'decrease7to1right',      name: '右上7目一度',       cat: 'dec' },
  // 増針
  { id: 'inL',     file: 'increaseleft',           name: '左増し目',          cat: 'inc' },
  { id: 'inR',     file: 'increaseright',          name: '右増し目',          cat: 'inc' },
  { id: 'in3',     file: 'increase1to3',           name: '1目から3目',        cat: 'inc' },
  // 1 目交差（2 列 × 1 行）
  { id: 'xR',      file: 'crossleft',              name: '右上1针交叉',       cat: 'cable' },
  { id: 'xL',      file: 'crossright',             name: '左上1针交叉',       cat: 'cable' },
  { id: 'xRP',     file: 'crossleft_purl',         name: '右上1针交叉(下侧为上针)',   cat: 'cable' },
  { id: 'xLP',     file: 'crossright_purl',        name: '左上1针交叉(下侧为上针)',   cat: 'cable' },
  // ねじり交差
  { id: 'twL',     file: 'twistleft',              name: '右上为扭针的1针交叉',      cat: 'cross' },
  { id: 'twR',     file: 'twistright',             name: '左上为扭针的1针交叉',      cat: 'cross' },
  { id: 'twLP',    file: 'twistleft_purl',         name: '右上为扭针的1针交叉(下侧为上针)',  cat: 'cross' },
  { id: 'twRP',    file: 'twistright_purl',        name: '左上为扭针的1针交叉(下侧为上针)',  cat: 'cross' },
  // 目を渡す
  { id: 'passR',   file: 'passright',              name: '穿过左针的交叉(包着右针的交叉)',   cat: 'cross' },
  { id: 'passL',   file: 'passleft',               name: '穿过右针的交叉(包着左针的交叉)',   cat: 'cross' },
  // 2 目 1 目交差（3 列 × 1 行）
  { id: 'c21L',    file: 'c2over1left',            name: '右上2针与1针的交叉',    cat: 'cable' },
  { id: 'c21R',    file: 'c2over1right',           name: '左上2针与1针的交叉',    cat: 'cable' },
  { id: 'c21LP',   file: 'c2over1left-purl',       name: '右上2针与1针的交叉(下侧为上针)',  cat: 'cable' },
  { id: 'c21RP',   file: 'c2over1right-purl',      name: '左上2针与1针的交叉(下侧为上针)',  cat: 'cable' },
  // 2×2 交差（4 列 × 1 行）
  { id: 'c22L',    file: 'c2over2left',            name: '右上2针交叉',       cat: 'cable' },
  { id: 'c22R',    file: 'c2over2right',           name: '左上2针交叉',       cat: 'cable' },
  { id: 'c22LP',   file: 'c2over2left-purl',       name: '右上2针交叉(下侧为上针)',  cat: 'cable' },
  { id: 'c22RP',   file: 'c2over2right-purl',      name: '左上2针交叉(下侧为上针)',  cat: 'cable' },
  // 3×3 交差（6 列 × 1 行，源库无，本项目参照 c22 几何自建）
  { id: 'c33L',    file: 'c3over3left',            name: '右上3针交叉',      cat: 'cable', dir: 'local-symbols' },
  { id: 'c33R',    file: 'c3over3right',           name: '左上3针交叉',      cat: 'cable', dir: 'local-symbols' },
  { id: 'c33LP',   file: 'c3over3left-purl',       name: '右上3针交叉(下侧为上针)',  cat: 'cable', dir: 'local-symbols' },
  { id: 'c33RP',   file: 'c3over3right-purl',      name: '左上3针交叉(下侧为上针)',  cat: 'cable', dir: 'local-symbols' },
  // 滑针・引上（2 行高）
  { id: 'slip',    file: 'slip',                   name: 'すべり目(2段)',     cat: 'slip' },
  { id: 'slipf',   file: 'slipwyif',               name: 'すべり目・手前(2段)', cat: 'slip' },
  { id: 'dip',     file: 'dip',                    name: '引き上げ目(2段)',   cat: 'slip' },
  { id: 'dipP',    file: 'dip_purl',               name: '引き上げ目(裏・2段)', cat: 'slip' },
  { id: 'dipT',    file: 'diptwist',               name: 'ねじり引き上げ目(2段)', cat: 'slip' },
];

/* ---------- 解析单个 SVG ---------- */
function parseTransform(attr) {
  if (!attr) return { tx: 0, ty: 0 };
  const m = attr.match(/translate\(\s*([^,)]+)[,\s]+([^)]+)\s*\)/);
  if (m) return { tx: +m[1], ty: +m[2] };
  return { tx: 0, ty: 0 };
}

/* 任意 2D 仿射矩阵分解为 svg-path-commander 变换步序列。
   SVG matrix(a,b,c,d,e,f) 对点 p：p' = L·p + t，L=[[a,c],[b,d]]，t=[e,f]。
   分解 L = R(φ)·SkewX(k)·S(sx,sy)（对点依次 S→SkewX→R）：
     sx = hypot(a,b)
     φ  = atan2(b,a)
     sy = d·cosφ − c·sinφ
     tan k = (c·cosφ + d·sinφ)/sy
   返回步骤按"对点作用先后"排列：scale → skewX → rotate → translate。
   典型实例：twistright 的外层 g = R(160°)·垂直镜像 + 平移。 */
function matrixToSteps(a, b, c, d, e, f) {
  const sx = Math.hypot(a, b);
  if (sx < 1e-12) return null;
  const phi = Math.atan2(b, a);
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const sy = d * cos - c * sin;
  if (Math.abs(sy) < 1e-12) return null;
  const tanK = (c * cos + d * sin) / sy;
  const steps = [{ scale: [sx, sy] }];
  if (Math.abs(tanK) > 1e-9) steps.push({ skew: Math.atan(tanK) * 180 / Math.PI });
  steps.push({ rotate: phi * 180 / Math.PI });
  steps.push({ translate: [e, f] });
  return steps;
}

/* 把 SVG transform 字符串转成 svg-path-commander 的对象形式（或多步数组） */
function toTransformObj(attr) {
  if (!attr) return null;
  const obj = {};
  const matrixM = attr.match(/matrix\(\s*([^,)\s]+)[,\s]+([^,)\s]+)[,\s]+([^,)\s]+)[,\s]+([^,)\s]+)[,\s]+([^,)\s]+)[,\s]+([^,)\s]+\s*)\)/);
  if (matrixM) {
    const [a, b, c, d, e, f] = matrixM.slice(1, 7).map(Number);
    // svg-path-commander 不支持 matrix 键，只支持 translate/rotate/scale/skew。
    // 对角矩阵（b≈c≈0，镜像/缩放）等价于 translate(e,f) + scale(a,d)。
    // 注意 b/c 要用容差判断：源库 use 元素带 matrix(1, 2.18e-8, 0, -1, ...)，
    // b=2.18e-8 是数值噪声，严格 ===0 会把整段垂直镜像丢弃
    const EPS = 1e-6;
    if (Math.abs(b) < EPS && Math.abs(c) < EPS) {
      obj.translate = [e, f];
      obj.scale = [a, d];
      return obj;
    }
    // 一般仿射矩阵：分解为多步变换（scale/skew/rotate/translate）
    return matrixToSteps(a, b, c, d, e, f);
  }
  const rotateM = attr.match(/rotate\(\s*([^,)\s]+)(?:[,\s]+([^,)\s]+)[,\s]+([^,)\s]+)\s*)?\)/);
  if (rotateM) {
    obj.rotate = +rotateM[1];
    if (rotateM[2]) obj.origin = [+rotateM[2], +rotateM[3]];
  }
  const translateM = attr.match(/translate\(\s*([^,)\s]+)(?:[,\s]+([^,)\s]+)\s*)?\)/);
  if (translateM) obj.translate = [+translateM[1], +(translateM[2] || 0)];
  const scaleM = attr.match(/scale\(\s*([^,)\s]+)(?:[,\s]+([^,)\s]+)\s*)?\)/);
  if (scaleM) obj.scale = [+scaleM[1], +(scaleM[2] || scaleM[1])];
  return Object.keys(obj).length ? obj : null;
}

function getStyle(styleAttr, propName, attrValue) {
  if (attrValue) return attrValue;
  if (styleAttr) {
    const m = styleAttr.match(new RegExp(`${propName}\\s*:\\s*([^;]+)`));
    if (m) return m[1].trim();
  }
  return null;
}

function extractPaths(svgXml) {
  // 用 fast-xml-parser 解析
  const doc = parser.parse(svgXml);
  const svgEl = doc.svg;
  const viewBox = svgEl.viewBox;
  const [, , vbW, vbH] = viewBox.split(/\s+/).map(Number);

  const g = svgEl.g || {};
  const { tx, ty } = parseTransform(g.transform);
  const y0 = -ty; // translate(tx, -y0) → ty = -y0

  const cellsW = Math.round(vbW / (29 / 3));
  const cellsH = Math.round(vbH / (22 / 3));

  // 收集所有元素（path / use），按出现顺序
  // 每个元素带父级 g 的累积 transform 链
  const elements = [];
  function collect(node, tChain) {
    if (!node) return;
    const pathChildren = [].concat(node.path || []).filter(Boolean);
    for (const p of pathChildren) elements.push({ el: p, tChain: tChain.slice() });

    const useChildren = [].concat(node.use || []).filter(Boolean);
    for (const u of useChildren) elements.push({ el: u, tChain: tChain.slice() });

    // 递归嵌套 <g>。每个 g 的变换作为一个不可分割的"块"（可能含多步，
    // 如非对角 matrix 分解），反转祖先顺序时只能块间反转、块内步骤保持
    const gChildren = [].concat(node.g || []).filter(Boolean);
    for (const g of gChildren) {
      const sub = tChain.slice();
      const gt = toTransformObj(g.transform);
      if (gt) sub.push(Array.isArray(gt) ? gt : [gt]);
      collect(g, sub);
    }
  }
  collect(g, []);

  // id → element 索引（用于 use 引用解析）
  const pathById = new Map();
  elements.forEach((item, i) => { if (item.el.id) pathById.set(item.el.id, i); });

  const paths = []; // { d, fill, stroke }

  function applyChain(d, chain) {
    for (const t of chain) {
      d = SVGPathCommander.pathToString(SVGPathCommander.transformPath(d, t));
    }
    return d;
  }

  function resolveEl(item) {
    // 沿 use 引用链追踪：U0(当前元素) → U1 → … → Un(最终带 d 的元素)。
    // SVG use 语义：use 的 shadow 克隆目标时，目标【自身的 transform】保留，
    // 但目标在文档中的祖先 g 链不跟随（shadow 挂在 use 处）。所以：
    //   - 链上每一级（含中间 use）的自身 transform 都要按块收集；
    //   - stroke/fill 沿链继承，取最近一级有定义者；
    //   - 祖先链只使用当前 item 的 tChain。
    // 典型反例：c2over2 中 use4369→use11678→path9827，中间 use 的 translate
    // 一旦丢失，灰色辅助竖线会从格子边界错位移到格子正中间
    const blocks = [];
    let d = null;
    let stroke = null;
    let fill = null;
    let cur = item.el;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (!stroke) stroke = getStyle(cur.style, 'stroke', cur.stroke);
      if (!fill) fill = getStyle(cur.style, 'fill', cur.fill);
      const t = toTransformObj(cur.transform);
      if (t) blocks.push(Array.isArray(t) ? t : [t]);
      if (cur.d !== undefined) { d = cur.d; break; }
      const href = cur['xlink:href'] || cur.href;
      if (!href || !href.startsWith('#')) break;
      const refItem = elements[pathById.get(href.slice(1))];
      if (!refItem) break;
      cur = refItem.el;
    }
    if (d === null) return { d: null };
    // blocks 收集顺序 [U0,U1,…]，块间反转为 [Un,…,U1,U0]（最远目标的
    // transform 最先作用于 d），但块内步骤顺序必须保持
    const chain = blocks.reverse().flat();
    // 祖先链按[外→内]收集，块间反转为[内→外]，在自身链之后应用
    for (const blk of item.tChain.slice().reverse()) chain.push(...blk);
    if (chain.length) d = applyChain(d, chain);
    return { d, stroke, fill };
  }

  for (const item of elements) {
    const { d, stroke, fill } = resolveEl(item);
    if (!d) continue;
    // 跳过灰色辅助线
    if (stroke && stroke.toLowerCase() === '#cccccc') continue;
    paths.push({ d, fill: fill || 'none', stroke: stroke || '#000' });
  }

  return { paths, tx, y0, cellsW, cellsH };
}

/* ---------- 坐标转换 ---------- */
function convertPaths(paths, tx, y0) {
  return paths.map(p => {
    // 原 SVG: <g transform="translate(tx, -y0)">，路径坐标 y≈1045
    // 需先平移到 viewBox 范围，再缩放到单位方格（1格=1×1）
    // svg-path-commander 的 { translate, scale } 是先 scale 后 translate，
    // 所以分两步：先 translate，再 scale
    let d = SVGPathCommander.transformPath(p.d, { translate: [tx, -y0] });
    d = SVGPathCommander.transformPath(d, { scale: [SX, SY] });
    return { d: SVGPathCommander.pathToString(d), fill: p.fill, stroke: p.stroke };
  });
}

function pathToSvg(p) {
  if (p.fill && p.fill !== 'none')
    return `<path d="${p.d}" fill="${p.fill}" stroke="none"/>`;
  return `<path d="${p.d}" fill="none" stroke="#111" stroke-width="0.07" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/* ---------- 主流程 ---------- */
const symbols = {};
const order = [];

for (const def of SYMBOL_DEFS) {
  // def.dir 可指向本项目自建符号目录（local-symbols），缺省为源库 JIS
  const file = join(def.dir || SRC_DIR, def.file + '.svg');
  let svgXml;
  try {
    svgXml = readFileSync(file, 'utf8');
  } catch {
    console.warn(`SKIP (missing): ${def.file}.svg`);
    continue;
  }
  const { paths, tx, y0, cellsW, cellsH } = extractPaths(svgXml);
  const converted = convertPaths(paths, tx, y0);
  symbols[def.id] = {
    name: def.name,
    cat: def.cat,
    w: cellsW,
    h: cellsH,
    svg: converted.map(pathToSvg).join(''),
  };
  order.push(def.id);
  console.log(`OK  ${def.id.padEnd(8)} ${cellsW}x${cellsH}  (${converted.length} paths, y0=${y0})`);
}

// 兼容旧存档（不进面板清单，仅保证旧 placement 可渲染）
symbols.dec3 = symbols.d3c;
symbols.twist = symbols.tws;

const out = `/* 此文件由 scripts/generate-symbols.mjs 自动生成，请勿手改。
   数据来源：knitting_symbols 0.7.2 / JIS/*.svg（MIT，Marnen Laibow-Koser） */
export const SYMBOLS = ${JSON.stringify(symbols, null, 2)};
export const PALETTE_ORDER = ${JSON.stringify(order, null, 2)};
`;
writeFileSync(OUT, out, 'utf8');
console.log(`\nGenerated ${OUT} (${order.length} symbols)`);
