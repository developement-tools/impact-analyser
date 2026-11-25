<template>
  <button :class="['btn', 'btn-' + variant]"><slot /></button>
</template>
<script>
export default { props: { variant: { type: String, default: 'default' }, size: { type: String, default: 'md' } } };
</script>
