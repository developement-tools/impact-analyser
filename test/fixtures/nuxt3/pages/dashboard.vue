<script setup lang="ts">
// Parent route: wraps /dashboard and /dashboard/settings.
definePageMeta({ layout: 'dashboard', middleware: 'auth' });
</script>

<template>
  <section>
    <h1>Dashboard</h1>
    <NuxtPage />
  </section>
</template>
