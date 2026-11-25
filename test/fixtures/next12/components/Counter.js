import React from 'react';
import Button from './Button';

// Class component (pre-hooks code bases).
export default class Counter extends React.Component {
  state = { count: this.props.start };

  render() {
    return <Button onClick={() => this.setState({ count: this.state.count + 1 })}>{this.state.count}</Button>;
  }
}
