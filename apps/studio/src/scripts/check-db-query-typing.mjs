import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = [
  path.resolve(process.cwd(), 'src/app/api'),
  path.resolve(process.cwd(), 'src/services'),
];

const ignoredNames = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'build',
  'vendor',
  'tmp',
  'temp',
  '.cache',
]);

const allowedExtensions = new Set(['.ts', '.tsx']);
const untypedQueryPattern = /(?<![\w.])(query|queryOne)\s*\(/g;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }
    if (!allowedExtensions.has(path.extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function normalizePath(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

async function collectViolations(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];
  const matches = content.matchAll(untypedQueryPattern);

  for (const match of matches) {
    const index = match.index;
    if (index == null) continue;
    const lineNo = lineNumberAt(content, index);
    const line = lines[lineNo - 1] ?? '';
    violations.push({
      file: normalizePath(filePath),
      line: lineNo,
      snippet: line.trim(),
      symbol: match[1],
    });
  }

  return violations;
}

async function main() {
  const files = [];
  for (const root of roots) {
    files.push(...await walk(root));
  }

  const violations = [];
  for (const filePath of files) {
    violations.push(...await collectViolations(filePath));
  }

  if (violations.length === 0) {
    return;
  }

  console.error(`DB query typing guard failed with ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} [${violation.symbol}] Use explicit row generic typing.`);
    console.error(`  ${violation.snippet}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error('DB query typing guard execution failed.');
  console.error(error);
  process.exit(1);
});
