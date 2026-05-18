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

const analyzeComponent = (filePath, depth = 0, visited = new Set(), context = '', rootPath = null, followAllImports = true) => {
  // Track root path to compute relative paths for clustering
  if (rootPath === null) {
    rootPath = path.dirname(filePath);
  }

  const uniqueKey = `${filePath}::${context}`;
  if (visited.has(uniqueKey)) {
    return {
      name: path.basename(filePath, path.extname(filePath)),
      error: 'Already parsed',
      sourcePath: path.relative(rootPath, filePath) || '.'
    };
  }
  visited.add(uniqueKey);

  let fileContent;
  try {
    fileContent = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return {
      name: path.basename(filePath, path.extname(filePath)),
      error: 'Could not read file',
      sourcePath: path.relative(rootPath, filePath) || '.'
    };
  }

  let componentData;
  try {
    componentData = parseComponentForStateAndRedux(fileContent, []);
  } catch (err) {
    console.error(`  Parse error in ${filePath}: ${err.message}`);
    return {
      name: path.basename(filePath, path.extname(filePath)),
      error: 'Parse error',
      sourcePath: path.relative(rootPath, filePath) || '.'
    };
  }
  logTree(componentData, depth);

  // Add source path relative to root for clustering
  componentData.sourcePath = path.relative(rootPath, filePath) || '.';

  const basePath = path.dirname(filePath);

  // Determine which imports to follow
  let importsToFollow;
  if (followAllImports) {
    // Follow ALL imports from importMap (expanded mode)
    importsToFollow = Object.keys(componentData.importMap);
  } else {
    // Only follow JSX children (components-only mode)
    importsToFollow = componentData.children;
  }

  // Recursively resolve imports
  const resolvedImports = importsToFollow.map(importName => {
    const importPath = resolveImportPath(componentData.importMap, importName, basePath);
    if (importPath) {
      const resolvedImport = analyzeComponent(importPath, depth + 1, visited, `${context}-${importName}`, rootPath, followAllImports);
      // Attach props if this is a JSX child
      resolvedImport.propsFromParent = componentData.childProps[importName] || null;
      // Mark if this is a JSX usage or just an import
      resolvedImport.isJsxChild = componentData.children.includes(importName);
      return resolvedImport;
    }
    // For unresolved imports, use import path as hint for clustering
    const modulePath = componentData.importMap[importName];
    // Skip external packages (don't start with . or /)
    if (modulePath && !modulePath.startsWith('.') && !modulePath.startsWith('/')) {
      return {
        name: importName,
        error: 'External package',
        propsFromParent: componentData.childProps[importName] || null,
        isJsxChild: componentData.children.includes(importName),
        sourcePath: modulePath
      };
    }
    return {
      name: importName,
      error: 'File not found',
      propsFromParent: componentData.childProps[importName] || null,
      isJsxChild: componentData.children.includes(importName),
      sourcePath: modulePath ? modulePath.replace(/^\.\//, '') : null
    };
  });

  componentData.children = resolvedImports;

  return componentData;
}

// Parse CLI arguments
const args = process.argv.slice(2);
const componentsOnlyIndex = args.indexOf('--components-only');
const componentsOnly = componentsOnlyIndex !== -1;
if (componentsOnlyIndex !== -1) {
  args.splice(componentsOnlyIndex, 1);
}
const inputComponentPath = args[0];

if (!inputComponentPath) {
  console.error('Error: No component file path provided.');
  console.error('Usage: node main.js <component-file-path> [--components-only]');
  console.error('  --components-only  Only follow JSX component imports (default: follow all imports)');
  process.exit(1);
}

// Resolve the full path of the input component
const componentFilePath = path.resolve(inputComponentPath);

if (!fs.existsSync(componentFilePath)) {
  console.error(`Error: Component file not found at ${componentFilePath}`);
  process.exit(1);
}

// Analyze the input component
// followAllImports = !componentsOnly (when --components-only is passed, only follow JSX children)
const nestedStructure = analyzeComponent(componentFilePath, 0, new Set(), '', null, !componentsOnly);
console.log(`\nMode: ${componentsOnly ? 'Components only (JSX children)' : 'Expanded (all imports)'}`);
console.log(JSON.stringify(nestedStructure, null, 2));

// Generate graph with filename based on component name
const outputName = nestedStructure.name || path.basename(componentFilePath, path.extname(componentFilePath));
generateGraph(nestedStructure, outputName);
