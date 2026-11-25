<script setup lang="ts">
const { show } = useToast();
</script>

<template lang="pug">
div
  UiAlert(tone="success" :dismissible="true" @close="show('closed')") Saved
  shared-footer
</template>
