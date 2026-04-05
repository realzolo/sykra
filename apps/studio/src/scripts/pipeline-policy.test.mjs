import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePipelineConfig } from './check-pipeline-config.mjs';

function createValidPipelineConfig(overrides = {}) {
  const base = {
    name: 'Production Deploy',
    environment: 'production',
    buildImage: 'node:22-bookworm',
    trigger: {
      autoTrigger: false,
    },
    stages: {
      deploy: {
        entryMode: 'manual',
      },
    },
    jobs: [
      {
        id: 'source',
        name: 'Source',
        stage: 'source',
        type: 'source_checkout',
        steps: [{ id: 'checkout', name: 'Checkout', script: '' }],
      },
      {
        id: 'quality',
        name: 'Quality Gate',
        stage: 'review',
        type: 'quality_gate',
        minScore: 60,
        steps: [
          { id: 'ai-review', name: 'AI Review', checkType: 'ai_review', script: '' },
          {
            id: 'static-analysis',
            name: 'Static Analysis',
            checkType: 'static_analysis',
            script: 'npm run lint',
            artifactPaths: ['quality-gate.sarif'],
          },
        ],
      },
      {
        id: 'deploy',
        name: 'Deploy',
        stage: 'deploy',
        type: 'shell',
        steps: [
          {
            id: 'deploy-step',
            name: 'Deploy',
            script: 'echo deploy',
            artifactSource: 'run',
            artifactInputs: ['dist/**'],
          },
        ],
      },
    ],
  };
  return {
    ...base,
    ...overrides,
    trigger: {
      ...base.trigger,
      ...(overrides.trigger ?? {}),
    },
    stages: {
      ...base.stages,
      ...(overrides.stages ?? {}),
    },
    jobs: overrides.jobs ?? base.jobs,
  };
}

function hasIssuePath(issues, pathValue) {
  return issues.some((item) => item.path === pathValue);
}

test('valid production pipeline passes policy checks', () => {
  const config = createValidPipelineConfig();
  const issues = validatePipelineConfig(config, 'queue');
  assert.equal(issues.length, 0);
});

test('mixed trigger requires explicit trigger purpose', () => {
  const config = createValidPipelineConfig({
    trigger: {
      autoTrigger: true,
      schedule: '0 2 * * *',
    },
  });
  const issues = validatePipelineConfig(config, 'queue');
  assert.equal(hasIssuePath(issues, 'trigger.purpose'), true);
});

test('mixed trigger with purpose passes', () => {
  const config = createValidPipelineConfig({
    trigger: {
      autoTrigger: true,
      schedule: '0 2 * * *',
      purpose: 'Push for commit validation, schedule for nightly drift checks',
    },
  });
  const issues = validatePipelineConfig(config, 'queue');
  assert.equal(hasIssuePath(issues, 'trigger.purpose'), false);
});

test('production cannot use allow concurrency mode', () => {
  const config = createValidPipelineConfig();
  const issues = validatePipelineConfig(config, 'allow');
  assert.equal(hasIssuePath(issues, 'concurrency_mode'), true);
});

test('deploy step must declare artifactSource', () => {
  const config = createValidPipelineConfig({
    jobs: [
      ...createValidPipelineConfig().jobs.slice(0, 2),
      {
        id: 'deploy',
        name: 'Deploy',
        stage: 'deploy',
        type: 'shell',
        steps: [{ id: 'deploy-step', name: 'Deploy', script: 'echo deploy' }],
      },
    ],
  });
  const issues = validatePipelineConfig(config, 'queue');
  assert.equal(hasIssuePath(issues, 'jobs[2].steps[0].artifactSource'), true);
});

test('deploy step using run source must declare artifactInputs', () => {
  const config = createValidPipelineConfig({
    jobs: [
      ...createValidPipelineConfig().jobs.slice(0, 2),
      {
        id: 'deploy',
        name: 'Deploy',
        stage: 'deploy',
        type: 'shell',
        steps: [
          {
            id: 'deploy-step',
            name: 'Deploy',
            script: 'echo deploy',
            artifactSource: 'run',
          },
        ],
      },
    ],
  });
  const issues = validatePipelineConfig(config, 'queue');
  assert.equal(hasIssuePath(issues, 'jobs[2].steps[0].artifactInputs'), true);
});

test('registry source must select exactly one version selector', () => {
  const config = createValidPipelineConfig({
    jobs: [
      ...createValidPipelineConfig().jobs.slice(0, 2),
      {
        id: 'deploy',
        name: 'Deploy',
        stage: 'deploy',
        type: 'shell',
        steps: [
          {
            id: 'deploy-step',
            name: 'Deploy',
            script: 'echo deploy',
            artifactSource: 'registry',
            registryRepository: 'web-app',
            registryVersion: '1.2.0',
            registryChannel: 'prod',
          },
        ],
      },
    ],
  });
  const issues = validatePipelineConfig(config, 'queue');
  assert.equal(hasIssuePath(issues, 'jobs[2].steps[0]'), true);
});

test('production requires manual deploy gate', () => {
  const config = createValidPipelineConfig({
    stages: {
      deploy: {
        entryMode: 'auto',
      },
    },
  });
  const issues = validatePipelineConfig(config, 'queue');
  assert.equal(hasIssuePath(issues, 'stages.deploy.entryMode'), true);
});
