<script setup lang="ts">
// Render function: no template, the component is resolved in the script.
const render = () => h(resolveComponent('UiAlert'), { tone: 'danger' });
</script>

<template>
  <render />
</template>
