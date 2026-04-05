import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VALID_CONCURRENCY_MODES = new Set(['allow', 'queue', 'cancel_previous']);
const STRUCTURED_REPORT_SUFFIXES = ['.sarif', '.static-analysis.json', '.vet.json'];

function usage() {
  console.error('Usage: node ./src/scripts/check-pipeline-config.mjs <pipeline-config.json> [more files...]');
  console.error('Accepted formats:');
  console.error('  1) Raw pipeline config object');
  console.error('  2) Wrapper object with { config, concurrency_mode }');
}

function normalizePathList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function isStructuredReportPath(value) {
  const normalized = value.trim().toLowerCase();
  return STRUCTURED_REPORT_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function stageForJob(job) {
  const raw = typeof job?.stage === 'string' ? job.stage.trim().toLowerCase() : '';
  if (raw) return raw;
  const type = typeof job?.type === 'string' ? job.type.trim().toLowerCase() : 'shell';
  if (type === 'source_checkout') return 'source';
  if (type === 'quality_gate') return 'review';
  return 'build';
}

function issue(pathValue, message) {
  return { path: pathValue, message };
}

function parsePipelinePayload(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { config: null, concurrencyMode: undefined };
  }

  if ('config' in parsed && parsed.config && typeof parsed.config === 'object') {
    const concurrencyMode =
      typeof parsed.concurrency_mode === 'string'
        ? parsed.concurrency_mode
        : typeof parsed.concurrencyMode === 'string'
        ? parsed.concurrencyMode
        : undefined;
    return { config: parsed.config, concurrencyMode };
  }

  return { config: parsed, concurrencyMode: undefined };
}

