const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const nodePath = require('path');

// Name for a component that has no identifier: the file's basename without
// extension, or its directory's name when the file is index.*
function nameFromFilePath(filePath) {
  if (!filePath) return '';
  const base = nodePath.basename(filePath, nodePath.extname(filePath));
  return base === 'index' ? nodePath.basename(nodePath.dirname(filePath)) : base;
}

const isFunctionNode = node =>
  node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionDeclaration';

// A function or arrow, or an identifier that resolves to one declared in this file
function resolveFunction(arg, scope) {
  if (arg?.type !== 'Identifier') return isFunctionNode(arg) ? arg : null;
  const declaration = scope.getBinding(arg.name)?.path.node;
  const fn = declaration?.type === 'VariableDeclarator' ? declaration.init : declaration;
  return isFunctionNode(fn) ? fn : null;
}

const objectKeys = objectExpression =>
  objectExpression.properties.filter(prop => prop.key?.name).map(prop => prop.key.name);

const NESTED_FUNCTION_TYPES = [
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod',
];

// Collect every ObjectExpression returned in a function body, not descending into nested functions
function collectReturnedObjects(node, found) {
  if (!node || typeof node.type !== 'string') return;
  if (NESTED_FUNCTION_TYPES.includes(node.type)) return;
  if (node.type === 'ReturnStatement') {
    if (node.argument?.type === 'ObjectExpression') found.push(node.argument);
    return;
  }
  Object.values(node).forEach(value => {
    if (Array.isArray(value)) value.forEach(child => collectReturnedObjects(child, found));
    else if (value && typeof value === 'object') collectReturnedObjects(value, found);
  });
}

// Union of the keys of every object a function returns (first-seen order), from a block body or a concise arrow body
function returnedKeys(fn) {
  const objects = [];
  if (fn.body.type === 'BlockStatement') {
    fn.body.body.forEach(statement => collectReturnedObjects(statement, objects));
  } else if (fn.body.type === 'ObjectExpression') {
    objects.push(fn.body);
  }
  return [...new Set(objects.flatMap(objectKeys))];
}

// Dotted path after the parameter for a selector like `s => s.posts.items`; '' when it is not a plain member chain
function selectorPath(fn) {
  const param = fn.params[0];
  if (param?.type !== 'Identifier') return '';
  let body = fn.body;
  if (body.type === 'BlockStatement') {
    body = body.body.length === 1 && body.body[0].type === 'ReturnStatement' ? body.body[0].argument : null;
  }
  const parts = [];
  while (body?.type === 'MemberExpression' && !body.computed && body.property.type === 'Identifier') {
    parts.unshift(body.property.name);
    body = body.object;
  }
  return body?.type === 'Identifier' && body.name === param.name ? parts.join('.') : '';
}

// Dotted name of a JSX element name: Mod.Inner, A.B.C
function jsxMemberName(node) {
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') {
    const object = jsxMemberName(node.object);
    return object ? `${object}.${node.property.name}` : undefined;
  }
  return undefined;
}

