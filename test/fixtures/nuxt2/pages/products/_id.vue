<template>
  <BaseCard>
    <BaseButton variant="danger" size="lg">Buy</BaseButton>
  </BaseCard>
</template>
<script>
export default { layout: 'dashboard', middleware: 'auth' };
</script>
