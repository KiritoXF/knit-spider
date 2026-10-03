/* 图解代码（KC2 二进制压缩格式）+ 快速校验码。纯数据/纯函数模块，
   node 可直测（scripts/test-chart-code.mjs）。

   形态 KC2!<base64url>!<8hex>，校验码 = SHA-256(base64 串) 前 8 hex。
   二进制布局（LEB128 无符号 varint；str = varint 字节数 + UTF-8）：
     magic 'KC2' | u8 flags(bit0=第1行起始左) | varint rows, cols
     varint nCL;  每 { varint col, str label }
     varint nS;   每 { str name, str hash8, varint w, varint h }  自定义符号表（内容指纹+固有尺寸）
     varint nDict; 每 { u8 kind(0=内置 str id, 1=自定义 varint 表序号) }
       字典 0 号隐式 = 背景空格，不落盘
     varint nB;   每 { varint col,row,w,h }
     varint nA;   每 { varint col,row,w,h, str text }
     单元流：按行主序（r1c0 → r1cEnd → r2…）的 (varint dictIdx, varint runLen)*，
       覆盖 rows×cols 格恰好用尽
   解码还原放置时按符号「固有宽高」切分/合并：横向每 w_s 格一个放置、
   纵向相邻同符号段在 h_s 内合并——否则相邻的两个 4 格麻花会被错并成
   一个 8 格宽的麻花（拉伸变形）。内置符号固有尺寸取自 SYMBOLS，
   自定义符号的 w/h 随表携带。
   压缩 = 自研容器 + fflate deflateSync（zip 同款依赖，零新增包）。
   不编 name/id/updatedAt/locked/doneRows——元数据与织进度不算「图面内容」。
   另有 quickHash()：同步 FNV-1a 快速校验码（顶栏常驻展示用，非密码学）。 */

import { deflateSync, inflateSync } from 'fflate';
import { SYMBOLS } from './symbols.js';

/* 图解代码统一错误：kind = 'SYNTAX'（格式无法识别）| 'TAMPERED'（校验不符）| 'SIZE'（越界） */
export class ChartCodeError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'ChartCodeError';
    this.kind = kind;
    this.detail = detail;
  }
}

/* ---------- 哈希工具 ---------- */

async function sha256_8(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
}

const r3 = n => Math.round(+n * 1000) / 1000; // 数字精度归一（去浮点噪声）
/* 造 shape 的规范化键值对：固定键序、剔除默认值（EditorModal 默认 color '#111111' / w 0.08） */
function shapeKV(sh) {
  const d = { color: sh.color === undefined || sh.color === '#111111' || sh.color === '#111' ? null : sh.color,
    w: sh.w === undefined || r3(sh.w) === 0.08 ? null : r3(sh.w) };
  const keys = {
    line: ['x1', 'y1', 'x2', 'y2'],
    circle: ['cx', 'cy', 'r'],
    rect: ['x', 'y', 'rw', 'rh'],
    curve: ['x1', 'y1', 'cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2'],
  };
  const out = { type: sh.type };
  for (const k of keys[sh.type] || []) if (sh[k] !== undefined) out[k] = r3(sh[k]);
  for (const k of ['color', 'w']) if (d[k] !== null) out[k] = d[k];
  return out;
}
/* 自定义符号内容指纹：name+w+h+shapes 规范化后 SHA-256 前 8 hex。
   shapes 先各自规范化、再按序列化串排序（与绘制顺序无关，保证同形同名必同码） */
export async function hashCustomSym(sym) {
  const shapes = (Array.isArray(sym.shapes) ? sym.shapes : [])
    .map(shapeKV).map(s => JSON.stringify(s)).sort();
  return sha256_8(JSON.stringify({ name: sym.name, w: sym.w, h: sym.h, shapes }));
}

/* ---------- LEB128 varint / base64url ---------- */

function putVarint(buf, v) {
  v = Math.round(v);
  if (!(v >= 0)) throw new ChartCodeError('SIZE', '非法数值 ' + v);
  while (v > 0x7f) { buf.push((v & 0x7f) | 0x80); v >>>= 7; }
  buf.push(v);
}
function putStr(buf, s) {
  const u = new TextEncoder().encode(String(s ?? ''));
  putVarint(buf, u.length);
  for (const b of u) buf.push(b);
}
function getVarint(dv, off) {
  let v = 0, shift = 0, p = off.pos;
  for (;;) {
    if (p >= dv.length) throw new ChartCodeError('SYNTAX', '数据意外截断');
    const b = dv[p++];
    v |= (b & 0x7f) << shift;
    if (!(b & 0x80)) { off.pos = p; return v; }
    shift += 7;
    if (shift > 28) throw new ChartCodeError('SYNTAX', 'varint 过长');
  }
}
function getStr(dv, off) {
  const n = getVarint(dv, off);
  if (off.pos + n > dv.length) throw new ChartCodeError('SYNTAX', '字符串越界');
  const s = new TextDecoder().decode(dv.subarray(off.pos, off.pos + n));
  off.pos += n;
  return s;
}

