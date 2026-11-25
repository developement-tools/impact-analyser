<script setup lang="ts">
defineProps<{ tone?: string; dismissible?: boolean }>();
</script>

<template>
  <div role="alert"><slot /></div>
</template>
