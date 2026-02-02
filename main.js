const fs = require('fs');
const path = require('path');
const parseComponentForStateAndRedux = require('./parseReactComponents');
const generateGraph = require('./generateGraph');

function logTree(componentData, depth = 0) {
  const prefix = '  '.repeat(depth); // Indent based on depth
  console.log(`${prefix}- ${componentData.name || 'Unnamed Component'}`);
  componentData.children.forEach(child => {
    // child is a string (component name) at this point, before recursive resolution
    const childName = typeof child === 'string' ? child : (child.name || 'Unnamed Component');
    console.log(`${prefix}  -> ${childName}`);
  });
}

const resolveImportPath = (importMap, childName, basePath) => {
  if (!importMap[childName]) return null;

  const relativePath = importMap[childName];
  let resolvedPath = path.resolve(basePath, relativePath);

  // Append .jsx or .js if necessary
  if (!fs.existsSync(resolvedPath)) {
    if (fs.existsSync(`${resolvedPath}.jsx`)) resolvedPath = `${resolvedPath}.jsx`;
    else if (fs.existsSync(`${resolvedPath}.js`)) resolvedPath = `${resolvedPath}.js`;
    else return null;
  }

  return resolvedPath;
};

const analyzeComponent = (filePath, depth = 0, visited = new Set(), context = '') => {
  const uniqueKey = `${filePath}::${context}`;
  if (visited.has(uniqueKey)) {
    return { name: path.basename(filePath, path.extname(filePath)), error: 'Already parsed' };
  }
  visited.add(uniqueKey);

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const componentData = parseComponentForStateAndRedux(fileContent, []);
  logTree(componentData, depth);

  // Recursively resolve children
  const basePath = path.dirname(filePath);
  componentData.children = componentData.children.map(childName => {
    const childPath = resolveImportPath(componentData.importMap, childName, basePath);
    if (childPath) {
      const resolvedChild = analyzeComponent(childPath, depth + 1, visited, `${context}-${childName}`);
      // Attach the props this parent passes to this child
      resolvedChild.propsFromParent = componentData.childProps[childName] || null;
      return resolvedChild;
    }
    return {
      name: childName,
      error: 'File not found',
      propsFromParent: componentData.childProps[childName] || null
    };
  });

  return componentData;
}

// Get the input component path from CLI arguments
const inputComponentPath = process.argv[2];

if (!inputComponentPath) {
  console.error('Error: No component file path provided. Usage: node main.js <component-file-path>');
  process.exit(1);
}

// Resolve the full path of the input component
const componentFilePath = path.resolve(inputComponentPath);

if (!fs.existsSync(componentFilePath)) {
  console.error(`Error: Component file not found at ${componentFilePath}`);
  process.exit(1);
}

// Analyze the input component
const nestedStructure = analyzeComponent(componentFilePath);
console.log(JSON.stringify(nestedStructure, null, 2));

// Generate graph with filename based on component name
const outputName = nestedStructure.name || path.basename(componentFilePath, path.extname(componentFilePath));
generateGraph(nestedStructure, outputName);
