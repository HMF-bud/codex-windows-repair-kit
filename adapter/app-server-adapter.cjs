'use strict';

// Explicit opt-in stdio relay. No application configuration or files are edited.
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');
const fs = require('node:fs');
const path = require('node:path');
const { createNormalizer } = require('./normalize.cjs');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local/startup.json'), 'utf8'));
const { normalizeRequest } = createNormalizer(config);

const [backend, ...args] = process.argv.slice(2);
if (!backend || !args.includes('app-server')) {
  console.error('Usage: node app-server-adapter.cjs <real-codex.exe> app-server --stdio [existing arguments]');
  process.exit(2);
}

const child = spawn(backend, args, {
  env: process.env, cwd: process.cwd(), windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe']
});
const decoder = new StringDecoder('utf8');
let pending = '';
let changed = 0;
function rewrite(line) {
  let request;
  try { request = JSON.parse(line); } catch { return line; }
  const normalized = normalizeRequest(request);
  if (JSON.stringify(request) === JSON.stringify(normalized)) return line;
  changed++;
  return JSON.stringify(normalized);
}
const requests = new Transform({
  transform(chunk, encoding, done) {
    pending += decoder.write(chunk);
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      this.push(rewrite(pending.slice(0, end)) + '\n');
      pending = pending.slice(end + 1);
    }
    done();
  },
  flush(done) {
    pending += decoder.end();
    if (pending) this.push(rewrite(pending));
    done();
  }
});
process.stdin.pipe(requests).pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once('error', error => {
  console.error('Path adapter failed to start backend: ' + error.message);
  process.exitCode = 1;
  process.stdin.destroy();
});
child.once('exit', (code, signal) => {
  console.error(JSON.stringify({ pathAdapter: 'stopped', changedRequests: changed, signal }));
  process.exitCode = code ?? 1;
  process.stdin.destroy();
});
// A closed backend should close this relay, not trigger a second connection.
child.stdin.on('error', error => {
  if (error.code !== 'EPIPE') console.error(error.message);
  process.exitCode = 1;
  process.stdin.destroy();
});