function parseComponentForStateAndRedux(fileContent, componentHierarchy, filePath = '') {
  try {
    const ast = parser.parse(fileContent, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
    });

    let state = null;
    let reduxProps = [];
    let actions = [];
    let componentName = '';
    let capitalisedName = ''; // first named declaration starting with A-Z; wins over componentName
    const childrenSet = new Set(); // Use Set to prevent duplicates
    let props = {};
    const importMap = {}; // Track import paths
    let hookState = []; // Track useState/useReducer

    traverse(ast, {
      // Handle class components
      ClassDeclaration(path) {
        if (!componentName) {
          componentName = path.node.id ? path.node.id.name : nameFromFilePath(filePath);
        }
        if (!capitalisedName && /^[A-Z]/.test(path.node.id?.name || '')) {
          capitalisedName = path.node.id.name;
        }
      },
      ClassProperty(path) {
        if (path.node.key.name === 'state' && !path.node.static) {
          if (path.node.value?.type === 'ObjectExpression') {
            state = path.node.value.properties
              .filter(prop => prop.key?.name)
              .map(prop => prop.key.name);
          } else {
            state = ['Dynamic State'];
          }
        }
      },

      // Handle functional components and arrow functions
      AssignmentExpression(path) {
        const { left, right, operator } = path.node;
        if (
          operator === '=' &&
          left.type === 'MemberExpression' && !left.computed &&
          left.object.type === 'ThisExpression' && left.property.name === 'state'
        ) {
          const method = path.getFunctionParent()?.node;
          if (method?.type === 'ClassMethod' && method.kind === 'constructor') {
            state = right.type === 'ObjectExpression' ? objectKeys(right) : ['Dynamic State'];
          }
        }
      },
      FunctionDeclaration(path) {
        if (!componentName && path.node.id) {
          componentName = path.node.id.name;
        }
        if (!capitalisedName && /^[A-Z]/.test(path.node.id?.name || '')) {
          capitalisedName = path.node.id.name;
        }
      },
      VariableDeclarator(path) {
        if (!componentName && path.node.init?.type === 'ArrowFunctionExpression') {
          if (path.node.id?.name) {
            componentName = path.node.id.name;
          }
        }
        if (!capitalisedName && path.node.init?.type === 'ArrowFunctionExpression' && /^[A-Z]/.test(path.node.id?.name || '')) {
          capitalisedName = path.node.id.name;
        }
      },

      // Handle useState and useReducer hooks for state detection
      CallExpression(path) {
        const callee = path.node.callee;

        if (callee.type === 'Identifier') {
          // Redux connect handling
          if (callee.name === 'connect') {
            const mapStateToProps = resolveFunction(path.node.arguments[0], path.scope);
            if (mapStateToProps) {
              reduxProps = [...new Set([...reduxProps, ...returnedKeys(mapStateToProps)])];
            }
            const mapDispatchToProps = path.node.arguments[1];
            if (mapDispatchToProps?.type === 'ObjectExpression') {
              actions = objectKeys(mapDispatchToProps);
            } else {
              const mapDispatch = resolveFunction(mapDispatchToProps, path.scope);
              if (mapDispatch) {
                actions = returnedKeys(mapDispatch);
              }
            }
          }
          // React hooks for state
          else if (['useState', 'useReducer'].includes(callee.name)) {
            if (!hookState) hookState = [];
            const parent = path.parent;
            const id = parent.type === 'VariableDeclarator' && parent.init === path.node ? parent.id : null;
            const first = id?.type === 'ArrayPattern' ? id.elements[0] : null;
            hookState.push(first?.type === 'Identifier' ? first.name : `Hook: ${callee.name}`);
          }
          // Redux hooks: useSelector records the store path it reads; useDispatch records nothing
          else if (callee.name === 'useSelector') {
            const selector = resolveFunction(path.node.arguments[0], path.scope);
            const selected = selector ? selectorPath(selector) : '';
            if (selected) reduxProps = [...new Set([...reduxProps, selected])];
          }
        }
      },

      ImportDeclaration(path) {
        const importedModule = path.node.source.value;
        path.node.specifiers.forEach(specifier => {
          if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
            importMap[specifier.local.name] = importedModule;
          } else if (specifier.type === 'ImportSpecifier') {
            // Also track named imports for named components
            importMap[specifier.local.name] = importedModule;
          }
        });
      },

      JSXElement(path) {
        const elementName = path.node.openingElement.name;
        let childName;

        // Handle simple identifiers like <Component />
        if (elementName.type === 'JSXIdentifier') {
          childName = elementName.name;
        }
        // Handle member expressions like <Module.Component />
        else if (elementName.type === 'JSXMemberExpression') {
          childName = jsxMemberName(elementName);
        }

        // Exclude standard HTML tags (lowercase); a member expression is judged by its last property
        if (!childName || /^[a-z]/.test(childName.slice(childName.lastIndexOf('.') + 1))) return;

        // Add to set to avoid duplicates
        childrenSet.add(childName);

        // Capture attributes/props for this child
        const attributes = path.node.openingElement.attributes || [];
        if (!props[childName]) {
          props[childName] = [];
        }
        const childProps = attributes
          .map(attr => {
            if (attr.name?.name) {
              return attr.name.name;
            } else if (attr.type === 'JSXSpreadAttribute') {
              return '...spread';
            }
            return null;
          })
          .filter(Boolean);

        props[childName] = [...new Set([...props[childName], ...childProps])];
      },

      JSXFragment(path) {
        // Handle React fragments - look for child elements within them
        // Fragments don't contribute to dependency tracking themselves
      }
    });

    // Merge hookState into state if present
    if (hookState.length > 0) {
      state = state ? [...(Array.isArray(state) ? state : [state]), ...hookState] : hookState;
      state = [...new Set(state)];
    }

    return {
      name: capitalisedName || componentName || 'Unknown',
      state,
      reduxProps: reduxProps.length > 0 ? reduxProps : [],
      actions: actions.length > 0 ? actions : [],
      children: Array.from(childrenSet), // Convert Set to array
      props,
      importMap,
      filePath,
    };
  } catch (error) {
    console.error(`Error parsing file ${filePath}: ${error.message}`);
    // Return a minimal component data structure so analysis can continue
    return {
      name: 'ParseError',
      state: null,
      reduxProps: [],
      actions: [],
      children: [],
      props: {},
      importMap: {},
      filePath,
      error: error.message,
    };
  }
}

module.exports = parseComponentForStateAndRedux;
