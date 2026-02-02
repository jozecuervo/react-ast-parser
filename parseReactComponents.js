const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function parseComponentForStateAndRedux(fileContent) {
  const ast = parser.parse(fileContent, {
    sourceType: 'module',
    plugins: ['jsx']
  });

  let state = [];
  let reduxProps = [];
  let actions = [];
  let componentName = '';
  let children = [];
  const childProps = {}; // Props per child: { ChildName: { stateProps: [], functionProps: [], otherProps: [] } }
  const importMap = {};
  const variableDeclarations = {}; // Track variable declarations for lookup

  function extractActionsFromMapDispatch(mapDispatchNode) {
    const actions = [];
  
    if (!mapDispatchNode || !mapDispatchNode.body) return actions;
  
    // Ensure we only handle the correct structure
    if (mapDispatchNode.body.type === 'BlockStatement') {
      mapDispatchNode.body.body.forEach(statement => {
        if (
          statement.type === 'ReturnStatement' &&
          statement.argument &&
          statement.argument.type === 'ObjectExpression'
        ) {
          statement.argument.properties.forEach(property => {
            if (
              property.value &&
              (property.value.type === 'ArrowFunctionExpression' ||
                property.value.type === 'FunctionExpression') &&
              property.value.body &&
              property.value.body.type === 'CallExpression'
            ) {
              const actionName = extractActionName(property.value.body);
              if (actionName) actions.push(actionName);
            }
          });
        }
      });
    }
  
    return actions;
  }
  
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
          extractActionsFromMapDispatch(mapDispatchFn);
        }
      }
    },

    // Capture imports for resolving child component paths
    ImportDeclaration(path) {
      const importedModule = path.node.source.value;
      path.node.specifiers.forEach(specifier => {
        if (specifier.type === 'ImportDefaultSpecifier') {
          importMap[specifier.local.name] = importedModule;
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

  return {
    name: componentName,
    state,
    reduxProps,
    actions,
    children,
    childProps,
    importMap,
  };
}

module.exports = parseComponentForStateAndRedux;
