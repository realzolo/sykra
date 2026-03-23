import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = [
  path.resolve(process.cwd(), 'src'),
  path.resolve(process.cwd(), '../conductor/internal'),
];

const allowedExtensions = new Set(['.ts', '.tsx', '.go']);
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

const rules = [
  {
    name: 'select-star',
    regex: /\bselect\s+\*/i,
    message: 'Avoid `select *`; use explicit columns.',
  },
  {
    name: 'returning-star',
    regex: /\breturning\s+\*/i,
    message: 'Avoid `returning *`; use explicit columns.',
  },
  {
    name: 'alias-star-select',
    regex: /\bselect\s+[a-z][a-z0-9_]*\.\*/i,
    message: 'Avoid alias wildcard in select (for example `i.*`); use explicit columns.',
  },
  {
    name: 'alias-star-agg',
    regex: /\b(?:jsonb_agg|array_agg)\(\s*[a-z][a-z0-9_]*\.\*/i,
    message: 'Avoid alias wildcard in aggregate projection (for example `jsonb_agg(c.*)`).',
  },
];

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

async function collectViolations(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of rules) {
      if (!rule.regex.test(line)) {
        continue;
      }
      violations.push({
        file: normalizePath(filePath),
        line: index + 1,
        rule: rule.name,
        message: rule.message,
        snippet: line.trim(),
      });
    }
  }

  return violations;
}

async function main() {
  const allFiles = [];
  for (const root of roots) {
    allFiles.push(...await walk(root));
  }

  const violations = [];
  for (const filePath of allFiles) {
    violations.push(...await collectViolations(filePath));
  }

  if (violations.length === 0) {
    return;
  }

  console.error(`SQL projection guard failed with ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`
    );
    console.error(`  ${violation.snippet}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error('SQL projection guard execution failed.');
  console.error(error);
  process.exit(1);
});
