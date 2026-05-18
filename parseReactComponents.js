const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function parseComponentForStateAndRedux(fileContent) {
  const ast = parser.parse(fileContent, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });

  let state = [];
  let reduxProps = [];
  let actions = [];  // Dispatched action names
  let componentName = '';
  let children = [];
  const childProps = {}; // Props per child: { ChildName: { stateProps: [], functionProps: [], otherProps: [] } }
  const importMap = {};
  const variableDeclarations = {}; // Track variable declarations for lookup

  // Enhanced Redux tracking
  let reduxSlices = [];  // Which reducer slices are accessed (e.g., ['bootstrap', 'adsApp'])
  let usesSelectorHook = false;
  let usesDispatchHook = false;
  let selectorExpressions = [];  // Selector functions/expressions from useSelector
  const actionImports = {};  // Track action module imports: { 'BootstrapActions': './actions/bootstrap' }

  // Extract reducer slices from mapStateToProps destructuring
  // e.g., const { bootstrap, adsApp } = state; or (state) => { const { bootstrap } = state; ... }
  function extractReducerSlices(funcNode) {
    if (!funcNode) return [];
    const slices = new Set();

    // Get the state parameter name (usually 'state')
    const stateParam = funcNode.params?.[0];
    const stateParamName = stateParam?.name || 'state';

    function visitNode(node) {
      if (!node) return;

      // Look for destructuring: const { bootstrap, adsApp } = state
      if (node.type === 'VariableDeclaration') {
        node.declarations.forEach(decl => {
          if (
            decl.id?.type === 'ObjectPattern' &&
            decl.init?.type === 'Identifier' &&
            decl.init.name === stateParamName
          ) {
            decl.id.properties.forEach(prop => {
              if (prop.key?.name) slices.add(prop.key.name);
            });
          }
        });
      }

      // Look for state.X access patterns
      if (
        node.type === 'MemberExpression' &&
        node.object?.type === 'Identifier' &&
        node.object.name === stateParamName &&
        node.property?.name
      ) {
        slices.add(node.property.name);
      }

      // Recursively visit children
      for (const key in node) {
        if (node[key] && typeof node[key] === 'object') {
          if (Array.isArray(node[key])) {
            node[key].forEach(child => visitNode(child));
          } else {
            visitNode(node[key]);
          }
        }
      }
    }

    visitNode(funcNode.body);
    return Array.from(slices);
  }

  // Extract dispatched actions from mapDispatchToProps
  // Handles: dispatch(Actions.doSomething()), dispatch(doSomething())
  function extractActionsFromMapDispatch(mapDispatchNode) {
    if (!mapDispatchNode) return [];
    const extractedActions = new Set();

    function findDispatchCalls(node) {
      if (!node) return;

      // Look for dispatch(X) calls
      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'Identifier' &&
        node.callee.name === 'dispatch' &&
        node.arguments?.[0]
      ) {
        const arg = node.arguments[0];
        // dispatch(Actions.doSomething(...))
        if (arg.type === 'CallExpression' && arg.callee?.type === 'MemberExpression') {
          const obj = arg.callee.object?.name;
          const prop = arg.callee.property?.name;
          if (obj && prop) extractedActions.add(`${obj}.${prop}`);
        }
        // dispatch(doSomething(...))
        else if (arg.type === 'CallExpression' && arg.callee?.type === 'Identifier') {
          extractedActions.add(arg.callee.name);
        }
      }

      // Recursively visit children
      for (const key in node) {
        if (node[key] && typeof node[key] === 'object') {
          if (Array.isArray(node[key])) {
            node[key].forEach(child => findDispatchCalls(child));
          } else {
            findDispatchCalls(node[key]);
          }
        }
      }
    }

    findDispatchCalls(mapDispatchNode);
    return Array.from(extractedActions);
  }

  // Legacy function for backwards compatibility
  function extractActionName(callExpression) {
    if (
      callExpression.callee &&
      callExpression.callee.type === 'Identifier' &&
      callExpression.arguments.length
    ) {
      const firstArg = callExpression.arguments[0];
      if (
        firstArg.type === 'CallExpression' &&
        firstArg.callee.type === 'MemberExpression' &&
        firstArg.callee.object &&
        firstArg.callee.property
      ) {
        return `${firstArg.callee.object.name}.${firstArg.callee.property.name}`;
      }
    }
    return null;
  }

  function extractReduxPropsFromFunction(funcNode) {
    if (!funcNode) return [];
    const props = [];
    const body = funcNode.body;

    // Handle block body: (state) => { return {...} } or function(state) { return {...} }
    if (body?.type === 'BlockStatement') {
      body.body.forEach(statement => {
        if (statement.type === 'ReturnStatement' && statement.argument?.type === 'ObjectExpression') {
          props.push(...statement.argument.properties.map(prop => prop.key?.name).filter(Boolean));
        }
      });
    }
    // Handle expression body: (state) => ({...})
    else if (body?.type === 'ObjectExpression') {
      props.push(...body.properties.map(prop => prop.key?.name).filter(Boolean));
    }

    return props;
  }

  function isThisStateMemberExpression(expr) {
    // Check for this.state.X pattern
    return (
      expr?.type === 'MemberExpression' &&
      expr.object?.type === 'MemberExpression' &&
      expr.object.object?.type === 'ThisExpression' &&
      expr.object.property?.name === 'state'
    );
  }
  

  traverse(ast, {
    ClassDeclaration(path) {
      componentName = path.node.id.name;
    },
    FunctionDeclaration(path) {
      // Capture functional component names (PascalCase functions)
      const name = path.node.id?.name;
      if (name && /^[A-Z]/.test(name) && !componentName) {
        componentName = name;
      }
    },
    ClassProperty(path) {
      if (path.node.key.name === 'state' && !path.node.static) {
        if (path.node.value.type === 'ObjectExpression') {
          state = path.node.value.properties.map(prop => prop.key.name);
        }
      }
    },
    VariableDeclaration(path) {
      path.node.declarations.forEach(declaration => {
        const name = declaration.id?.name;
        if (name && declaration.init) {
          variableDeclarations[name] = declaration.init;

          // Capture arrow function components (PascalCase variables with function init)
          if (
            /^[A-Z]/.test(name) &&
            !componentName &&
            (declaration.init.type === 'ArrowFunctionExpression' ||
              declaration.init.type === 'FunctionExpression')
          ) {
            componentName = name;
          }
        }
        if (name === 'mapDispatchToProps') {
          extractActionsFromMapDispatch(declaration.init);
        }

        // Capture useState hooks: const [value, setValue] = useState(...)
        if (
          declaration.id?.type === 'ArrayPattern' &&
          declaration.init?.type === 'CallExpression' &&
          declaration.init.callee?.name === 'useState'
        ) {
          const stateName = declaration.id.elements[0]?.name;
          if (stateName) {
            state.push(stateName);
          }
        }

        // Capture useSelector hooks: const value = useSelector(state => state.x)
        if (
          declaration.init?.type === 'CallExpression' &&
          declaration.init.callee?.name === 'useSelector'
        ) {
          usesSelectorHook = true;
          const selectorArg = declaration.init.arguments[0];
          // Extract what's being selected
          if (selectorArg?.type === 'ArrowFunctionExpression' || selectorArg?.type === 'FunctionExpression') {
            const slices = extractReducerSlices(selectorArg);
            slices.forEach(s => {
              if (!reduxSlices.includes(s)) reduxSlices.push(s);
            });
            // Track the selected value as a redux prop
            if (declaration.id?.name) {
              reduxProps.push(declaration.id.name);
            }
          }
        }

        // Capture useDispatch hooks: const dispatch = useDispatch()
        if (
          declaration.init?.type === 'CallExpression' &&
          declaration.init.callee?.name === 'useDispatch'
        ) {
          usesDispatchHook = true;
        }
      });
    },  
    
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type === 'Identifier' && callee.name === 'connect') {
        const [mapStateToProps, mapDispatchToProps] = path.node.arguments;

        // Extract Redux props from mapStateToProps
        let mapStateFn = mapStateToProps;
        // If it's an identifier, look up the variable declaration
        if (mapStateToProps?.type === 'Identifier') {
          mapStateFn = variableDeclarations[mapStateToProps.name];
        }
        if (mapStateFn?.type === 'FunctionExpression' || mapStateFn?.type === 'ArrowFunctionExpression') {
          reduxProps.push(...extractReduxPropsFromFunction(mapStateFn));
          // Extract reducer slices accessed
          const slices = extractReducerSlices(mapStateFn);
          slices.forEach(s => {
            if (!reduxSlices.includes(s)) reduxSlices.push(s);
          });
        }

        // Extract actions from mapDispatchToProps
        let mapDispatchFn = mapDispatchToProps;
        if (mapDispatchToProps?.type === 'Identifier') {
          mapDispatchFn = variableDeclarations[mapDispatchToProps.name];
        }
        if (
          mapDispatchFn?.type === 'ArrowFunctionExpression' ||
          mapDispatchFn?.type === 'FunctionExpression'
        ) {
          const extractedActions = extractActionsFromMapDispatch(mapDispatchFn);
          extractedActions.forEach(a => {
            if (!actions.includes(a)) actions.push(a);
          });
        }
      }
    },

    // Capture ALL imports for resolving paths
    ImportDeclaration(path) {
      const importedModule = path.node.source.value;
      path.node.specifiers.forEach(specifier => {
        // Default import: import Foo from './foo'
        if (specifier.type === 'ImportDefaultSpecifier') {
          importMap[specifier.local.name] = importedModule;
        }
        // Named import: import { Foo, Bar as Baz } from './foo'
        else if (specifier.type === 'ImportSpecifier') {
          importMap[specifier.local.name] = importedModule;
        }
        // Namespace import: import * as Foo from './foo'
        else if (specifier.type === 'ImportNamespaceSpecifier') {
          importMap[specifier.local.name] = importedModule;
          // Track action imports (typically end with Actions or from actions/ directory)
          if (
            specifier.local.name.endsWith('Actions') ||
            importedModule.includes('/actions/') ||
            importedModule.includes('/actions')
          ) {
            actionImports[specifier.local.name] = importedModule;
          }
        }
      });
    },

    // Capture child components and categorize props per child
    JSXElement(path) {
      const childName = path.node.openingElement.name.name;

      // Exclude standard HTML tags
      if (/^[a-z]/.test(childName)) return;

      // Only add to children list if not already present
      if (!children.includes(childName)) {
        children.push(childName);
      }

      // Initialize props for this child if not exists
      if (!childProps[childName]) {
        childProps[childName] = { stateProps: [], functionProps: [], otherProps: [] };
      }

      const attributes = path.node.openingElement.attributes || [];
      attributes.forEach(attr => {
        if (attr.type === 'JSXSpreadAttribute') {
          if (!childProps[childName].otherProps.includes('...spread')) {
            childProps[childName].otherProps.push('...spread');
          }
        } else if (attr.name && attr.name.name) {
          const propName = attr.name.name;
          const propValue = attr.value;
          const expr = propValue?.expression;

          // Check for this.state.X pattern (state prop)
          if (isThisStateMemberExpression(expr) && state.includes(expr.property?.name)) {
            if (!childProps[childName].stateProps.includes(propName)) {
              childProps[childName].stateProps.push(propName);
            }
          }
          // Check for this.X pattern (method/function prop)
          else if (
            expr?.type === 'MemberExpression' &&
            expr.object?.type === 'ThisExpression'
          ) {
            if (!childProps[childName].functionProps.includes(propName)) {
              childProps[childName].functionProps.push(propName);
            }
          } else {
            if (!childProps[childName].otherProps.includes(propName)) {
              childProps[childName].otherProps.push(propName);
            }
          }
        }
      });
    }
  });

  // Determine Redux connection type
  const isConnected = reduxProps.length > 0 || actions.length > 0;
  const usesHooks = usesSelectorHook || usesDispatchHook;

  return {
    name: componentName,
    state,
    reduxProps,
    actions,
    children,
    childProps,
    importMap,
    // Enhanced Redux data
    redux: {
      isConnected,
      usesHooks,
      usesSelectorHook,
      usesDispatchHook,
      slices: reduxSlices,  // Which reducer slices are accessed
      actionImports,  // Action module imports
    },
  };
}

module.exports = parseComponentForStateAndRedux;
