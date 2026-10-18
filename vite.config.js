import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

// 注入版本号（package.json → __APP_VERSION__）：浏览器显示在标签页 title，
// 桌面端显示在窗口标题栏。容忍 BOM（编辑器可能存成 UTF-8 BOM）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));

// 入口为根目录的 knitting-chart.html；构建产物是单个自包含 HTML（dist/knitting-chart.html），
// 双击 file:// 即可使用，无需联网。
export default defineConfig({
  plugins: [vue(), tailwindcss(), viteSingleFile()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './', // GitHub Pages 子路径部署 + public/ 外置教程图必须相对引用
  build: {
    outDir: 'dist',
    rollupOptions: { input: 'knitting-chart.html' },
  },
});
