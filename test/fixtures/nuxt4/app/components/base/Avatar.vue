<script setup lang="ts">
defineProps<{ src: string }>();
</script>

<template>
  <img class="avatar" :src="src" alt="" />
</template>
