import { codebaseService, type CodebaseRef } from '@/services/CodebaseService';
import type {
  PipelineInference,
  PipelinePackageManager,
  PipelineProjectKind,
} from '@/services/pipelineTypes';
import { asJsonObject, type JsonObject } from '@/lib/json';

type ProjectRef = CodebaseRef & {
  defaultBranch?: string | null;
};

const NODE_BUILD_IMAGE = 'node:22-bookworm';
const PYTHON_BUILD_IMAGE = 'python:3.12-bookworm';
const GO_BUILD_IMAGE = 'golang:1.24-bookworm';
const JAVA_BUILD_IMAGE = 'eclipse-temurin:21-jdk-jammy';

function buildScopedStaticAnalysisCommand(command: string, matchers: string[]): string {
  return [
    'set -eu',
    ': "${PIPELINE_CHANGED_FILES_MANIFEST:?PIPELINE_CHANGED_FILES_MANIFEST is required}"',
    ': "${PIPELINE_CHANGED_FILES_COUNT:?PIPELINE_CHANGED_FILES_COUNT is required}"',
    'if [ "${PIPELINE_CHANGED_FILES_COUNT}" -eq 0 ]; then',
    '  echo "[analysis] No changed files detected; skipping static analysis."',
    '  exit 0',
    'fi',
    'set --',
    'while IFS= read -r file || [ -n "$file" ]; do',
    '  [ -n "$file" ] || continue',
    '  case "$file" in',
    ...matchers.map((pattern) => `    ${pattern}) set -- "$@" "$file" ;;`),
    '  esac',
    'done < "$PIPELINE_CHANGED_FILES_MANIFEST"',
    'if [ "$#" -eq 0 ]; then',
    '  echo "[analysis] No changed source files detected; skipping static analysis."',
    '  exit 0',
    'fi',
    `${command} "$@"`,
  ].join('\n');
}

function buildScopedGoStaticAnalysisCommand(command: string): string {
  return [
    'set -eu',
    ': "${PIPELINE_CHANGED_FILES_MANIFEST:?PIPELINE_CHANGED_FILES_MANIFEST is required}"',
    ': "${PIPELINE_CHANGED_FILES_COUNT:?PIPELINE_CHANGED_FILES_COUNT is required}"',
    'if [ "${PIPELINE_CHANGED_FILES_COUNT}" -eq 0 ]; then',
    '  echo "[analysis] No changed files detected; skipping static analysis."',
    '  exit 0',
    'fi',
    'workspace_root="$(dirname "$(dirname "$PIPELINE_CHANGED_FILES_MANIFEST")")"',
    'cd "$workspace_root"',
    'go_packages="$(while IFS= read -r file || [ -n "$file" ]; do',
    '  [ -n "$file" ] || continue',
    '  case "$file" in',
    '    *.go)',
    '      rel="${file#/workspace/}"',
    '      dirname "$rel"',
    '      ;;',
    '  esac',
    'done < "$PIPELINE_CHANGED_FILES_MANIFEST" | sort -u)"',
    'if [ -z "$go_packages" ]; then',
    '  echo "[analysis] No changed Go files detected; skipping static analysis."',
    '  exit 0',
    'fi',
    'set -- $go_packages',
    `${command} "$@"`,
  ].join('\n');
}

