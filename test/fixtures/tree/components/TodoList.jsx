import React from 'react';
import TodoItem from './TodoItem';

const TodoList = ({ items }) => (
  <ul>
    {items.map(item => (
      <TodoItem key={item.id} item={item} />
    ))}
  </ul>
);

export default TodoList;
