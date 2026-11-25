<script setup lang="ts">
defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div v-if="open" class="modal">
    <slot />
    <BaseButton variant="ghost" @click="emit('close')">Close</BaseButton>
  </div>
</template>
