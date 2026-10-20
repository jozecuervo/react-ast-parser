'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const parseComponent = require('../parseReactComponents');

function parse(source) {
  return parseComponent(source, [], 'Fixture.jsx');
}

// Parse failures are reported through console.error; keep the test output clean.
function parseQuietly(t, source) {
  const errors = t.mock.method(console, 'error', () => {});
  const result = parse(source);
  return { result, errors };
}

test('empty input yields an Unknown component with empty collections', () => {
  assert.deepEqual(parse(''), {
    name: 'Unknown',
    state: null,
    reduxProps: [],
    actions: [],
    children: [],
    props: {},
    importMap: {},
    filePath: 'Fixture.jsx',
  });
});

test('the filePath argument is echoed back', () => {
  assert.equal(parseComponent('', [], 'some/File.jsx').filePath, 'some/File.jsx');
  assert.equal(parseComponent('').filePath, '');
});

test('function declaration is named after the function', () => {
  const result = parse('function TodoItem() { return <li />; }');
  assert.equal(result.name, 'TodoItem');
  assert.equal(result.state, null);
});

test('arrow function component is named after the variable', () => {
  assert.equal(parse('const TodoList = () => <ul />;').name, 'TodoList');
});

test('class component is named after the class', () => {
  assert.equal(parse('class Counter extends React.Component { render() { return <b />; } }').name, 'Counter');
});

test('anonymous default-exported function falls back to Unknown', () => {
  assert.equal(parse('export default function () { return <div />; }').name, 'Unknown');
});

test('the first declaration wins the name', () => {
  // BUG? A helper declared before the component names the whole file, and a
  // concise-bodied arrow helper (e.g. mapState) does too.
  assert.equal(parse('function helper() {}\nfunction App() { return <div />; }').name, 'helper');
  assert.equal(parse('const mapState = s => ({ a: s.a });\nfunction App() {}').name, 'mapState');
});

test('class property state lists the keys of the object literal', () => {
  const result = parse('class Counter extends React.Component { state = { count: 0, label: "x" }; }');
  assert.deepEqual(result.state, ['count', 'label']);
});

test('class property state that is not an object literal is "Dynamic State"', () => {
  const result = parse('class Counter extends React.Component { state = makeState(); }');
  assert.deepEqual(result.state, ['Dynamic State']);
});

test('static state is ignored', () => {
  assert.equal(parse('class Counter { static state = { a: 1 }; }').state, null);
});

test('this.state assigned in the constructor is not detected', () => {
  // BUG? The README lists class state as supported, but only the class
  // property form (`state = {...}`) is recognised.
  const result = parse(
    'class Counter extends React.Component { constructor() { super(); this.state = { count: 0 }; } }'
  );
  assert.equal(result.state, null);
});

test('useState and useReducer are recorded by hook name, once per call', () => {
  // BUG? State entries carry no variable names, and repeated hooks repeat
  // the same label.
  const result = parse(
    'function C() { const [a] = useState(1); const [b] = useState(2); const [c] = useReducer(f, 0); return <div />; }'
  );
  assert.deepEqual(result.state, ['Hook: useState', 'Hook: useState', 'Hook: useReducer']);
});

test('hook state is appended after class property state', () => {
  const result = parse('class C { state = { a: 1 }; render() { useState(0); } }');
  assert.deepEqual(result.state, ['a', 'Hook: useState']);
});

test('connect with a block-bodied mapState function lists the returned keys', () => {
  const result = parse(
    'function App() {}\nexport default connect(function (state) { return { user: state.user, theme: state.theme }; })(App);'
  );
  assert.deepEqual(result.reduxProps, ['user', 'theme']);
});

test('connect with an arrow mapState and a block body lists the returned keys', () => {
  const result = parse('function App() {}\nexport default connect(state => { return { user: state.user }; })(App);');
  assert.deepEqual(result.reduxProps, ['user']);
});

test('connect with an implicit-return arrow mapState records the object keys', () => {
  const result = parse('function App() {}\nexport default connect(state => ({ user: state.user, theme: state.theme }))(App);');
  assert.deepEqual(result.reduxProps, ['user', 'theme']);
});

test('connect with mapState passed by name resolves an arrow declared in the file', () => {
  const result = parse(
    'function App() {}\nconst mapStateToProps = state => { return { user: state.user }; };\nexport default connect(mapStateToProps)(App);'
  );
  assert.deepEqual(result.reduxProps, ['user']);
});

test('connect with mapState passed by name resolves a function declaration, even one declared later', () => {
  const result = parse(
    'function App() {}\nexport default connect(mapState)(App);\nfunction mapState(state) { return { a: state.a, b: state.b }; }'
  );
  assert.deepEqual(result.reduxProps, ['a', 'b']);
});

test('connect mapState with returns inside if/else, switch and try collects every returned object', () => {
  const mixed = parse('connect(s => { if (s.a) { return { a: 1 }; } return { b: 2 }; })(App);');
  assert.deepEqual(mixed.reduxProps, ['a', 'b']);
  const nested = parse('connect(s => { if (s.a) { return { a: 1, c: 3 }; } else { return { b: 2, a: 4 }; } })(App);');
  assert.deepEqual(nested.reduxProps, ['a', 'c', 'b']);
  const other = parse(
    'connect(function (s) { switch (s.k) { case 1: return { x: 1 }; default: try { return { y: 2 }; } catch (e) { return { z: 3 }; } } })(App);'
  );
  assert.deepEqual(other.reduxProps, ['x', 'y', 'z']);
});