export async function inferProjectPipelineDefaults(project: ProjectRef): Promise<PipelineInference> {
  const ref = normalizeRef(project.defaultBranch);
  const root = await codebaseService.listTree(
    {
      orgId: project.orgId,
      projectId: project.projectId,
      repo: project.repo,
      ...(ref ? { ref } : {}),
    },
    '',
    { syncPolicy: 'auto' }
  );

  const rootFileSet = new Set(
    root.entries.filter((entry) => entry.type === 'blob').map((entry) => entry.path.trim())
  );
  const packageJson = rootFileSet.has('package.json')
    ? await readJsonFile(project, 'package.json')
    : null;

  const hasFile = (name: string) => rootFileSet.has(name);
  const hasAnyFile = (...names: string[]) => names.some((name) => hasFile(name));

  const packageManager = detectPackageManager(packageJson, hasAnyFile);
  const projectKind = detectProjectKind(packageJson, hasAnyFile);
  const pyproject = hasFile('pyproject.toml') ? await readTextFile(project, 'pyproject.toml') : null;
  const hasEslintConfig = hasEslintConfigFiles(hasFile);
  const hasRuffConfig = hasFile('ruff.toml') || hasFile('.ruff.toml') || hasRuffConfigured(pyproject);
  const ruffConfig = hasRuffConfig
    ? {
        command: buildScopedStaticAnalysisCommand('python -m ruff check --output-format sarif --output-file quality-gate.sarif', ['*.py']),
        artifactPaths: ['quality-gate.sarif'],
      }
    : null;

  if (hasFile('go.mod')) {
    return {
      ...buildGoDefaults(),
      projectKind: 'go',
      runtime: 'go',
      packageManager: 'unknown',
      confidence: 'high',
      signals: ['go.mod'],
    };
  }

  if (hasFile('pyproject.toml') || hasFile('requirements.txt') || hasFile('setup.py')) {
    return buildPythonDefaults({
      hasPyproject: hasFile('pyproject.toml'),
      hasRequirements: hasFile('requirements.txt'),
      staticAnalysisCommand: ruffConfig?.command ?? buildScopedStaticAnalysisCommand('python -m compileall', ['*.py']),
      ...(ruffConfig?.artifactPaths ? { staticAnalysisArtifactPaths: ruffConfig.artifactPaths } : {}),
    });
  }

  if (hasFile('pom.xml') || hasFile('build.gradle') || hasFile('build.gradle.kts') || hasFile('mvnw') || hasFile('gradlew')) {
    return buildJavaDefaults({
      hasMaven: hasFile('pom.xml') || hasFile('mvnw'),
      hasGradle: hasFile('build.gradle') || hasFile('build.gradle.kts') || hasFile('gradlew'),
      hasGradleWrapper: hasFile('gradlew'),
    });
  }

  return buildNodeDefaults({
    packageJson,
    packageManager,
    projectKind,
    hasNextConfig: hasAnyFile('next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'),
    hasViteConfig: hasAnyFile('vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.cjs'),
    hasReactScripts: hasPackageDependency(packageJson, 'react-scripts'),
    hasEslintConfig,
    hasLockFiles: hasAnyFile('package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'),
  });
}

function buildNodeDefaults(input: {
  packageJson: JsonObject | null;
  packageManager: PipelinePackageManager;
  projectKind: PipelineProjectKind;
  hasNextConfig: boolean;
  hasViteConfig: boolean;
  hasReactScripts: boolean;
  hasEslintConfig: boolean;
  hasLockFiles: boolean;
}): PipelineInference {
  const runtime = 'node' as const;
  const buildImage = NODE_BUILD_IMAGE;
  const installCommand = resolveNodeInstallCommand(input.packageManager, input.hasLockFiles);
  const buildCommand = resolveNodeBuildCommand(input.packageJson, input.packageManager, input.projectKind, {
    hasNextConfig: input.hasNextConfig,
    hasViteConfig: input.hasViteConfig,
    hasReactScripts: input.hasReactScripts,
  });
  const staticAnalysisCommand = resolveNodeStaticAnalysisCommand(input.packageJson, input.packageManager, input.projectKind, {
    hasNextConfig: input.hasNextConfig,
    hasViteConfig: input.hasViteConfig,
    hasReactScripts: input.hasReactScripts,
    hasEslintConfig: input.hasEslintConfig,
  });
  const staticAnalysisArtifactPaths = resolveNodeStaticAnalysisArtifactPaths(input.packageJson, input.projectKind, {
    hasNextConfig: input.hasNextConfig,
    hasViteConfig: input.hasViteConfig,
    hasReactScripts: input.hasReactScripts,
    hasEslintConfig: input.hasEslintConfig,
  });
  const signals = collectSignals([
    input.projectKind !== 'node' ? input.projectKind : null,
    input.packageManager !== 'unknown' ? `packageManager:${input.packageManager}` : null,
  ]);

  return {
    buildImage,
    buildSteps: [
      { name: 'Install dependencies', script: installCommand },
      { name: 'Build', script: buildCommand },
    ],
    staticAnalysisCommand,
    ...(staticAnalysisArtifactPaths ? { staticAnalysisArtifactPaths } : {}),
    projectKind: input.projectKind,
    runtime,
    packageManager: input.packageManager,
    confidence: input.projectKind === 'unknown' ? 'low' : 'high',
    signals,
  };
}

