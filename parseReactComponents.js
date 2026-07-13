const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

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
    const childrenSet = new Set(); // Use Set to prevent duplicates
    let props = {};
    const importMap = {}; // Track import paths
    let hookState = []; // Track useState/useReducer

    traverse(ast, {
      // Handle class components
      ClassDeclaration(path) {
        if (!componentName) {
          componentName = path.node.id.name;
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
      FunctionDeclaration(path) {
        if (!componentName && path.node.id) {
          componentName = path.node.id.name;
        }
      },
      VariableDeclarator(path) {
        if (!componentName && path.node.init?.type === 'ArrowFunctionExpression') {
          if (path.node.id?.name) {
            componentName = path.node.id.name;
          }
        }
      },

      // Handle useState and useReducer hooks for state detection
      CallExpression(path) {
        const callee = path.node.callee;

        if (callee.type === 'Identifier') {
          // Redux connect handling
          if (callee.name === 'connect') {
            const mapStateToProps = path.node.arguments[0];
            if (mapStateToProps?.type === 'FunctionExpression' || mapStateToProps?.type === 'ArrowFunctionExpression') {
              const body = mapStateToProps.body.body || [mapStateToProps.body];
              body.forEach(statement => {
                if (statement.type === 'ReturnStatement' && statement.argument?.type === 'ObjectExpression') {
                  reduxProps = statement.argument.properties
                    .filter(prop => prop.key?.name)
                    .map(prop => prop.key.name);
                }
              });
            }
          }
          // React hooks for state
          else if (['useState', 'useReducer'].includes(callee.name)) {
            if (!hookState) hookState = [];
            hookState.push(`Hook: ${callee.name}`);
          }
          // Redux hooks
          else if (['useSelector', 'useDispatch'].includes(callee.name)) {
            if (!reduxProps) reduxProps = [];
            reduxProps.push(`Hook: ${callee.name}`);
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
          childName = path.node.openingElement.name.property?.name;
        }

        // Exclude standard HTML tags (lowercase)
        if (!childName || /^[a-z]/.test(childName)) return;

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
    }

    return {
      name: componentName || 'Unknown',
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
