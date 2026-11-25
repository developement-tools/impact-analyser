export default defineNuxtRouteMiddleware(() => {
  const { count } = useCart();
  if (count.value < 0) return navigateTo('/');
});