function buildPythonDefaults(input: {
  hasPyproject: boolean;
  hasRequirements: boolean;
  staticAnalysisCommand: string;
  staticAnalysisArtifactPaths?: string[];
}): PipelineInference {
  const installCommand = input.hasRequirements
    ? 'python -m pip install -r requirements.txt'
    : 'python -m pip install -U pip build';
  const buildCommand = input.hasPyproject ? 'python -m build' : 'python -m pytest';
  return {
    buildImage: PYTHON_BUILD_IMAGE,
    buildSteps: [
      { name: 'Install dependencies', script: installCommand },
      { name: 'Build', script: buildCommand },
    ],
    staticAnalysisCommand: input.staticAnalysisCommand,
    ...(input.staticAnalysisArtifactPaths ? { staticAnalysisArtifactPaths: input.staticAnalysisArtifactPaths } : {}),
    projectKind: 'python',
    runtime: 'python',
    packageManager: 'unknown',
    confidence: 'high',
    signals: collectSignals([input.hasPyproject ? 'pyproject.toml' : null, input.hasRequirements ? 'requirements.txt' : null]),
  };
}

function buildGoDefaults(): PipelineInference {
  return {
    buildImage: GO_BUILD_IMAGE,
    buildSteps: [
      { name: 'Download modules', script: 'go mod download' },
      { name: 'Build', script: 'go build ./...' },
    ],
    staticAnalysisCommand: buildScopedGoStaticAnalysisCommand('go vet'),
    projectKind: 'go',
    runtime: 'go',
    packageManager: 'unknown',
    confidence: 'high',
    signals: ['go.mod'],
  };
}

function buildJavaDefaults(input: { hasMaven: boolean; hasGradle: boolean; hasGradleWrapper: boolean }): PipelineInference {
  if (input.hasGradle) {
    return {
      buildImage: JAVA_BUILD_IMAGE,
      buildSteps: input.hasGradleWrapper
        ? [
            { name: 'Download dependencies', script: './gradlew --no-daemon dependencies' },
            { name: 'Build', script: './gradlew --no-daemon build' },
          ]
        : [
            { name: 'Download dependencies', script: 'gradle dependencies' },
            { name: 'Build', script: 'gradle build' },
      ],
      staticAnalysisCommand: input.hasGradleWrapper ? './gradlew --no-daemon check' : 'gradle check',
      projectKind: 'java',
      runtime: 'java',
      packageManager: 'unknown',
      confidence: 'high',
      signals: collectSignals([
        input.hasGradleWrapper ? 'gradle-wrapper' : null,
        input.hasGradle ? 'gradle' : null,
      ]),
    };
  }

  return {
    buildImage: JAVA_BUILD_IMAGE,
    buildSteps: input.hasMaven
      ? [
          { name: 'Download dependencies', script: './mvnw -q -DskipTests dependency:go-offline' },
          { name: 'Build', script: './mvnw -q -DskipTests package' },
        ]
      : [
          { name: 'Download dependencies', script: 'mvn -q -DskipTests dependency:go-offline' },
          { name: 'Build', script: 'mvn -q -DskipTests package' },
    ],
    staticAnalysisCommand: input.hasMaven ? './mvnw -q -DskipTests verify' : 'mvn -q -DskipTests verify',
    projectKind: 'java',
    runtime: 'java',
    packageManager: 'unknown',
    confidence: 'high',
    signals: collectSignals([input.hasMaven ? 'maven' : null]),
  };
}

