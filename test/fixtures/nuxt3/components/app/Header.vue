<script setup lang="ts">
const { count } = useCart();
</script>

<template>
  <header>
    <NuxtLink to="/">Shop</NuxtLink>
    <span>{{ count }} items</span>
    <BaseButton variant="primary" size="sm">Sign in</BaseButton>
  </header>
</template>
