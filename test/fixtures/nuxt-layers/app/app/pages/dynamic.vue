<script setup lang="ts">
const ok = ref(true);
// The variable stands for SharedFooter in the template.
const Footer = resolveComponent('SharedFooter');
</script>

<template>
  <div>
    <component :is="'UiAlert'" tone="warning" />
    <component :is="ok ? Footer : 'UiAlert'" />
  </div>
</template>
