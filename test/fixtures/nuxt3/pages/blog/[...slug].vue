<script setup lang="ts">
// Explicit import instead of the auto-import: must resolve to the same component.
import BaseCard from '~/components/base/Card.vue';

const route = useRoute();
</script>

<template>
  <BaseCard :title="String(route.params.slug)">Blog post</BaseCard>
</template>
