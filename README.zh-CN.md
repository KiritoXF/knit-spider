# 蜘蛛织毛线

[English](README.md) | 简体中文

纯前端的棒针编织图解编辑器：画格子、摆符号、框选复制、区域标注、图解转文字解，存档与导出一条龙。构建产物是单个自包含 HTML，双击即可离线使用，无需联网。

## 功能特性

### 作品与图解管理
- 作品 / 图解两级结构：一个作品下可建多个图解（如正身、袖子、领口）
- 作品管理页：卡片式浏览，含最近编辑时间，点图解 chip 可直达对应图解
- 图解页签栏：单击切换、双击行内重命名、删除、新建（自动命名"图解 N"）
- 图解锁定：页签栏"锁定"按钮一键锁定当前图解，锁定后所有编辑操作（放置/擦除/粘贴/标注/网格调整/撤销重做）被拦截，防止完成的图解被误改；页签上显示锁标，锁定状态随存档保存
- 最后更改时间：页签栏右侧显示当前图解的最后更改时间。图面操作（放置/擦除/边框/标注/列号/网格/撤销重做）计时；锁定/解锁、重命名、收藏等非内容操作不计时；时间随存档保存

### 画布
- 网格最大 200 × 200 格（针数 × 行数），缩放 0.5 – 2.5
- 第 1 行起始侧可切换：右侧（从右往左织）/ 左侧（从左往右织）
- 手动列号标注、行高亮
- 符号层 canvas 位图渲染（零 DOM 节点）：大图解（如 40 行 × 117 列、3200+ 符号）切换与编辑依然流畅

### 符号
- 内置 JIS 标准棒针符号，以及本项目自建符号（如 3×3 交差）
- 分类过滤（多选 toggle）、"常用"收藏（符号左上角悬停星标）
- 管理模式下才能删除符号，防误触；支持隐藏 / 恢复符号

### 编辑工具
- 框选：拖出矩形区域，配合复制 / 删除 / 标注 / 粘贴使用
- 边框：拖选画花样外框
- 消去：点击或拖动删除符号与边框
- 标注：给框选区域加文字（如"花样A · 12针重复"），青色虚线框显示在区域上方
- 复制 / 粘贴：以复制块左下角对齐所点击的格
- 撤销 / 重做，图面操作均进历史

### 文字解
- 顶栏"文字解"一键把当前图解转成逐行文字解：弹窗展示（自动换行、行号/反面徽标/针数高亮）、复制全文、下载 txt
- 正反面按第 1 行起始侧自动推算（与画布行号位置一致）：正面行右→左原样读，反面行左→右读并自动转换（下针↔上针、扭针→上针的扭针等）
- 空白格按背景针处理（正面行上针、反面行下针）；连续同名针目合并计数；行前缀 `r3：`，反面行标注「反面」
- 文件名 `作品名_图解名.txt`

### 自定义符号编辑器
- 图元：直线、矩形、椭圆、路径、贝塞尔曲线（拖出起止线 → 点两次定弯点）
- 画布尺寸按符号宽高自适应，宽高修改即输即生效

### 存档与导出
- 存档：整个作品保存为 JSON（v2 格式，含全部图解）
- 导出图解：仅当前图解为 JSON（v1 兼容格式，可供旧版使用）
- 载入：一律追加不覆盖——作品包导入为新作品，单图解追加为新图解
- 存档走 File System Access API 弹系统"另存为"框，可覆盖已有文件；旧浏览器自动降级为下载
- 导出 SVG：文件名 `作品名_图解名.json/svg`，内嵌 `<title>`
- 编辑内容自动保存到浏览器 localStorage

## 使用说明

### 快速开始

```bash
npm install
npm run dev-open    # 启动开发服务器并自动打开编辑器页面（入口 /knitting-chart.html）
```

构建发布：

```bash
npm run build       # 先重新生成符号数据，再产出 dist/knitting-chart.html 单文件
```

`dist/knitting-chart.html` 双击（file://）即可使用，可拷贝到任意机器离线运行。

### 基本操作

1. 新建作品 → 新建图解，在顶栏设定网格宽（针数）与行数后点"应用"
2. 从左侧符号面板点选符号，在画布上点击格子放置
3. 工具栏"框选"拖出区域后：复制 / 删除选区 / 标注；"粘贴"工具点击目标格落位
4. "边框"工具拖选画花样外框；画错用"消去"擦除
5. 顶栏"存档"保存整个作品；"导出图解"仅当前图解；"载入"从 JSON 追加；"导出 SVG"用于打印或分享
6. 顶栏"文字解"查看当前图解的逐行织法说明，可复制或下载 txt

### 快捷键

