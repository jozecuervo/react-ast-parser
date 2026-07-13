#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const parseComponentForStateAndRedux = require('./parseReactComponents');
const generateGraph = require('./generateGraph');

function logTree(componentData, depth = 0) {
  const prefix = '  '.repeat(depth);
  console.log(`${prefix}- ${componentData.name}`);
  if (componentData.children && componentData.children.length > 0) {
    componentData.children.forEach(child => {
      console.log(`${prefix}  -> ${child}`);
    });
  }
}

/**
 * Resolve an import path to an actual file path
 * Handles: .js, .jsx, .tsx, .ts files and index files in directories
 */
const resolveImportPath = (importMap, childName, basePath, debug = false) => {
  if (!importMap[childName]) {
    if (debug) console.debug(`  [DEBUG] Child '${childName}' not found in importMap`);
    return null;
  }

  const relativePath = importMap[childName];

  // Handle absolute or relative paths
  let resolvedPath;
  if (path.isAbsolute(relativePath)) {
    resolvedPath = relativePath;
  } else {
    resolvedPath = path.resolve(basePath, relativePath);
  }

  if (debug) console.debug(`  [DEBUG] Resolved '${childName}' -> ${resolvedPath}`);

  // Check if it's a direct file
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    return resolvedPath;
  }

  // Try adding extensions
  const extensions = ['.jsx', '.js', '.tsx', '.ts'];
  for (const ext of extensions) {
    const pathWithExt = `${resolvedPath}${ext}`;
    if (fs.existsSync(pathWithExt)) {
      if (debug) console.debug(`  [DEBUG] Found with extension: ${pathWithExt}`);
      return pathWithExt;
    }
  }

  // Try index files in directory
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
    for (const ext of extensions) {
      const indexPath = path.join(resolvedPath, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        if (debug) console.debug(`  [DEBUG] Found index file: ${indexPath}`);
        return indexPath;
      }
    }
  }

  if (debug) console.debug(`  [DEBUG] No file found for '${childName}'`);
  return null;
};

function analyzeComponent(
  filePath,
  depth = 0,
  globalData = { components: [] },
  visitedFiles = new Set(),
  debug = false
) {
  // Prevent circular imports
  const absolutePath = path.resolve(filePath);
  if (visitedFiles.has(absolutePath)) {
    if (debug) console.debug(`  [DEBUG] Circular import detected: ${absolutePath}`);
    console.warn(`⚠️  Circular import detected: ${path.basename(absolutePath)}`);
    return globalData;
  }
  visitedFiles.add(absolutePath);

  try {
    // Validate file exists and is readable
    if (!fs.existsSync(absolutePath)) {
      console.error(`✗ File not found: ${absolutePath}`);
      return globalData;
    }

    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) {
      console.error(`✗ Not a file: ${absolutePath}`);
      return globalData;
    }

    const fileContent = fs.readFileSync(absolutePath, 'utf-8');
    const componentData = parseComponentForStateAndRedux(fileContent, [], absolutePath);

    // Handle parsing errors gracefully
    if (componentData.error) {
      console.warn(`⚠️  Parse error in ${path.basename(absolutePath)}: ${componentData.error}`);
      globalData.components.push(componentData);
      return globalData;
    }

    // Log the ASCII tree representation
    logTree(componentData, depth);

    // Add component data to the global structure
    globalData.components.push(componentData);

    // Recursively parse children
    const basePath = path.dirname(absolutePath);
    if (componentData.children && Array.isArray(componentData.children)) {
      componentData.children.forEach(child => {
        if (debug) console.debug(`Processing child: ${child}`);
        const childPath = resolveImportPath(componentData.importMap, child, basePath, debug);
        if (childPath) {
          analyzeComponent(childPath, depth + 1, globalData, visitedFiles, debug);
        } else {
          const suggestions = Object.entries(componentData.importMap)
            .map(([name, imp]) => `${name} -> ${imp}`)
            .join('\n    ');
          console.warn(
            `⚠️  Could not resolve component '${child}' from ${path.basename(absolutePath)}`
          );
          if (debug && suggestions) {
            console.debug(`    Available imports:\n    ${suggestions}`);
          }
        }
      });
    }
  } catch (error) {
    console.error(`✗ Error analyzing ${path.basename(filePath)}: ${error.message}`);
    if (debug) console.error(error.stack);
  }

  return globalData;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    filePath: null,
    debug: false,
    quiet: false,
    outputFormat: 'both', // 'both', 'json', 'graph'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--debug') {
      config.debug = true;
    } else if (args[i] === '--quiet') {
      config.quiet = true;
    } else if (args[i] === '--json-only') {
      config.outputFormat = 'json';
    } else if (args[i] === '--graph-only') {
      config.outputFormat = 'graph';
    } else if (!args[i].startsWith('--')) {
      config.filePath = args[i];
    }
  }

  return config;
}

function printUsage() {
  console.log(`
Usage: node main.js <component-file-path> [options]

Options:
  --debug          Show detailed parsing information
  --quiet          Suppress console output during analysis
  --json-only      Output only JSON, skip graph generation
  --graph-only     Generate only the graph, skip JSON output

Examples:
  node main.js ./src/components/App.jsx
  node main.js ./src/components/App.jsx --debug
  node main.js ./src/components/App.jsx --graph-only
`);
}

// Parse command line arguments
const config = parseArgs();

if (!config.filePath) {
  console.error('Error: No component file path provided.');
  printUsage();
  process.exit(1);
}

// Resolve the full path of the input component
const componentFilePath = path.resolve(config.filePath);

if (!fs.existsSync(componentFilePath)) {
  console.error(`Error: Component file not found at ${componentFilePath}`);
  process.exit(1);
}

// Analyze the input component and generate the graph
if (!config.quiet && config.outputFormat !== 'graph') {
  console.log('Analyzing component structure...\n');
}

const allComponents = analyzeComponent(componentFilePath, 0, { components: [] }, new Set(), config.debug);

if (!config.quiet && config.outputFormat !== 'graph') {
  console.log('\n' + '='.repeat(50));
}

// Output JSON if requested
if (config.outputFormat === 'json' || config.outputFormat === 'both') {
  if (!config.quiet) {
    console.log('\nComponent Data (JSON):');
  }
  console.log(JSON.stringify(allComponents, null, 2));
}

// Generate graph if requested
if (config.outputFormat === 'graph' || config.outputFormat === 'both') {
  if (!config.quiet) {
    console.log('\nGenerating graph...');
  }
  generateGraph(allComponents, config.quiet);
}
