<script setup lang="ts">
import type { Product } from '~/composables/useProducts';

defineProps<{ product: Product }>();
</script>

<template>
  <BaseCard :title="product.name">
    <BaseBadge v-if="product.stock > 0" tone="success">In stock</BaseBadge>
    <p>{{ formatPrice(product.price) }}</p>
    <BaseButton size="sm">Add to cart</BaseButton>
  </BaseCard>
</template>
