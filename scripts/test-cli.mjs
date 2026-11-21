import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DESHI_GEE_TEST_MODE = '1';

const rawArgs = process.argv.slice(2);
let testFiles = [];

if (rawArgs.length === 0 || rawArgs[0] === 'tests/*.test.ts') {
  const dir = resolve('tests');
  if (existsSync(dir)) {
    testFiles = readdirSync(dir)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => `tests/${f}`);
  }
} else {
  testFiles = rawArgs;
}

const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');

const child = spawn(
  process.execPath,
  [tsxCli, '--test', ...testFiles],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DESHI_GEE_TEST_MODE: '1',
    },
    shell: false,
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
