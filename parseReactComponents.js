const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function parseComponentForStateAndRedux(fileContent, componentHierarchy) {
  const ast = parser.parse(fileContent, {
    sourceType: 'module',
    plugins: ['jsx']
  });

  let state = null;
  let reduxProps = [];
  let actions = [];
  let componentName = '';
  let children = [];
  let props = {};
  const importMap = {}; // Track import paths

  traverse(ast, {
    ClassDeclaration(path) {
      componentName = path.node.id.name;
    },
    ClassProperty(path) {
      if (path.node.key.name === 'state' && !path.node.static) {
        if (path.node.value.type === 'ObjectExpression') {
          state = path.node.value.properties.map(prop => prop.key.name);
        } else {
          state = ['Dynamic State'];
        }
      }
    },
    FunctionDeclaration(path) {
      if (path.node.returnType && path.node.returnType.typeAnnotation.type === 'ObjectTypeAnnotation') {
        path.node.returnType.typeAnnotation.properties.forEach(prop => {
          if (prop.key.name === 'type') {
            actions.push(path.node.id.name);
          }
        });
      }
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type === 'Identifier' && callee.name === 'connect') {
        // Redux `connect` handling
        const mapStateToProps = path.node.arguments[0];
        if (mapStateToProps?.type === 'FunctionExpression') {
          mapStateToProps.body.body.forEach(statement => {
            if (statement.type === 'ReturnStatement' && statement.argument.type === 'ObjectExpression') {
              reduxProps = statement.argument.properties.map(prop => prop.key.name);
            }
          });
        }
      }
    },
    ImportDeclaration(path) {
      const importedModule = path.node.source.value; // Module path
      path.node.specifiers.forEach(specifier => {
        if (specifier.type === 'ImportDefaultSpecifier') {
          importMap[specifier.local.name] = importedModule;
        }
      });
    },

    JSXElement(path) {
      const childName = path.node.openingElement.name.name;
    
      // Exclude standard HTML tags
      if (/^[a-z]/.test(childName)) return;
    
      children.push(childName);
    
      // Safely map attributes to props
      const attributes = path.node.openingElement.attributes || [];
      props[childName] = attributes.map(attr => {
        if (attr.name && attr.name.name) {
          return attr.name.name; // Normal attribute
        } else if (attr.type === 'JSXSpreadAttribute') {
          return '...spread'; // Handle spread operators
        } else {
          return 'unknown'; // Fallback for unexpected cases
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
    props,
    importMap,
  };
}

module.exports = parseComponentForStateAndRedux;
