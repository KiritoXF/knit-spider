import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 入口为根目录的 knitting-chart.html；构建产物是单个自包含 HTML（dist/knitting-chart.html），
// 双击 file:// 即可使用，无需联网。
export default defineConfig({
  plugins: [vue(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: 'dist',
    rollupOptions: { input: 'knitting-chart.html' },
  },
});
