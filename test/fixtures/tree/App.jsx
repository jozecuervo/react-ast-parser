import React from 'react';
import { connect } from 'react-redux';
import TodoList from './components/TodoList';
import Counter from './Counter';

class App extends React.Component {
  state = { filter: 'all', showDone: false };

  render() {
    return (
      <div>
        <TodoList filter="all" onSelect={this.select} />
        <Counter {...this.props} />
        <TodoList filter="done" />
      </div>
    );
  }
}

export default connect(
  state => {
    return { user: state.user, theme: state.theme };
  },
  dispatch => ({ addTodo: text => dispatch({ type: 'ADD', text }) })
)(App);
