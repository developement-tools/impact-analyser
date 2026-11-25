<script setup lang="ts">
defineProps<{ tone?: 'neutral' | 'success' | 'warning' }>();
</script>

<template>
  <span :class="`badge badge-${tone ?? 'neutral'}`"><slot /></span>
</template>
