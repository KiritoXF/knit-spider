<script setup>
/* 教程 popover 的独立承载窗口（桌面端专属）。
   主浮窗宽度装不下教程图，而 WebView 内容被系统裁切在自己的窗口内、无法画出窗外，
   所以桌面端再开一个透明置顶小窗（lyric-pop）贴着主浮窗边缘显示 popover：
   主浮窗把内容 emit 过来 → 本窗渲染 → 量出实际高度回传 → 主浮窗据此定位/调整窗口尺寸。
   事件流：lp-pop-data（内容）→ lp-pop-size（回报高度）；lp-pop-ready 表示本窗已就绪 */
import { ref, onMounted, nextTick } from 'vue';
import { openExternal } from '../util.js';

const pop = ref(null); // { name, sid, url, text, imgH }
function onImgClick() { if (pop.value && pop.value.url) openExternal(pop.value.url); }

onMounted(async () => {
  const T = window.__TAURI__;
  if (!T) return;
  /* 鼠标进出承载窗 → 通知主浮窗：移入暂停隐藏倒计时（在看图），移出到桌面才收起 */
  document.documentElement.addEventListener('mouseenter', () => {
    T.event.emit('lp-pop-hover', {}).catch(() => {});
  });
  document.documentElement.addEventListener('mouseleave', () => {
    T.event.emit('lp-pop-leave', {}).catch(() => {});
  });
  await T.event.listen('lp-pop-data', async e => {
    pop.value = e.payload;
    await nextTick();
    /* 必须等图片真正加载完再量高度 —— 否则 img 高度还是 0，
       承载窗按矮内容开窗，图加载完只能看到上半截 */
    const measure = async () => {
      const el = document.querySelector('.tc-pop');
      const h = el ? Math.ceil(el.getBoundingClientRect().height) : 0;
      try { await T.event.emit('lp-pop-size', { h }); } catch (err) {}
    };
    const el = document.querySelector('.tc-pop');
    const img = el && el.querySelector('img');
    if (img && !img.complete) {
      await new Promise(res => {
        img.addEventListener('load', () => { measure(); res(); }, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 4000); // 网络图卡住时兜底
      });
    }
    await measure();
    /* 迟到一次补量：字体/图片后续布局变化导致高度偏差时纠正 */
    setTimeout(async () => {
      if (!pop.value) return;
      const el2 = document.querySelector('.tc-pop');
      const h2 = el2 ? Math.ceil(el2.getBoundingClientRect().height) : 0;
      try { await T.event.emit('lp-pop-size', { h: h2 }); } catch (err) {}
    }, 500);
  });
  await T.event.emit('lp-pop-ready', {});
});
</script>

<template>
  <div v-if="pop" class="tc-pop">
    <div class="tc-pop-head">
      <span class="tc-pop-chip">织法教程</span>
      <span class="tc-pop-name">{{ pop.name }}</span>
      <span v-if="pop.sid" class="tc-pop-id">{{ pop.sid }}</span>
    </div>
    <!-- 图 + 文字说明完整展示（窗口按内容自适应，imgH 只是超长图的滚动上限） -->
    <div class="tc-pop-body" :style="{ maxHeight: pop.imgH + 'px' }">
      <div v-if="pop.url" class="tc-pop-imgbox">
        <img :src="pop.url" alt="" title="点击查看原图" @click="onImgClick">
      </div>
      <div v-if="pop.text" class="tc-pop-text">{{ pop.text }}</div>
    </div>
  </div>
</template>
