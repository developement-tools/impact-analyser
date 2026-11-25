export default {
  components: true,
  plugins: ['~/plugins/toast.js'],
  router: { middleware: ['analytics'] },
};