/* base64url（无填充，浏览器/ node 通用，不依赖 Buffer） */
const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64uEncode(bytes) {
  let out = '', i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64U[n >> 18] + B64U[(n >> 12) & 63] + B64U[(n >> 6) & 63] + B64U[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) { const n = bytes[i] << 16; out += B64U[n >> 18] + B64U[(n >> 12) & 63]; }
  else if (rest === 2) { const n = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64U[n >> 18] + B64U[(n >> 12) & 63] + B64U[(n >> 6) & 63]; }
  return out;
}
function b64uDecode(s) {
  const rev = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64U.length; i++) rev[B64U.charCodeAt(i)] = i;
  const clean = s.replace(/=+$/, '');
  const out = [];
  let i = 0;
  for (; i + 3 < clean.length; i += 4) {
    const n = (rev[clean.charCodeAt(i)] << 18) | (rev[clean.charCodeAt(i + 1)] << 12) |
      (rev[clean.charCodeAt(i + 2)] << 6) | rev[clean.charCodeAt(i + 3)];
    if (n < 0) throw new ChartCodeError('SYNTAX', 'Base64 字符非法');
    out.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const rest = clean.length - i;
  if (rest === 2) { const n = (rev[clean.charCodeAt(i)] << 18) | (rev[clean.charCodeAt(i + 1)] << 12); if (n < 0) throw new ChartCodeError('SYNTAX', 'Base64 字符非法'); out.push((n >> 16) & 255); }
  else if (rest === 3) { const n = (rev[clean.charCodeAt(i)] << 18) | (rev[clean.charCodeAt(i + 1)] << 12) | (rev[clean.charCodeAt(i + 2)] << 6); if (n < 0) throw new ChartCodeError('SYNTAX', 'Base64 字符非法'); out.push((n >> 16) & 255, (n >> 8) & 255); }
  else if (rest === 1) throw new ChartCodeError('SYNTAX', 'Base64 长度非法');
  return new Uint8Array(out);
}

const KC2_MAGIC = [0x4b, 0x43, 0x32]; // 'KC2'

/* ---------- 编码 ---------- */