export function validatePipelineConfig(config, concurrencyMode) {
  const issues = [];
  const environment = typeof config.environment === 'string' ? config.environment.trim().toLowerCase() : 'production';
  const jobs = Array.isArray(config.jobs) ? config.jobs : [];
  const trigger = config.trigger && typeof config.trigger === 'object' ? config.trigger : {};

  if (typeof config.buildImage !== 'string' || config.buildImage.trim().length === 0) {
    issues.push(issue('buildImage', 'buildImage is required'));
  }

  if (concurrencyMode !== undefined && !VALID_CONCURRENCY_MODES.has(concurrencyMode)) {
    issues.push(issue('concurrency_mode', `concurrency_mode must be one of: ${Array.from(VALID_CONCURRENCY_MODES).join(', ')}`));
  }
  if (environment === 'production' && concurrencyMode === 'allow') {
    issues.push(issue('concurrency_mode', 'production pipelines must not use allow mode; use queue'));
  }

  const autoTrigger = trigger.autoTrigger === true;
  const schedule = typeof trigger.schedule === 'string' ? trigger.schedule.trim() : '';
  const purpose = typeof trigger.purpose === 'string' ? trigger.purpose.trim() : '';
  if (autoTrigger && schedule && purpose.length === 0) {
    issues.push(issue('trigger.purpose', 'trigger purpose is required when autoTrigger and schedule are both enabled'));
  }

  const sourceJobs = jobs.filter((job) => stageForJob(job) === 'source');
  if (sourceJobs.length !== 1 || String(sourceJobs[0]?.type ?? '').trim().toLowerCase() !== 'source_checkout') {
    issues.push(issue('jobs', 'pipeline must include exactly one source_checkout job in source stage'));
  }
  const reviewJobs = jobs.filter((job) => stageForJob(job) === 'review');
  if (reviewJobs.length !== 1 || String(reviewJobs[0]?.type ?? '').trim().toLowerCase() !== 'quality_gate') {
    issues.push(issue('jobs', 'pipeline must include exactly one quality_gate job in review stage'));
  }

  for (const [jobIndex, job] of jobs.entries()) {
    const jobType = String(job?.type ?? 'shell').trim().toLowerCase();
    const jobStage = stageForJob(job);
    const steps = Array.isArray(job?.steps) ? job.steps : [];

    if (jobType === 'quality_gate') {
      if (steps.length !== 2 || steps[0]?.checkType !== 'ai_review' || steps[1]?.checkType !== 'static_analysis') {
        issues.push(issue(`jobs[${jobIndex}].steps`, 'quality_gate must include exactly two steps ordered as ai_review then static_analysis'));
      }
      const minScore = Number(job?.minScore);
      if (!Number.isInteger(minScore) || minScore < 1 || minScore > 100) {
        issues.push(issue(`jobs[${jobIndex}].minScore`, 'quality_gate minScore must be an integer between 1 and 100'));
      }
      const staticStep = steps[1];
      if (!staticStep || typeof staticStep.script !== 'string' || staticStep.script.trim().length === 0) {
        issues.push(issue(`jobs[${jobIndex}].steps[1].script`, 'quality_gate static_analysis step requires a shell command'));
      }
      const reportPaths = normalizePathList(staticStep?.artifactPaths);
      if (reportPaths.length === 0) {
        issues.push(issue(`jobs[${jobIndex}].steps[1].artifactPaths`, 'quality_gate static_analysis step requires a report artifact path'));
      } else if (!reportPaths.some((item) => isStructuredReportPath(item))) {
        issues.push(issue(`jobs[${jobIndex}].steps[1].artifactPaths`, 'quality_gate static_analysis must include SARIF, normalized JSON, or Go vet JSON output'));
      }
      continue;
    }

    for (const [stepIndex, step] of steps.entries()) {
      if (step?.checkType) {
        issues.push(issue(`jobs[${jobIndex}].steps[${stepIndex}].checkType`, 'checkType is only allowed on quality_gate jobs'));
      }
      if (jobStage !== 'deploy') {
        continue;
      }

      const artifactSource = typeof step?.artifactSource === 'string' ? step.artifactSource.trim().toLowerCase() : '';
      if (!artifactSource) {
        issues.push(issue(`jobs[${jobIndex}].steps[${stepIndex}].artifactSource`, 'deploy steps must explicitly set artifactSource to run or registry'));
        continue;
      }
      if (artifactSource !== 'run' && artifactSource !== 'registry') {
        issues.push(issue(`jobs[${jobIndex}].steps[${stepIndex}].artifactSource`, 'artifactSource must be run or registry'));
        continue;
      }

      if (artifactSource === 'run') {
        const artifactInputs = normalizePathList(step?.artifactInputs);
        if (artifactInputs.length === 0) {
          issues.push(issue(`jobs[${jobIndex}].steps[${stepIndex}].artifactInputs`, 'deploy steps using run artifacts must declare artifactInputs'));
        }
      }

      if (artifactSource === 'registry') {
        const repository = typeof step?.registryRepository === 'string' ? step.registryRepository.trim() : '';
        const version = typeof step?.registryVersion === 'string' ? step.registryVersion.trim() : '';
        const channel = typeof step?.registryChannel === 'string' ? step.registryChannel.trim() : '';
        if (!repository) {
          issues.push(issue(`jobs[${jobIndex}].steps[${stepIndex}].registryRepository`, 'registryRepository is required when artifactSource=registry'));
        }
        if ((version && channel) || (!version && !channel)) {
          issues.push(issue(`jobs[${jobIndex}].steps[${stepIndex}]`, 'choose exactly one of registryVersion or registryChannel when artifactSource=registry'));
        }
      }
    }
  }

  if (environment === 'production') {
    const deployEntryMode = config?.stages?.deploy?.entryMode ?? 'auto';
    if (deployEntryMode !== 'manual') {
      issues.push(issue('stages.deploy.entryMode', 'production pipelines must require a manual deploy gate'));
    }
  }

  return issues;
}

export async function validateFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = await readFile(absolutePath, 'utf8');
  const { config, concurrencyMode } = parsePipelinePayload(raw);
  if (!config) {
    return [issue('$', 'file does not contain a valid pipeline config object')];
  }
  return validatePipelineConfig(config, concurrencyMode);
}

async function main() {
  const files = process.argv.slice(2).filter((arg) => arg.trim().length > 0);
  if (files.length === 0) {
    usage();
    process.exit(1);
  }

  let totalIssues = 0;
  for (const file of files) {
    try {
      const issues = await validateFile(file);
      if (issues.length === 0) {
        continue;
      }
      totalIssues += issues.length;
      console.error(`\n${file}: ${issues.length} issue(s)`);
      for (const item of issues) {
        console.error(`  - ${item.path}: ${item.message}`);
      }
    } catch (error) {
      totalIssues += 1;
      console.error(`\n${file}: failed to validate`);
      console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (totalIssues > 0) {
    console.error(`\nPipeline config lint failed with ${totalIssues} issue(s).`);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error('Pipeline config lint execution failed.');
    console.error(error);
    process.exit(1);
  });
}