function resolveNodeInstallCommand(packageManager: PipelinePackageManager, hasLockFiles: boolean): string {
  switch (packageManager) {
    case 'pnpm':
      return 'corepack pnpm install --frozen-lockfile';
    case 'yarn':
      return 'corepack yarn install --frozen-lockfile';
    case 'bun':
      return 'bun install --frozen-lockfile';
    case 'npm':
      return hasLockFiles ? 'npm ci' : 'npm install';
    default:
      if (hasLockFiles) {
        return 'npm ci';
      }
      return 'npm install';
  }
}

function resolveNodeBuildCommand(
  packageJson: JsonObject | null,
  packageManager: PipelinePackageManager,
  projectKind: PipelineProjectKind,
  input: { hasNextConfig: boolean; hasViteConfig: boolean; hasReactScripts: boolean }
): string {
  if (hasBuildScript(packageJson)) {
    return packageManagerCommand(packageManager, 'run build');
  }
  if (projectKind === 'nextjs' || input.hasNextConfig) {
    return 'next build';
  }
  if (projectKind === 'vite' || input.hasViteConfig) {
    return 'vite build';
  }
  if (projectKind === 'react' || input.hasReactScripts) {
    return 'react-scripts build';
  }
  return packageManagerCommand(packageManager, 'run build');
}

function resolveNodeStaticAnalysisCommand(
  packageJson: JsonObject | null,
  packageManager: PipelinePackageManager,
  projectKind: PipelineProjectKind,
  input: { hasNextConfig: boolean; hasViteConfig: boolean; hasReactScripts: boolean; hasEslintConfig: boolean }
): string {
  if (projectKind === 'nextjs' || input.hasNextConfig || projectKind === 'vite' || input.hasViteConfig || input.hasReactScripts || input.hasEslintConfig) {
    return buildScopedStaticAnalysisCommand(
      packageManagerCommand(packageManager, 'exec eslint -f sarif -o quality-gate.sarif'),
      ['*.js', '*.jsx', '*.mjs', '*.cjs', '*.ts', '*.tsx']
    );
  }
  if (hasLintScript(packageJson)) {
    return packageManagerCommand(packageManager, 'run lint');
  }
  return packageManagerCommand(packageManager, 'run lint');
}

function resolveNodeStaticAnalysisArtifactPaths(
  packageJson: JsonObject | null,
  projectKind: PipelineProjectKind,
  input: { hasNextConfig: boolean; hasViteConfig: boolean; hasReactScripts: boolean; hasEslintConfig: boolean }
): string[] | undefined {
  if (projectKind === 'nextjs' || input.hasNextConfig || projectKind === 'vite' || input.hasViteConfig || input.hasReactScripts || input.hasEslintConfig) {
    return ['quality-gate.sarif'];
  }
  if (hasLintScript(packageJson)) {
    return undefined;
  }
  return undefined;
}

function detectPackageManager(
  packageJson: JsonObject | null,
  hasFile: (name: string) => boolean
): PipelinePackageManager {
  const declaredValue = packageJson ? packageJson['packageManager'] : undefined;
  const declared = typeof declaredValue === 'string' ? declaredValue.trim() : '';
  if (declared.startsWith('pnpm@')) return 'pnpm';
  if (declared.startsWith('yarn@')) return 'yarn';
  if (declared.startsWith('bun@')) return 'bun';
  if (declared.startsWith('npm@')) return 'npm';
  if (hasFile('pnpm-lock.yaml')) return 'pnpm';
  if (hasFile('yarn.lock')) return 'yarn';
  if (hasFile('bun.lock') || hasFile('bun.lockb')) return 'bun';
  if (hasFile('package-lock.json')) return 'npm';
  if (packageJson) return 'npm';
  return 'unknown';
}

