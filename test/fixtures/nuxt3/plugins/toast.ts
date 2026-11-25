export default defineNuxtPlugin(() => {
  return { provide: { toast: (message: string) => console.info(message) } };
});
