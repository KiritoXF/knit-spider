import { reactive, nextTick } from 'vue';

// 不持久化的界面状态：当前视图、自定义符号弹窗与编辑草稿
export const ui = reactive({
  view: 'home',      // 'home' 作品管理页 | 'editor' 图解编辑页
  loading: false,    // 切换作品/图解时的全屏 loading 遮罩
  editorOpen: false,
  textChartOpen: false, // 文字解弹窗
  tutorialOpen: false,  // 织法教程图管理弹窗（本机上传库）
});

/* 重活（切换/新建图解会触发大面积 SVG 重渲染）延后到遮罩画完再执行：
   先显示 loading → 30ms 后真正切换 → 渲染完成后关闭遮罩 */
export function withLoading(fn) {
  ui.loading = true;
  setTimeout(() => {
    try { fn(); } finally {
      nextTick(() => { ui.loading = false; });
    }
  }, 30);
}

export const ed = reactive({
  id: null, name: '', w: 2, h: 2,
  shapes: [],          // [{type,...color,w}]
  cur: 'line',         // 'line' | 'circle' | 'rect' | 'curve'
  color: '#111111',
  sw: 0.08,
  drawing: null,       // 正在拖拽、尚未提交的图元
});

export function resetEditor(draft) {
  Object.assign(ed, {
    id: null, name: '', w: 2, h: 2, shapes: [],
    cur: 'line', color: '#111111', sw: 0.08, drawing: null,
  }, draft || {});
}
