<script setup lang="ts">
import type { NuxtError } from '#app';

defineProps<{ error: NuxtError }>();
</script>

<template>
  <main>
    <h1>{{ error.statusCode }}</h1>
    <BaseButton variant="primary" @click="clearError({ redirect: '/' })">Back home</BaseButton>
  </main>
</template>