function detectProjectKind(
  packageJson: JsonObject | null,
  hasFile: (name: string) => boolean
): PipelineProjectKind {
  if (hasFile('next.config.js') || hasFile('next.config.mjs') || hasFile('next.config.ts') || hasFile('next.config.cjs')) {
    return 'nextjs';
  }
  if (hasPackageDependency(packageJson, 'next')) {
    return 'nextjs';
  }
  if (hasFile('vite.config.js') || hasFile('vite.config.mjs') || hasFile('vite.config.ts') || hasFile('vite.config.cjs')) {
    return 'vite';
  }
  if (hasPackageDependency(packageJson, 'vite')) {
    return 'vite';
  }
  if (hasPackageDependency(packageJson, 'react-scripts')) {
    return 'react';
  }
  if (packageJson) {
    return 'node';
  }
  return 'unknown';
}

function hasPackageDependency(packageJson: JsonObject | null, dependency: string): boolean {
  if (!packageJson) return false;
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
  for (const section of sections) {
    const value = packageJson[section];
    const dependencies = asJsonObject(value);
    if (!dependencies) continue;
    if (dependency in dependencies) {
      return true;
    }
  }
  return false;
}

function hasBuildScript(packageJson: JsonObject | null): boolean {
  const scripts = packageJson ? packageJson['scripts'] : undefined;
  const scriptsObject = asJsonObject(scripts);
  return typeof scriptsObject?.build === 'string' && Boolean(scriptsObject.build);
}

function hasLintScript(packageJson: JsonObject | null): boolean {
  const scripts = packageJson ? packageJson['scripts'] : undefined;
  const scriptsObject = asJsonObject(scripts);
  return typeof scriptsObject?.lint === 'string' && Boolean(scriptsObject.lint);
}

function hasEslintConfigFiles(hasFile: (name: string) => boolean): boolean {
  return [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.mjs',
    '.eslintrc.json',
  ].some((name) => hasFile(name));
}

function hasRuffConfigured(pyproject: string | null): boolean {
  if (!pyproject) return false;
  return /\[tool\.ruff\]/i.test(pyproject) || /\bruff\b/i.test(pyproject);
}

function packageManagerCommand(packageManager: PipelinePackageManager, suffix: string): string {
  switch (packageManager) {
    case 'pnpm':
      return `corepack pnpm ${suffix}`;
    case 'yarn':
      return `corepack yarn ${suffix.replace(/^run\s+/, '')}`;
    case 'bun':
      return `bun ${suffix}`;
    case 'npm':
      if (suffix.startsWith('exec ')) {
        return `npm exec -- ${suffix.slice(5)}`;
      }
      return `npm ${suffix}`;
    default:
      if (suffix.startsWith('exec ')) {
        return `npm exec -- ${suffix.slice(5)}`;
      }
      return `npm ${suffix}`;
  }
}

function collectSignals(items: Array<string | null | undefined>): string[] {
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function normalizeRef(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function readJsonFile(project: ProjectRef, filePath: string): Promise<JsonObject | null> {
  try {
    const result = await codebaseService.readFile(
      {
        orgId: project.orgId,
        projectId: project.projectId,
        repo: project.repo,
        ...(project.defaultBranch?.trim() ? { ref: project.defaultBranch.trim() } : {}),
      },
      filePath,
      { syncPolicy: 'auto' }
    );
    if (result.isBinary || !result.content.trim()) {
      return null;
    }
    return asJsonObject(JSON.parse(result.content));
  } catch {
    return null;
  }
}

async function readTextFile(project: ProjectRef, filePath: string): Promise<string | null> {
  try {
    const result = await codebaseService.readFile(
      {
        orgId: project.orgId,
        projectId: project.projectId,
        repo: project.repo,
        ...(project.defaultBranch?.trim() ? { ref: project.defaultBranch.trim() } : {}),
      },
      filePath,
      { syncPolicy: 'auto' }
    );
    if (result.isBinary || result.truncated || !result.content.trim()) {
      return null;
    }
    return result.content;
  } catch {
    return null;
  }
}
