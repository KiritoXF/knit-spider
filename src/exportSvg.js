import { state, activeWork, activeChart, sanitizeFileName } from './store.js';
import { SVGNS } from './util.js';

export function exportSvg() {
  const svg = document.getElementById('chart');
  const clone = svg.cloneNode(true);
  clone.querySelector('#ghost')?.remove();
  clone.querySelector('#hlLayer')?.remove();
  clone.style.width = ''; clone.style.height = '';
  const { rows, cols } = state;
  const bg = document.createElementNS(SVGNS, 'rect');
  bg.setAttribute('x', -1.3); bg.setAttribute('y', -0.7);
  bg.setAttribute('width', cols + 2.6); bg.setAttribute('height', rows + 1.7);
  bg.setAttribute('fill', '#fff');
  clone.insertBefore(bg, clone.firstChild);
  const w = activeWork(), c = activeChart();
  const title = document.createElementNS(SVGNS, 'title');
  title.textContent = w && c ? `${w.name} · ${c.name}` : 'knitting-chart';
  clone.insertBefore(title, clone.firstChild);
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone)],
    { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (w && c ? `${sanitizeFileName(w.name)}_${sanitizeFileName(c.name)}` : 'knitting-chart') + '.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}
