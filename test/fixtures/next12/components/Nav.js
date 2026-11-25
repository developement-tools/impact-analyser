import { withRouter } from 'next/router';

function Nav({ router }) {
  return <nav>{router.pathname}</nav>;
}

// Default export wrapped in a HOC: the component is named after the file.
export default withRouter(Nav);
