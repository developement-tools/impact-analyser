<script setup lang="ts">
const { products } = useProducts();
</script>

<template>
  <main>
    <ProductCard v-for="product in products" :key="product.id" :product="product" />
  </main>
</template>
