<script setup lang="ts">
const route = useRoute();
const product = useProducts().find(String(route.params.id));
const available = computed(() => (product?.stock ?? 0) > 0);
</script>

<template>
  <BaseCard v-if="product" :title="product.name">
    <BaseBadge :tone="available ? 'success' : 'warning'">{{ available ? 'In stock' : 'Sold out' }}</BaseBadge>
    <p>{{ formatPrice(product.price) }}</p>
    <BaseButton :variant="available ? 'primary' : 'default'" :disabled="!available">Add to cart</BaseButton>
  </BaseCard>
</template>
