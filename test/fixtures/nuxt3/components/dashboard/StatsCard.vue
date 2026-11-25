<script setup lang="ts">
defineProps<{ label: string; value: number; trend?: 'up' | 'down' }>();
</script>

<template>
  <BaseCard :title="label">
    <strong>{{ value }}</strong>
    <BaseBadge :tone="trend === 'up' ? 'success' : 'warning'">{{ trend }}</BaseBadge>
  </BaseCard>
</template>
