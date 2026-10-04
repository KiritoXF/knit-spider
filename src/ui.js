import { reactive, nextTick } from 'vue';

// 不持久化的界面状态：当前视图、自定义符号弹窗与编辑草稿
export const ui = reactive({
  view: 'home',      // 'home' 作品管理页 | 'editor' 图解编辑页
  loading: false,    // 切换作品/图解时的全屏 loading 遮罩
  editorOpen: false,
  textChartOpen: false, // 文字解弹窗
  helpOpen: false,      // 操作说明浮层
  symbolOpen: false,    // 符号库弹窗（符号字典 + 教程图 + 反面织法 + 移除恢复，只在首页使用）
  changelogOpen: false, // 更新日志弹窗（数据在 changelog.js）
  chartCodeOpen: false, // 图解代码弹窗（复制 / 导入）
  chartCodeMode: 'copy', // 'copy' | 'import'
  shapingOpen: false,   // 塑形（减针/加针）规则面板
  toasts: [],        // 轻提示队列 [{id,msg,tone}] tone: 'ok'|'warn'|'info'
});

/* ---- 轻提示 toast：右下角，2.6s 自动消失 ---- */
let toastSeq = 0;
export function toast(msg, tone = 'info') {
  const id = ++toastSeq;
  ui.toasts.push({ id, msg, tone });
  setTimeout(() => {
    const i = ui.toasts.findIndex(t => t.id === id);
    if (i >= 0) ui.toasts.splice(i, 1);
  }, 2600);
}

/* ---- 应用内对话框（替代原生 prompt/confirm）：Promise 化 ----
   appConfirm → resolve(true/false)；appPrompt → resolve(输入串/null)。
   注意 AppDialog.vue 的 document 键盘监听负责 Enter/Esc 提交。 */
export const dlg = reactive({
  open: false, mode: 'confirm', // 'confirm' | 'prompt'
  title: '', message: '', value: '', placeholder: '',
  okText: '确定', danger: false, _res: null,
});
export function appConfirm(o) {
  return new Promise(res => {
    Object.assign(dlg, {
      mode: 'confirm', title: o.title || '确认', message: o.message || '',
      value: '', placeholder: '', okText: o.okText || '确定',
      danger: !!o.danger, open: true, _res: res,
    });
  });
}
export function appPrompt(o) {
  return new Promise(res => {
    Object.assign(dlg, {
      mode: 'prompt', title: o.title || '输入', message: o.message || '',
      value: o.value || '', placeholder: o.placeholder || '',
      okText: o.okText || '确定', danger: !!o.danger, open: true, _res: res,
    });
  });
}
export function dlgSettle(v) {
  if (!dlg.open) return;
  dlg.open = false;
  const r = dlg._res; dlg._res = null;
  if (r) r(v);
}

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
