<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm' | 'md' | 'lg'; disabled?: boolean }>(), {
  variant: 'default',
  size: 'md',
});
</script>

<template>
  <button :class="['btn', `btn-${variant}`, `btn-${size}`]" :disabled="disabled"><slot /></button>
</template>
