'use strict';

// Transform only local directory metadata. Never change prompts or SSH commands.
function createNormalizer({ scope, drive }) {
  if (!/^\\\\[^\\/]+\\[^\\/]+$/.test(scope) || !/^[A-Za-z]:$/.test(drive)) {
    throw Error('Expected a UNC share root and a drive letter such as R:.');
  }
  const methods = new Set(['thread/start', 'thread/resume', 'thread/fork', 'turn/start']);
  function directory(value) {
    if (typeof value !== 'string') return value;
    if (value.split(/[\\/]/).some(part => part === '.' || part === '..')) return value;
    const mapping = process.env.CODEX_PATH_ADAPTER_MAPPED_SHARE;
    if (mapping?.replace(/\\+$/, '').toLowerCase() === scope.toLowerCase() &&
        value.slice(0, 2).toLowerCase() === drive.toLowerCase() && /^[\\/]/.test(value.slice(2))) {
      value = scope + '\\' + value.slice(3).replace(/\//g, '\\');
    }
    const lower = value.toLowerCase(), root = scope.toLowerCase();
    if (lower !== root && !lower.startsWith(root + '\\')) return value;
    return value.replace(/\\+$/, '');
  }
  function directories(record) {
    if (!record || typeof record !== 'object') return;
    if (typeof record.cwd === 'string') record.cwd = directory(record.cwd);
    if (Array.isArray(record.runtimeWorkspaceRoots)) {
      record.runtimeWorkspaceRoots = record.runtimeWorkspaceRoots.map(directory);
    }
  }
  function normalizeRequest(message) {
    if (!methods.has(message?.method) || !message.params) return message;
    const result = structuredClone(message), params = result.params;
    if (!Array.isArray(params.environments) || params.environments.every(env => env.environmentId === 'local')) {
      directories(params);
      if (Array.isArray(params.sandboxPolicy?.writableRoots)) {
        params.sandboxPolicy.writableRoots = params.sandboxPolicy.writableRoots.map(directory);
      }
    }
    for (const env of params.environments || []) {
      if (env.environmentId === 'local') directories(env);
    }
    return result;
  }
  return { directory, normalizeRequest };
}
module.exports = { createNormalizer };
