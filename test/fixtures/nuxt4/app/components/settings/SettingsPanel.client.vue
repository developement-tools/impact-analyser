<script setup lang="ts">
const open = ref(false);
</script>

<template>
  <div>
    <BaseButton variant="danger" @click="open = true">Delete account</BaseButton>
    <LazyBaseModal :open="open" @close="open = false">Are you sure?</LazyBaseModal>
  </div>
</template>
