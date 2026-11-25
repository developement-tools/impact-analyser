export const Unused = () => import('../../components/Unused.vue' /* webpackChunkName: "components/unused" */).then(c => wrapFunctional(c.default || c))
export const AppHeader = () => import('../../components/app/Header.vue' /* webpackChunkName: "components/app-header" */).then(c => wrapFunctional(c.default || c))
export const BaseButton = () => import('../../components/base/Button.vue' /* webpackChunkName: "components/base-button" */).then(c => wrapFunctional(c.default || c))
export const BaseCard = () => import('../../components/base/Card.vue' /* webpackChunkName: "components/base-card" */).then(c => wrapFunctional(c.default || c))

// nuxt/nuxt.js#8607
function wrapFunctional(options) {
  if (!options || !options.functional) {
    return options
  }

  const propKeys = Array.isArray(options.props) ? options.props : Object.keys(options.props || {})

  return {
    render(h) {
      const attrs = {}
      const props = {}

      for (const key in this.$attrs) {
        if (propKeys.includes(key)) {
          props[key] = this.$attrs[key]
        } else {
          attrs[key] = this.$attrs[key]
        }
      }

      return h(options, {
        on: this.$listeners,
        attrs,
        props,
        scopedSlots: this.$scopedSlots,
      }, this.$slots.default)
    }
  }
}
