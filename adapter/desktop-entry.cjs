'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const local = path.join(__dirname, '../local');
const config = JSON.parse(fs.readFileSync(path.join(local, 'startup.json'), 'utf8'));
const backend = config.backendPath;
const args = process.argv.slice(2);
if (!fs.existsSync(backend) || !fs.existsSync(config.appPath)) {
  throw Error('Configured Codex version is missing. Run Install.cmd to revalidate after an update.');
}
process.env.CODEX_CLI_PATH = backend;
process.env.CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY = config.sandboxPackageFamily;
if (args.includes('app-server')) {
  fs.appendFileSync(path.join(local, 'activation.jsonl'), JSON.stringify({
    timeUTC: new Date().toISOString(), pid: process.pid, event: 'backend-start',
    backend, scope: config.scope, drive: config.drive,
    mappedShare: process.env.CODEX_PATH_ADAPTER_MAPPED_SHARE || null,
    isolatedHome: !!process.env.CODEX_HOME && path.resolve(process.env.CODEX_HOME).startsWith(path.join(local, 'checks') + path.sep)
  }) + '\n');
  process.argv = [process.execPath, path.join(__dirname, 'app-server-adapter.cjs'), backend, ...args];
  require('./app-server-adapter.cjs');
} else {
  const child = spawn(backend, args, { stdio: 'inherit', windowsHide: true, env: process.env });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
