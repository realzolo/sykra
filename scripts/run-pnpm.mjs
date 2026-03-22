import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const corepackHome = process.env.COREPACK_HOME?.trim() || join(repoRoot, '.cache', 'corepack');

mkdirSync(corepackHome, { recursive: true });

const result = spawnSync('corepack', ['pnpm', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    COREPACK_HOME: corepackHome,
  },
});

if (result.error) {
  console.error(`[run-pnpm] failed to launch corepack: ${result.error.message}`);
  process.exit(1);
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
