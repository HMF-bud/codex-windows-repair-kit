'use strict';
// Real original backend, native launcher, isolated home, local fixed response.
// Never read or copy original chats, use real model credentials, or write the share.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root,'local/startup.json'),'utf8'));
const run = path.join(root,'local/checks',new Date().toISOString().replace(/[:.]/g,'-'));
const testHome = path.join(run,'codex-home');
fs.mkdirSync(testHome,{recursive:true});
const result = {startedUTC:new Date().toISOString(),appVersion:config.appVersion,backendVersion:config.backendVersion,cases:[],passed:false};
const marker = 'REPAIR_KIT_PERSISTENCE_OK';
const waiting = new Map(), events = [];
let sequence = 0, child;
const stderr = fs.createWriteStream(path.join(run,'stderr.log'));
const mock = http.createServer((req,res) => {
  req.resume();
  req.on('end',() => {
    if(req.method!=='POST'||!req.url.endsWith('/responses')) {res.writeHead(404);res.end();return;}
    const id='resp_kit_'+(++sequence);
    const item={id:'msg_'+id,type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:marker,annotations:[]}]};
    const response={id,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:'gpt-5.1-codex',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    for(const event of [
      {type:'response.created',response:{...response,status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
      {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:marker},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response}
    ]) res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
    res.end();
  });
});
function rpc(method,params) {
  const id=++sequence;
  return new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{waiting.delete(id);reject(Error(method+' timeout'));},25000);
    waiting.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
}
async function completed(threadId,turnId) {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
    const event=events.find(e=>e.method==='turn/completed'&&e.params?.threadId===threadId&&e.params?.turn?.id===turnId);
    if(event) {assert.equal(event.params.turn.status,'completed');return;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Turn completion timeout');
}
async function checkCase(label,cwd) {
  const selection={environments:[{environmentId:'local',cwd,runtimeWorkspaceRoots:[cwd]}]};
  const start=await rpc('thread/start',{cwd,...selection,model:'gpt-5.1-codex',modelProvider:'local_probe',
    sandbox:'workspace-write',approvalPolicy:'never',historyMode:'paginated',ephemeral:false,
    baseInstructions:'Isolated storage test. No tools. Return the test marker.'});
  const threadId=start.thread.id;
  const turn=await rpc('turn/start',{threadId,...selection,
    sandboxPolicy:{type:'workspaceWrite',writableRoots:[run],networkAccess:false},
    input:[{type:'text',text:'STORAGE_CHECK_'+label}]});
  await completed(threadId,turn.turn.id);
  const read=await rpc('thread/read',{threadId,includeTurns:true});
  assert.match(JSON.stringify(read),new RegExp(marker));
  assert.match(fs.readFileSync(start.thread.path,'utf8'),new RegExp(marker));
  await rpc('thread/unsubscribe',{threadId});
  await rpc('thread/resume',{threadId,cwd,...selection,model:'gpt-5.1-codex',modelProvider:'local_probe',sandbox:'workspace-write',approvalPolicy:'never'});
  const reopened=await rpc('thread/turns/list',{threadId,limit:1,itemsView:'full'});
  assert.match(JSON.stringify(reopened),new RegExp(marker));
  result.cases.push({label,passed:true});
  console.log('PASS: '+label+' saved and reopened');
}
async function main() {
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const port=mock.address().port;
  fs.writeFileSync(path.join(testHome,'config.toml'),[
    'model="gpt-5.1-codex"','model_provider="local_probe"','approval_policy="never"',
    'web_search="disabled"','project_doc_max_bytes=0','[windows]','sandbox="unelevated"',
    '[analytics]','enabled=false','[feedback]','enabled=false','[model_providers.local_probe]',
    'name="Local fixed-response test"',`base_url="http://127.0.0.1:${port}/v1"`,
    'wire_api="responses"','requires_openai_auth=false','supports_websockets=false',
    'request_max_retries=0','stream_max_retries=0'
  ].join('\n'));
  const env={};
  for(const key of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC','HOMEDRIVE','HOMEPATH']) {
    if(process.env[key])env[key]=process.env[key];
  }
  Object.assign(env,{CODEX_HOME:testHome,NO_PROXY:'localhost,127.0.0.1,::1',HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',RUST_LOG:'warn'});
  child=spawn(path.join(root,'adapter/CodexPathAdapter.exe'),['app-server','--stdio','-c','features.code_mode_host=true','-c','features.prefer_mxc=true'],{cwd:run,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.on('error',error=>{for(const pending of waiting.values())pending.reject(error);waiting.clear();});
  child.stderr.pipe(stderr);
  readline.createInterface({input:child.stdout}).on('line',line=>{
    let message;try {message=JSON.parse(line);}catch{return;}
    if(message.id!=null&&waiting.has(message.id)) {
      const pending=waiting.get(message.id);waiting.delete(message.id);
      message.error?pending.reject(Error(JSON.stringify(message.error))):pending.resolve(message.result);
    } else if(message.id!=null&&message.method) {
      child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Test does not allow approvals or model tools'}})+'\n');
    } else events.push(message);
  });
  await rpc('initialize',{clientInfo:{name:'repair_kit_test',version:'1'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  const childFolder=fs.readdirSync(config.scope,{withFileTypes:true}).find(e=>e.isDirectory()&&!e.name.startsWith('.')&&!e.name.startsWith('$'));
  if(!childFolder)throw Error('Need an existing project subdirectory on the mapped share to validate; no remote folder was created.');
  for(const [label,cwd] of [
    ['UNC root',config.scope+'\\'],
    ['UNC subdirectory',config.scope+'\\'+childFolder.name+'\\'],
    ['mapped drive root',config.drive+'\\'],
    ['mapped drive subdirectory',config.drive+'\\'+childFolder.name+'\\']
  ])await checkCase(label,cwd);
  const allowed=path.join(run,'allowed');fs.mkdirSync(allowed);
  const denied=path.join(root,'local','sandbox-denied-'+path.basename(run)+'.txt');
  const script="const fs=require('node:fs');fs.writeFileSync('allowed.txt','OK');let denied=false;try{fs.writeFileSync("+JSON.stringify(denied)+",'SHOULD_NOT_WRITE')}catch(e){if(e.code==='EACCES'||e.code==='EPERM')denied=true;else throw e;}console.log(JSON.stringify({allowed:fs.readFileSync('allowed.txt','utf8')==='OK',denied}));";
  const sandbox=await rpc('command/exec',{command:[config.nodePath,'-e',script],cwd:allowed,timeoutMs:20000,
    sandboxPolicy:{type:'workspaceWrite',writableRoots:[allowed],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}});
  assert.equal(sandbox.exitCode,0,sandbox.stderr);
  assert.deepEqual(JSON.parse(sandbox.stdout.trim()),{allowed:true,denied:true});
  assert.equal(fs.existsSync(denied),false);
  result.sandbox={allowedWriteSucceeded:true,outsideWriteDenied:true};
  result.passed=true;
  console.log('PASS: sandbox allows authorized writes and denies writes outside the test workspace');
}
main().catch(error=>{result.error=error.message;console.error(error.message);process.exitCode=1;}).finally(async()=>{
  if(child&&child.exitCode===null) {
    child.stdin.end();
    await new Promise(resolve=>{const timer=setTimeout(resolve,4000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    if(child.exitCode===null)child.kill(); // Only the isolated child created by this test.
  }
  mock.close();stderr.end();result.finishedUTC=new Date().toISOString();
  fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(root,'local','verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log('Test record: '+path.join(run,'result.json'));
});
