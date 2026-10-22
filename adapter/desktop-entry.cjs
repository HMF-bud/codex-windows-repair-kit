'use strict';
const fs = require('node:fs');
const path = require('node:path');
const local = path.join(__dirname, '../local');
const config = JSON.parse(fs.readFileSync(path.join(local, 'startup.json'), 'utf8'));
const [backend, ...args] = process.argv.slice(2);
if (!backend || !fs.existsSync(backend)) {
  throw Error('Current registered Codex backend is missing. Use Rollback.cmd if needed.');
}
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
  throw Error('Non-server commands must use the native passthrough.');
}
