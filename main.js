const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const parseComponentForStateAndRedux = require('./parseReactComponents');
const generateGraph = require('./generateGraph');

function logTree(componentData, depth = 0) {
  const prefix = '  '.repeat(depth); // Indent based on depth
  console.log(`${prefix}- ${componentData.name}`);
  componentData.children.forEach(child => {
    console.log(`${prefix}  -> ${child}`);
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

function analyzeComponent(filePath, depth = 0, globalData = { components: [] }) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const componentData = parseComponentForStateAndRedux(fileContent, []);

  // Log the ASCII tree representation
  logTree(componentData, depth);

  // Add component data to the global structure
  globalData.components.push(componentData);

  // Recursively parse children
  const basePath = path.dirname(filePath);
  componentData.children.forEach(child => {
    const childPath = resolveImportPath(componentData.importMap, child, basePath);
    if (childPath) {
      analyzeComponent(childPath, depth + 1, globalData);
    } else {
      console.warn(`Child component file not found: ${child}`);
    }
  });

  return globalData; // Return the accumulated data
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

// Analyze the input component and generate the graph
const allComponents = analyzeComponent(componentFilePath);
console.log(JSON.stringify(allComponents, null, 2));
generateGraph(allComponents); // Generate the graph once
