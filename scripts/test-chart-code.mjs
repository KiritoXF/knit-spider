/* 图解代码（chartCode.js）node 直测：npm run test:code */
import { chartToCode, codeToChart, hashCustomSym } from '../src/chartCode.js';

let fails = 0;
const t = (name, ok) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  if (!ok) fails++;
};

const cs = [{ id: 'custom_a', name: '麻花', w: 2, h: 1,
  shapes: [{ type: 'line', x1: 0, y1: 0, x2: 2, y2: 1 }] }];
const chart = {
  rows: 6, cols: 8, rowStartSide: 'left',
  colLabels: { 0: 'A', 3: '中,心' },
  placements: [
    { sym: 'knit', col: 0, row: 1, w: 1, h: 1 },
    { sym: 'knit', col: 1, row: 1, w: 1, h: 1 },
    { sym: 'knit', col: 2, row: 1, w: 1, h: 1 },
    { sym: 'custom_a', col: 0, row: 2, w: 2, h: 1 },
    { sym: 'purl', col: 4, row: 4, w: 1, h: 2 },
    { sym: 'knit', col: 7, row: 6, w: 1, h: 1 },
  ],
  borders: [{ col: 0, row: 1, w: 4, h: 2 }],
  annotations: [{ col: 2, row: 3, w: 2, h: 1, text: '中\n心;测试,转\\义:!感叹' }],
};

/* 把 chart 投影成格内容矩阵（放置分解无关的比较基准） */
function cellsOf(c) {
  const g = Array.from({ length: c.rows }, () => Array(c.cols).fill(null));
  for (const p of c.placements)
    for (let dy = 0; dy < (p.h || 1); dy++)
      for (let dx = 0; dx < (p.w || 1); dx++)
        g[p.row - 1 + dy][p.col + dx] = p.sym;
  return g;
}
const norm = (back, cid) => ({
  rows: back.rows, cols: back.cols, rowStartSide: back.rowStartSide,
  colLabels: back.colLabels, borders: back.borders, annotations: back.annotations,
  cells: cellsOf(back).map(row => row.map(s => s === '~0' ? cid : s)),
});

/* ---- KC2 默认格式 ---- */
const code1 = await chartToCode(chart, cs);
const code2 = await chartToCode(chart, [...cs].reverse());
t('deterministic-same-content', code1 === code2);
t('format-kc2', /^KC2![A-Za-z0-9\-_]+![0-9a-f]{8}$/.test(code1));

const { chart: back, customRefs } = await codeToChart(code1);
t('grid', back.rows === 6 && back.cols === 8 && back.rowStartSide === 'left');
t('cells-roundtrip', JSON.stringify(norm(back, 'custom_a')) === JSON.stringify(norm(chart, 'custom_a')));
t('collabels-escaped', back.colLabels['3'] === '中,心');
t('annotation-escaped', back.annotations[0].text === '中\n心;测试,转\\义:!感叹' && back.annotations[0].w === 2);
t('custom-ref', customRefs.length === 1 && customRefs[0].name === '麻花' && /^[0-9a-f]{8}$/.test(customRefs[0].hash));

/* 放置分解无关：一个 4×1 与四个 1×1 编出同码 */
const wide = { rows: 6, cols: 8, rowStartSide: 'right', colLabels: {}, borders: [], annotations: [],
  placements: [{ sym: 'c22L', col: 1, row: 3, w: 4, h: 1 }] };
const split = { ...wide, placements: [1, 2, 3, 4].map(c => ({ sym: 'c22L', col: c, row: 3, w: 1, h: 1 })) };
t('decomposition-invariant', await chartToCode(wide, []) === await chartToCode(split, []));

/* 篡改与容错 */
let threw = '';
try { await codeToChart(code1.slice(0, -1)); } catch (e) { threw = e.kind; }
t('tampered-truncated', threw === 'TAMPERED');
threw = '';
const m = /!([A-Za-z0-9\-_]+)![0-9a-f]{8}$/.exec(code1);
const flipped = code1.replace(m[1], m[1].slice(0, 5) + (m[1][5] === 'A' ? 'B' : 'A') + m[1].slice(6));
try { await codeToChart(flipped); } catch (e) { threw = e.kind; }
t('tampered-body', threw === 'TAMPERED');
threw = '';
try { await codeToChart('XX1!aaaa!00000000'); } catch (e) { threw = e.kind; }
t('bad-version', threw === 'SYNTAX');
threw = '';
try { await codeToChart('KC2!!!!!'); } catch (e) { threw = e.kind; }
t('garbage', threw === 'SYNTAX' || threw === 'TAMPERED');