test('connect mapDispatch with nested returns collects every returned object', () => {
  const result = parse('connect(null, d => { if (d) { return { a: 1 }; } return { b: 2 }; })(App);');
  assert.deepEqual(result.actions, ['a', 'b']);
});

test('a return inside a nested function is not counted', () => {
  const result = parse(
    'connect(s => { const pick = k => { return { inner: k }; }; function h() { return { inner2: 1 }; } return { outer: pick(s) }; })(App);'
  );
  assert.deepEqual(result.reduxProps, ['outer']);
  assert.deepEqual(
    parse('connect(s => { const f = () => { return { inner: 1 }; }; return f(); })(App);').reduxProps,
    []
  );
});

test('connect with an unresolvable mapState identifier records nothing', () => {
  const result = parse('import { mapState } from "./sel";\nfunction App() {}\nexport default connect(mapState)(App);');
  assert.deepEqual(result.reduxProps, []);
  assert.deepEqual(parse('connect(missing)(App);').reduxProps, []);
});

test('connect mapDispatch as an object records shorthand and renamed action keys', () => {
  const result = parse('function App() {}\nexport default connect(null, { addTodo, remove: removeTodo })(App);');
  assert.deepEqual(result.actions, ['addTodo', 'remove']);
  assert.deepEqual(result.reduxProps, []);
});

test('connect mapDispatch as a function or arrow returning an object records its keys', () => {
  assert.deepEqual(
    parse('connect(null, dispatch => ({ add: () => dispatch({ type: "ADD" }) }))(App);').actions,
    ['add']
  );
  assert.deepEqual(
    parse('connect(null, function (dispatch) { return { add: 1, del: 2 }; })(App);').actions,
    ['add', 'del']
  );
});

test('connect mapDispatch passed by name resolves a function declared in the file', () => {
  const result = parse(
    'const mapDispatch = dispatch => ({ save: () => dispatch({ type: "S" }) });\nconnect(null, mapDispatch)(App);'
  );
  assert.deepEqual(result.actions, ['save']);
  assert.deepEqual(parse('import { md } from "./x";\nconnect(null, md)(App);').actions, []);
});

test('useSelector and useDispatch are recorded as hook labels, once per call', () => {
  // BUG? These land in reduxProps as "Hook: ..." strings, not as store keys.
  const result = parse(
    'function C() { const a = useSelector(s => s.a); const b = useSelector(s => s.b); const d = useDispatch(); }'
  );
  assert.deepEqual(result.reduxProps, ['Hook: useSelector', 'Hook: useSelector', 'Hook: useDispatch']);
});

test('default, named (aliased) and namespace imports populate importMap by local name', () => {
  const result = parse(
    'import React from "react";\nimport Def, { Named as Alias, Plain } from "./n";\nimport * as Mod from "./m";'
  );
  assert.deepEqual(result.importMap, {
    React: 'react',
    Def: './n',
    Alias: './n',
    Plain: './n',
    Mod: './m',
  });
});

test('side-effect-only imports add nothing to importMap', () => {
  assert.deepEqual(parse('import "./styles.css";').importMap, {});
});

test('JSX children: capitalised elements only, de-duplicated, with merged props', () => {
  const result = parse(
    'function App() { return <div><TodoItem id="1" /><TodoItem done /><span /><Counter {...rest} /></div>; }'
  );
  assert.deepEqual(result.children, ['TodoItem', 'Counter']);
  assert.deepEqual(result.props, {
    TodoItem: ['id', 'done'],
    Counter: ['...spread'],
  });
});

test('children inside fragments and nested elements are found', () => {
  const result = parse('function App() { return <><div><Inner /></div></>; }');
  assert.deepEqual(result.children, ['Inner']);
});

test('a child with no attributes gets an empty props list', () => {
  assert.deepEqual(parse('function App() { return <Kid />; }').props, { Kid: [] });
});

test('a member-expression element is recorded by its property name only', () => {
  // BUG? <Mod.Inner /> is stored as "Inner", but importMap has "Mod", so the
  // CLI can never resolve this child.
  const result = parse('import * as Mod from "./m";\nfunction App() { return <Mod.Inner />; }');
  assert.deepEqual(result.children, ['Inner']);
  assert.deepEqual(result.importMap, { Mod: './m' });
});

test('TypeScript syntax parses', () => {
  const result = parse('const n: number = 1;\nfunction App(): JSX.Element { return <Kid />; }');
  assert.equal(result.name, 'App');
  assert.deepEqual(result.children, ['Kid']);
});

test('a file that fails to parse returns a ParseError record', (t) => {
  const { result, errors } = parseQuietly(t, 'function App() { return <div>; }');
  assert.equal(result.name, 'ParseError');
  assert.match(result.error, /Unterminated JSX contents/);
  assert.deepEqual(
    { ...result, error: undefined },
    {
      name: 'ParseError',
      state: null,
      reduxProps: [],
      actions: [],
      children: [],
      props: {},
      importMap: {},
      filePath: 'Fixture.jsx',
      error: undefined,
    }
  );
  assert.equal(errors.mock.callCount(), 1);
});

test('an anonymous default-exported class is named after the file basename', (t) => {
  const source = 'export default class extends React.Component { render() { return <div />; } }';
  const { result, errors } = parseQuietly(t, source);
  assert.equal(result.name, 'Fixture');
  assert.equal(result.error, undefined);
  assert.equal(errors.mock.callCount(), 0);
});

test('an anonymous default-exported class in an index file is named after its directory', () => {
  const source = 'export default class extends React.Component {}';
  assert.equal(parseComponent(source, [], '/src/Widget/index.js').name, 'Widget');
  assert.equal(parseComponent(source, [], '/src/Panel.tsx').name, 'Panel');
});
