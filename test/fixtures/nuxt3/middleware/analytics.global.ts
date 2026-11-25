export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.client) console.debug('page view', to.fullPath);
});