export async function chartToCode(chart, customSymbols = []) {
  const rows = Math.round(+chart.rows), cols = Math.round(+chart.cols);
  if (!(rows >= 4 && rows <= 400 && cols >= 4 && cols <= 400))
    throw new ChartCodeError('SIZE', '图解尺寸超出 4×4 ~ 400×400');

  /* 引用的自定义符号表（内容指纹，跨设备确定性：按 名字+hash 排序）。
     克隆后操作，严禁污染调用方的 customSymbols 对象（里面会带 _hash 落盘） */
  const localById = new Map(customSymbols.map(c => [c.id, c]));
  const usedCustom = new Set();
  const cells = new Array(rows * cols).fill(null); // 每格 → 符号 id（背景为 null）
  for (const p of chart.placements || []) {
    const w = Math.max(1, Math.round(+p.w || 1)), h = Math.max(1, Math.round(+p.h || 1));
    const col = Math.round(+p.col), row = Math.round(+p.row);
    if (col + w > cols || row + h - 1 > rows || col < 0 || row < 1)
      throw new ChartCodeError('SIZE', `符号 ${p.sym} 越出网格`);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const idx = (row - 1 + dy) * cols + (col + dx);
      if (cells[idx] !== null && cells[idx] !== p.sym)
        throw new ChartCodeError('SIZE', '放置区域重叠');
      cells[idx] = p.sym;
      if (localById.has(p.sym)) usedCustom.add(p.sym);
    }
  }
  const customs = [...usedCustom].map(id => ({ ...localById.get(id) }))
    .sort((a, b) => (a.name).localeCompare(b.name));
  for (const c of customs) c._hash = await hashCustomSym(c);
  customs.sort((a, b) => (a.name + a._hash).localeCompare(b.name + b._hash));

  /* 符号字典：0 = 背景隐式；1.. = 实际用到的符号 */
  const dict = [];       // {kind:0|1, id?, customIdx?}
  const dictOf = new Map();
  for (const id of new Set(cells.filter(Boolean))) {
    if (localById.has(id)) continue; // 自定义符号稍后按表序号入典
    dictOf.set(id, dict.length + 1);
    dict.push({ kind: 0, id });
  }
  customs.forEach((c, i) => { dictOf.set(c.id, dict.length + 1); dict.push({ kind: 1, customIdx: i }); });

  const buf = [];
  buf.push(...KC2_MAGIC);
  buf.push(chart.rowStartSide === 'left' ? 1 : 0);
  putVarint(buf, rows); putVarint(buf, cols);

  const clKeys = Object.keys(chart.colLabels || {}).map(Number).sort((a, b) => a - b);
  putVarint(buf, clKeys.length);
  for (const k of clKeys) { putVarint(buf, k); putStr(buf, chart.colLabels[k]); }

  putVarint(buf, customs.length);
  for (const c of customs) {
    putStr(buf, c.name); putStr(buf, c._hash);
    putVarint(buf, Math.max(1, +c.w || 1)); putVarint(buf, Math.max(1, +c.h || 1));
  }

  putVarint(buf, dict.length);
  for (const d of dict) {
    if (d.kind === 0) { buf.push(0); putStr(buf, d.id); }
    else { buf.push(1); putVarint(buf, d.customIdx); }
  }

  const bs = [...(chart.borders || [])].sort((a, b) => (a.row - b.row) || (a.col - b.col));
  putVarint(buf, bs.length);
  for (const b of bs) { putVarint(buf, b.col); putVarint(buf, b.row); putVarint(buf, Math.max(1, +b.w || 1)); putVarint(buf, Math.max(1, +b.h || 1)); }

  const as = [...(chart.annotations || [])].sort((a, b) => (a.row - b.row) || (a.col - b.col));
  putVarint(buf, as.length);
  for (const a of as) {
    putVarint(buf, a.col); putVarint(buf, a.row);
    putVarint(buf, Math.max(1, +a.w || 1)); putVarint(buf, Math.max(1, +a.h || 1));
    putStr(buf, String(a.text ?? ''));
  }

  /* 单元流：行主序游程 */
  let i = 0;
  while (i < cells.length) {
    const sym = cells[i];
    let n = 1;
    while (i + n < cells.length && cells[i + n] === sym) n++;
    putVarint(buf, sym === null ? 0 : dictOf.get(sym));
    putVarint(buf, n);
    i += n;
  }

  const payload = b64uEncode(deflateSync(new Uint8Array(buf)));
  return `KC2!${payload}!${await sha256_8(payload)}`;
}

/* ---------- 解码 ---------- */

/* 返回 {chart, customRefs:[{n,name,hash}]}；chart.placements 中自定义符号 sym 为 '~n'，
   由调用方（store.importChartCode）负责匹配本机符号并回填真实 id */
