<script setup>
// 统一渲染符号内容：内置符号（预生成 SVG 字符串）与自定义符号（shapes 数组）
// 都通过 symbolInnerMarkup 生成标记后 v-html 注入，
// 与画布符号层共用同一实现，保证渲染一致
import { computed } from 'vue';
import { symbolInnerMarkup } from '../util.js';

const props = defineProps({ sym: { type: Object, required: true } });
const markup = computed(() => symbolInnerMarkup(props.sym));
</script>

<template>
  <g v-html="markup"></g>
</template>
