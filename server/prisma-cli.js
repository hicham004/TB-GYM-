import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const prismaCli = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js');

const child = spawn(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    RUST_LOG: process.env.RUST_LOG || 'info',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