export async function codeToChart(code) {
  const clean = String(code || '').replace(/\s+/g, '');
  const parts = clean.split('!');
  if (parts.length !== 3 || parts[0] !== 'KC2')
    throw new ChartCodeError('SYNTAX', '不是有效的图解代码（缺少 KC2 头或校验段）');
  const [, payload, sum] = parts;
  if (await sha256_8(payload) !== sum)
    throw new ChartCodeError('TAMPERED', '校验码不符：代码可能被改动或截断');
  let raw;
  try { raw = inflateSync(b64uDecode(payload)); }
  catch (e) { throw new ChartCodeError('SYNTAX', '数据解压失败：' + (e.message || e)); }

  let p = 0;
  const off = { get pos() { return p; }, set pos(v) { p = v; } };
  const need = n => { if (p + n > raw.length) throw new ChartCodeError('SYNTAX', '数据意外截断'); };
  for (const b of KC2_MAGIC) { if (raw[p] !== b) throw new ChartCodeError('SYNTAX', '魔数不符'); p++; }
  need(1);
  const flags = raw[p++];
  const rows = getVarint(raw, off), cols = getVarint(raw, off);
  if (!(rows >= 4 && rows <= 200 && cols >= 4 && cols <= 200))
    throw new ChartCodeError('SIZE', `网格尺寸 ${rows}×${cols} 超出范围`);

  const chart = { rows, cols, rowStartSide: flags & 1 ? 'left' : 'right',
    colLabels: {}, placements: [], borders: [], annotations: [] };
  const customRefs = [];

  const nCL = getVarint(raw, off);
  for (let i = 0; i < nCL; i++) {
    const k = getVarint(raw, off);
    if (k >= cols) throw new ChartCodeError('SYNTAX', '列号越界');
    chart.colLabels[k] = getStr(raw, off);
  }
  const nS = getVarint(raw, off);
  for (let i = 0; i < nS; i++) {
    const name = getStr(raw, off), hash = getStr(raw, off);
    const w = getVarint(raw, off), h = getVarint(raw, off);
    customRefs.push({ n: i, name, hash, w, h });
  }
  const nDict = getVarint(raw, off);
  const dict = [null]; // 0 号 = 背景
  for (let i = 0; i < nDict; i++) {
    need(1);
    const kind = raw[p++];
    if (kind === 0) dict.push({ custom: false, id: getStr(raw, off) });
    else { const ci = getVarint(raw, off); if (ci >= nS) throw new ChartCodeError('SYNTAX', '自定义符号引用越界'); dict.push({ custom: true, ci }); }
  }
  const nB = getVarint(raw, off);
  for (let i = 0; i < nB; i++)
    chart.borders.push({ col: getVarint(raw, off), row: getVarint(raw, off), w: getVarint(raw, off), h: getVarint(raw, off) });
  const nA = getVarint(raw, off);
  for (let i = 0; i < nA; i++)
    chart.annotations.push({ col: getVarint(raw, off), row: getVarint(raw, off), w: getVarint(raw, off), h: getVarint(raw, off), text: getStr(raw, off) });

  /* 单元流还原 placements：按符号固有宽高切分/合并。
     横向：同符号连续格每 w_s 格切一个放置（两个相邻的 4 格麻花不能并成 8 格宽）；
     纵向：列对齐的同符号段在固有高度 h_s 内向上合并（多行符号还原成整只） */
  let total = 0, idx = 0, last = null; // last = {sym,row,col0,len} 横向活动段
  while (total < rows * cols) {
    const di = getVarint(raw, off);
    const n = getVarint(raw, off);
    if (di >= dict.length) throw new ChartCodeError('SYNTAX', '符号字典引用越界');
    if (total + n > rows * cols) throw new ChartCodeError('SYNTAX', '单元流超出网格');
    let sym = null, sw = 1, sh = 1;
    if (di !== 0) {
      const d = dict[di];
      if (d.custom) {
        sym = '~' + d.ci;
        sw = customRefs[d.ci].w; sh = customRefs[d.ci].h;
      } else {
        sym = d.id;
        const s = SYMBOLS[sym];
        sw = s ? s.w : 1; sh = s ? s.h : 1;
      }
    }
    for (let k = 0; k < n; k++, idx++, total++) {
      if (sym === null) { last = null; continue; }
      const row = Math.floor(idx / cols) + 1, col = idx % cols;
      if (last && last.sym === sym && last.row === row && last.col0 + last.len === col && last.len < sw) last.len++;
      else { last = { sym, row, col0: col, len: 1 }; chart.placements.push({ sym, col, row, w: 1, h: 1 }); }
      if (last.len > 1) chart.placements[chart.placements.length - 1].w = last.len;
    }
  }
  if (total !== rows * cols) throw new ChartCodeError('SYNTAX', '单元流不完整');
  /* 纵向合并：同符号、同列、同宽、行紧邻，且合并后不超过固有高度；
     被吸收的段从数组剔除 */
  const byCol = new Map(); // key = sym|col|w → 最新的可向下延伸段
  const absorbed = new Set();
  for (const p of [...chart.placements].sort((a, b) => (a.col - b.col) || (a.row - b.row))) {
    const sw = p.sym.startsWith('~') ? customRefs[+p.sym.slice(1)].w : (SYMBOLS[p.sym]?.w ?? 1);
    const sh = p.sym.startsWith('~') ? customRefs[+p.sym.slice(1)].h : (SYMBOLS[p.sym]?.h ?? 1);
    if (sw !== p.w || sh <= 1) continue; // 宽度对不上固有宽（不该发生）或单行符号不参与纵向合并
    const key = p.sym + '|' + p.col + '|' + p.w;
    const prev = byCol.get(key);
    if (prev && prev.row + prev.h === p.row && prev.h < sh) {
      prev.h++;
      absorbed.add(p);
    } else byCol.set(key, p);
  }
  if (absorbed.size) chart.placements = chart.placements.filter(p => !absorbed.has(p));
  return { chart, customRefs };
}