/* 4×4 最小网格 + 边界格 */
const minChart = { rows: 4, cols: 4, rowStartSide: 'right', colLabels: {},
  placements: [{ sym: 'knit', col: 3, row: 4, w: 1, h: 1 }], borders: [], annotations: [] };
const mb = (await codeToChart(await chartToCode(minChart, []))).chart;
t('min-grid-edge', mb.placements.length === 1 && mb.placements[0].col === 3 && mb.placements[0].row === 4);

/* 修改一格 → 校验码必变 */
const changed = { ...chart, placements: [...chart.placements, { sym: 'purl', col: 6, row: 6, w: 1, h: 1 }] };
t('checksum-sensitive', (await chartToCode(changed, cs)) !== code1);

/* 空白容错 */
const spaced = code1.slice(0, 10) + ' \n ' + code1.slice(10);
t('whitespace-tolerant', (await codeToChart(spaced)).chart.rows === 6);

/* hash 稳定 */
const h1 = await hashCustomSym(cs[0]);
const h2 = await hashCustomSym({ ...cs[0], id: 'custom_zz', shapes: [...cs[0].shapes] });
const h3 = await hashCustomSym({ ...cs[0], shapes: [...cs[0].shapes].reverse() });
const h4 = await hashCustomSym({ ...cs[0], name: '别的' });
t('hash-id-independent', h1 === h2);
t('hash-shape-order-independent', h1 === h3);
t('hash-name-sensitive', h1 !== h4);

/* 相邻同符号宽放置不得被并成一个：c22L 固有 4×1，两个相邻 = 两个放置 */
const adj = { rows: 6, cols: 12, rowStartSide: 'right', colLabels: {}, borders: [], annotations: [],
  placements: [{ sym: 'c22L', col: 0, row: 2, w: 4, h: 1 }, { sym: 'c22L', col: 4, row: 2, w: 4, h: 1 }] };
const adjBack = (await codeToChart(await chartToCode(adj, []))).chart;
t('adjacent-wide-not-merged', adjBack.placements.length === 2 &&
  adjBack.placements.every(p => p.sym === 'c22L' && p.w === 4 && p.h === 1) &&
  adjBack.placements[0].col === 0 && adjBack.placements[1].col === 4);

/* 自定义多行符号（1×2）纵向还原成整只 */
const csTall = [{ id: 'custom_t', name: '高符', w: 1, h: 2, shapes: [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 2 }] }];
const tall = { rows: 6, cols: 6, rowStartSide: 'right', colLabels: {}, borders: [], annotations: [],
  placements: [{ sym: 'custom_t', col: 2, row: 2, w: 1, h: 2 }] };
const tallBack = (await codeToChart(await chartToCode(tall, csTall))).chart;
t('tall-custom-restored', tallBack.placements.length === 1 &&
  tallBack.placements[0].sym === '~0' && tallBack.placements[0].h === 2);

/* 空图解 */
const empty = await chartToCode({ rows: 36, cols: 24, rowStartSide: 'right', colLabels: {}, placements: [], borders: [], annotations: [] }, []);
t('empty-chart', (await codeToChart(empty)).chart.placements.length === 0);

/* ---- 压缩率对比：200×200 密图（碎花模式） ---- */
const dense = { rows: 200, cols: 200, rowStartSide: 'right', colLabels: {}, borders: [], annotations: [], placements: [] };
for (let r = 1; r <= 200; r++)
  for (let c = 0; c < 200; c++)
    if ((r * 7 + c * 3) % 4 === 0)
      dense.placements.push({ sym: ['knit', 'purl', 'yo', 'k2tog', 'ssk', 'c22L', 'tws'][(r + c) % 7], col: c, row: r, w: 1, h: 1 });
const k2 = await chartToCode(dense, []);
console.log(`  dense 200x200 (${dense.placements.length} placements): KC2=${k2.length} chars`);
const dback = (await codeToChart(k2)).chart;
t('dense-roundtrip', JSON.stringify(cellsOf(dback)) === JSON.stringify(cellsOf(dense)));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
