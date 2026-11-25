<template>
  <div><NuxtChild /></div>
</template>
<script>
import BaseCard from '~/components/base/Card.vue';
export default { components: { BaseCard }, layout: 'dashboard' };
</script>