| 按键 | 功能 |
| --- | --- |
| Ctrl+Z | 撤销 |
| Ctrl+Y / Ctrl+Shift+Z | 重做 |
| Ctrl+C | 复制选区 |
| Ctrl+V | 粘贴 |
| Delete / Backspace | 删除选区 |
| Esc | 取消选区 / 退出粘贴 |

### 数据与存档格式

- 自动保存键名 `knitChartProto1`（localStorage）
- v2 作品包：`{version:2, works:[...]}`；v1 旧版单图解 JSON 仍可导入
- 旧版扁平 localStorage 数据自动迁移为「我的作品 / 图解 1」

## 开发说明

### 技术栈

- Vue 3（`<script setup>` 组合式 API），无其他运行时依赖
- Vite 7 + vite-plugin-singlefile（单文件产物）
- Tailwind CSS 4（@tailwindcss/vite 插件）
- 符号生成管线：fast-xml-parser + svg-path-commander

### 目录结构

```
├─ knitting-chart.html        # 应用入口 HTML
├─ vite.config.js             # 单文件构建配置，入口 knitting-chart.html
├─ scripts/
│  └─ generate-symbols.mjs    # 从外部 JIS 符号库 SVG 提取路径，生成符号数据
├─ local-symbols/             # 本项目自建符号 SVG（源库没有的，如 3×3 交差）
└─ src/
   ├─ main.js                 # 启动入口
   ├─ App.vue                 # 视图切换（home 作品管理 / editor 编辑器）
   ├─ ui.js                   # 会话状态（当前视图、loading 遮罩）
   ├─ store.js                # 全部业务状态与操作（reactive 集中管理）
   ├─ util.js                 # 符号渲染共用实现（symbolInnerMarkup / symDataUrl）
   ├─ symbols.js              # 符号定义（含自建符号 dir 字段）
   ├─ symbols.generated.js    # 生成产物，勿手改
   ├─ exportSvg.js            # SVG 导出
   ├─ textChart.js            # 文字解纯转换模块（无 Vue 依赖，node 可直调）
   ├─ selftest.js             # 页面自测脚本
   ├─ style.css
   └─ components/
      ├─ HomeView.vue         # 作品管理页
      ├─ TopBar.vue           # 顶栏：作品切换、网格尺寸、缩放、存档/导出、文字解
      ├─ ChartTabs.vue        # 图解页签
      ├─ ToolBar.vue          # 工具栏与全局快捷键
      ├─ ChartCanvas.vue      # 画布：canvas 符号层 + 边框/标注/框选渲染与交互
      ├─ PalettePanel.vue     # 符号面板（分类/收藏/管理）
      ├─ SymbolArt.vue        # 单符号渲染组件
      ├─ TextChartModal.vue   # 文字解弹窗（展示/复制/下载）
      └─ EditorModal.vue      # 自定义符号编辑器
```

### 符号生成管线

```bash
npm run gen-symbols   # 单独重新生成 src/symbols.generated.js
```

- 外部 JIS 符号库路径在 `scripts/generate-symbols.mjs` 中配置
- 自建符号放 `local-symbols/*.svg`，与库符号走同一转换管线
- 注意：`npm run build` 会先自动跑 gen-symbols；但单跑 gen-symbols 不会更新 dist，仍需重新 build

### 开发约定（踩坑备忘）

- store.js 的操作函数保持同步（供自测直调）；UI 入口用 `ui.js` 的 `withLoading(fn)` 包裹——大图解切换会触发画布重渲染，需先出 loading 遮罩
- 画布符号层是 canvas 位图（`#chartWrap` 夹心结构：底 SVG 热区/高亮/行号 < `#symCanvas` 网格+符号位图 < 顶 SVG 边框/标注/框选）；每符号经 `symDataUrl` 生成 data-URL 位图缓存（WeakMap 按符号对象弱引用），重绘只做 drawImage 贴图。勿改回 SVG 节点渲染（v-html 内联路径在大图解有 8-10s 长任务；`<defs>+<use>` 去重 Chrome 更慢，均已实测踩坑）
- 撤销历史挂在 `save()` 上做图面内容指纹去重，快照存 JSON 字符串（恢复时才 parse）；zoom / tool / highlight 等会话状态不进历史；undo/redo 后必须调 `syncHistUI()`
- 框选拖拽结束必须置 `skipClick` 标记跳过浏览器补发的 click 事件，否则选区会被重置为单格
- `persistObject` 只做一次 JSON.stringify，禁止内部再深拷贝；作品树数组被整体替换后须 `projectActive()` 重新对准投影
- 自测 `runSelfTest`：开头切到 editor 视图再 tick（否则画布 DOM 不存在），结尾 `save()` 落盘干净状态；符号层断言走像素采样（`window.__symLayer` 钩子 + `blockHasInk`）
