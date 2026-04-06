import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src');

const rules = [
  {
    file: 'app/api/pipelines/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineListTelemetry',
    ],
    requiredImportPrefixes: ['@/features/pipelines/application/'],
  },
  {
    file: 'app/api/pipelines/[id]/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineListTelemetry',
    ],
    requiredImportPrefixes: ['@/features/pipelines/application/'],
  },
  {
    file: 'app/api/pipelines/[id]/runs/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineListTelemetry',
    ],
    requiredImportPrefixes: ['@/features/pipelines/application/'],
  },
  {
    file: 'app/api/pipelines/[id]/policy-rejections/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineListTelemetry',
    ],
    requiredImportPrefixes: ['@/features/pipelines/application/'],
  },
];

let hasError = false;

for (const rule of rules) {
  const absPath = resolve(ROOT, rule.file);
  const content = readFileSync(absPath, 'utf8');
  const imports = Array.from(content.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);

  for (const forbidden of rule.forbiddenImports) {
    if (imports.includes(forbidden)) {
      console.error(`[route-layering] ${rule.file} must not import ${forbidden}`);
      hasError = true;
    }
  }

  for (const requiredPrefix of rule.requiredImportPrefixes) {
    if (!imports.some((item) => item.startsWith(requiredPrefix))) {
      console.error(
        `[route-layering] ${rule.file} must import at least one module from ${requiredPrefix}`
      );
      hasError = true;
    }
  }
}

if (hasError) {
  process.exit(1);
}
