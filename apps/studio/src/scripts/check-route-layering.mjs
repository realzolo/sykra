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
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipelines/[id]/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineListTelemetry',
    ],
    requiredImportPrefixes: ['@/features/pipelines/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipelines/[id]/runs/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineListTelemetry',
    ],
    requiredImportPrefixes: ['@/features/pipelines/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipelines/[id]/policy-rejections/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineListTelemetry',
    ],
    requiredImportPrefixes: ['@/features/pipelines/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineRunHydration',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/stream/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/conductorGateway',
      '@/services/pipelineRunHydration',
      '@/services/pipelineRunStream',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/cancel/route.ts',
    forbiddenImports: [
      '@/services/conductorGateway',
      '@/services/orgs',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/jobs/[jobId]/retry/route.ts',
    forbiddenImports: [
      '@/services/conductorGateway',
      '@/services/orgs',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/jobs/[jobId]/trigger/route.ts',
    forbiddenImports: [
      '@/services/conductorGateway',
      '@/services/orgs',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/logs/[stepId]/route.ts',
    forbiddenImports: [
      '@/services/conductorGateway',
      '@/lib/db',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/logs/[stepId]/stream/route.ts',
    forbiddenImports: [
      '@/services/conductorGateway',
      '@/lib/db',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/artifacts/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/services/artifactRegistry',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
  },
  {
    file: 'app/api/pipeline-runs/[runId]/artifacts/[artifactId]/download-token/route.ts',
    forbiddenImports: [
      '@/lib/db',
      '@/lib/artifactDownloadToken',
    ],
    requiredImportPrefixes: ['@/features/pipeline-runs/application/'],
    mustUseAuthedRoute: true,
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

  if (rule.mustUseAuthedRoute) {
    if (!imports.includes('@/services/apiRoute')) {
      console.error(`[route-layering] ${rule.file} must import @/services/apiRoute`);
      hasError = true;
    }
    if (!content.includes('withAuthedRoute')) {
      console.error(`[route-layering] ${rule.file} must use withAuthedRoute at route boundaries`);
      hasError = true;
    }
  }
}

if (hasError) {
  process.exit(1);
}
