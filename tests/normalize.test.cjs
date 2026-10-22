'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNormalizer } = require('../adapter/normalize.cjs');
const scope = '\\\\example-host\\example-share';
const { directory, normalizeRequest } = createNormalizer({ scope, drive: 'R:' });
test('UNC root and every project directory lose only trailing separators', () => {
  assert.equal(directory(scope + '\\'), scope);
  assert.equal(directory(scope + '\\中文项目\\'), scope + '\\中文项目');
  for (const value of ['C:\\', 'R:', '/home/user/project/', '\\\\other\\share\\',
    scope + '-other\\', scope + '\\..\\other\\', '\\\\?\\UNC\\example-host\\example-share\\']) {
    assert.equal(directory(value), value);
  }
});
test('only a drive with the live matching mapping is translated; arbitrary drive letters work', () => {
  const saved = process.env.CODEX_PATH_ADAPTER_MAPPED_SHARE;
  try {
    delete process.env.CODEX_PATH_ADAPTER_MAPPED_SHARE;
    assert.equal(directory('R:\\project\\'), 'R:\\project\\');
    process.env.CODEX_PATH_ADAPTER_MAPPED_SHARE = scope;
    assert.equal(directory('r:/project/'), scope + '\\project');
    assert.equal(directory('R:\\'), scope);
    assert.equal(directory('R:\\..\\other\\'), 'R:\\..\\other\\');
    assert.equal(createNormalizer({ scope, drive:'Z:' }).directory('Z:\\中文\\'), scope + '\\中文');
    process.env.CODEX_PATH_ADAPTER_MAPPED_SHARE = '\\\\other\\share';
    assert.equal(directory('R:\\project\\'), 'R:\\project\\');
  } finally {
    if (saved === undefined) delete process.env.CODEX_PATH_ADAPTER_MAPPED_SHARE;
    else process.env.CODEX_PATH_ADAPTER_MAPPED_SHARE = saved;
  }
});
test('requests remain immutable, idempotent, scoped to local environments and known methods', () => {
  const input = { id:4, method:'turn/start', params:{
    environments:[
      {environmentId:'local',cwd:scope+'\\',runtimeWorkspaceRoots:[scope+'\\']},
      {environmentId:'ssh:cluster',cwd:scope+'\\',runtimeWorkspaceRoots:['/home/user/']}
    ], input:[{type:'text',text:'Do not change '+scope+'\\ or ssh commands'}],
    approvalPolicy:'on-request',sandboxPolicy:{type:'workspaceWrite',writableRoots:[scope+'\\'],networkAccess:false}
  }};
  const original = structuredClone(input), result = normalizeRequest(input);
  assert.deepEqual(input, original);
  assert.equal(result.params.environments[0].cwd, scope);
  assert.deepEqual(result.params.environments[1], original.params.environments[1]);
  assert.deepEqual(result.params.input, original.params.input);
  assert.deepEqual(result.params.sandboxPolicy, original.params.sandboxPolicy);
  assert.equal(result.params.approvalPolicy, 'on-request');
  assert.deepEqual(normalizeRequest(result), result);
  for (const method of ['command/exec','thread/read','config/write']) {
    const request = {method, params:{cwd:scope+'\\'}};
    assert.deepEqual(normalizeRequest(request), request);
  }
  for (const method of ['thread/start','thread/resume','thread/fork','turn/start']) {
    const result = normalizeRequest({method, params:{cwd:scope+'\\',sandboxPolicy:{type:'workspaceWrite',writableRoots:[scope+'\\'],networkAccess:false}}});
    assert.equal(result.params.cwd, scope);
    assert.deepEqual(result.params.sandboxPolicy.writableRoots, [scope]);
    assert.equal(result.params.sandboxPolicy.networkAccess, false);
  }
});
test('misconfigured shares and relative drives are refused', () => {
  for (const bad of ['C:\\', '/home', '\\\\host\\share\\subdir']) {
    assert.throws(() => createNormalizer({scope:bad,drive:'R:'}));
  }
  assert.throws(() => createNormalizer({scope,drive:'R'}));
});
