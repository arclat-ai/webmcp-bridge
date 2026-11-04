#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDiscover = path.join(__dirname, 'dist', 'discover.js');
const srcDiscover = path.join(__dirname, 'src', 'discover.ts');

async function main() {
  // If dist/discover.js exists and is not older than src/discover.ts, run it directly
  if (fs.existsSync(distDiscover)) {
    const distMtime = fs.statSync(distDiscover).mtimeMs;
    const srcMtime = fs.existsSync(srcDiscover) ? fs.statSync(srcDiscover).mtimeMs : 0;
    if (distMtime >= srcMtime) {
      const { runDiscover } = await import('./dist/discover.js');
      await runDiscover(process.argv.slice(2));
      return;
    }
  }

  // Otherwise, spawn tsx for latest TypeScript execution
  try {
    const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
    const child = spawn(process.execPath, [tsxCli, srcDiscover, ...process.argv.slice(2)], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  } catch (err) {
    if (fs.existsSync(distDiscover)) {
      const { runDiscover } = await import('./dist/discover.js');
      await runDiscover(process.argv.slice(2));
      return;
    }
    process.stderr.write(`Error launching discovery: ${err}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
