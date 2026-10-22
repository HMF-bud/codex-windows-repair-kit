'use strict';
// Entry compatibility only. Real policy reads are read-only; echo fixtures and
// missing old-version paths are confined to this directory's test subdirectory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const readline = require('node:readline');
const root = path.resolve(__dirname, '../adapter');
const local = path.resolve(__dirname, '../local');
const config = JSON.parse(fs.readFileSync(path.join(local,'startup.json'),'utf8'));
const run = path.join(local,'checks','entry-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(run,{recursive:true});
const adapter = path.join(root,'CodexPathAdapter.exe');
const report = {packageRoot:config.packageRoot,startedUTC:new Date().toISOString(),passed:false,desktopRestartAcceptance:'pending',checks:{}};
function command(exe,args,input,env=process.env,cwd=run) {
  const r=spawnSync(exe,args,{input,env,cwd,windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
  if(r.error)throw r.error;
  return r;
}
function sameOutput(a,b) {
  assert.equal(a.status,b.status);assert.deepEqual(a.stdout,b.stdout);assert.deepEqual(a.stderr,b.stderr);
}
async function policyRead(exe) {
  const env={...process.env,CODEX_CLI_PATH:config.backendPath};
  const child=spawn(exe,['-c','features.code_mode_host=true','app-server','--analytics-default-enabled'],{cwd:run,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let id=0;
  child.stderr.resume();
  child.on('error',error=>{for(const p of pending.values())p.reject(error);pending.clear();});
  readline.createInterface({input:child.stdout}).on('line',line=>{
    let m;try{m=JSON.parse(line);}catch{return;}
    if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);p.resolve(m);}
  });
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timed out'));},25000);
    pending.set(n,{resolve:m=>{clearTimeout(timer);resolve(m);},reject:e=>{clearTimeout(timer);reject(e);}});
    child.stdin.write(JSON.stringify({id:n,method,params})+'\n');
  });
  try {
    const init=await rpc('initialize',{clientInfo:{name:'codex_desktop',title:'Codex Desktop',version:config.appVersion},capabilities:{experimentalApi:true}});
    assert.ok(init.result,'Real backend initialization failed');
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const requirements=await rpc('configRequirements/read',{});
    const settings=await rpc('config/read',{includeLayers:false});
    assert.ok(!requirements.error,'Real policy read returned an error');
    assert.ok(!settings.error,'Real configuration read returned an error');
    return {requirements:requirements.result,settings:settings.result};
  } finally {
    child.stdin.end();
    if(child.exitCode===null)await new Promise(resolve=>{const t=setTimeout(resolve,3500);child.once('exit',()=>{clearTimeout(t);resolve();});});
    if(child.exitCode===null)child.kill();
  }
}
async function main() {
  // Real argument validation/exit status and help/version output, not fabricated.
  for(const args of [['--version'],['app-server','--help'],['--repair-kit-nonexistent-option']]) {
    sameOutput(command(config.backendPath,args,Buffer.alloc(0)),command(adapter,args,Buffer.alloc(0)));
  }
  report.checks.realCliPassthrough=true;

  // Use the exact native launcher with a fixture resolver. This never changes
  // the production resolver's OS trust boundary or allows runtime injection.
  const fixtureRoot=path.join(run,'fixture with spaces');
  const fixture=path.join(fixtureRoot,'adapter');fs.mkdirSync(fixture,{recursive:true});
  const fixtureLocal=path.join(fixtureRoot,'local');fs.mkdirSync(fixtureLocal);
  fs.writeFileSync(path.join(fixtureLocal,'startup.json'),JSON.stringify(config));
  for(const file of ['CodexPathAdapter.exe','desktop-entry.cjs','app-server-adapter.cjs','normalize.cjs'])fs.copyFileSync(path.join(root,file),path.join(fixture,file));
  const probeSource=`using System; using System.IO; using System.Text; using System.Web.Script.Serialization;
class Probe { public static int Main(string[] args) {
  Console.OutputEncoding = new UTF8Encoding(false);
  if(Array.IndexOf(args,"app-server")>=0 && args.Length>0 && args[0]=="app-server") {
    string line; while((line=Console.ReadLine())!=null) Console.WriteLine("{\\"id\\":7,\\"error\\":{\\"code\\":-32001,\\"message\\":\\"POLICY_DENIED_TEST\\"}}"); return 23;
  }
  string s = new JavaScriptSerializer().Serialize(new {args=args,cwd=Environment.CurrentDirectory,
    marker=Environment.GetEnvironmentVariable("ADAPTER_TEST_MARKER"),home=Environment.GetEnvironmentVariable("CODEX_HOME"),
    sandbox=Environment.GetEnvironmentVariable("CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY"),registered=Environment.GetEnvironmentVariable("CODEX_WINDOWS_REGISTERED_CORE")})+"\\n";
  byte[] header=Encoding.UTF8.GetBytes(s);var output=Console.OpenStandardOutput();output.Write(header,0,header.Length);
  Console.OpenStandardInput().CopyTo(output);byte[] error=new byte[]{0,255,65,10};Console.OpenStandardError().Write(error,0,error.Length);return 37;
}}`;
  fs.writeFileSync(path.join(fixture,'Probe.cs'),probeSource);
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const built=command(compiler,['/nologo','/target:exe','/reference:System.Web.Extensions.dll','/out:'+path.join(fixture,'Probe.exe'),path.join(fixture,'Probe.cs')],Buffer.alloc(0));
  assert.equal(built.status,0,built.stdout.toString()+built.stderr.toString());
  const fixtureRuntime={backendPath:path.join(fixture,'Probe.exe'),nodePath:config.nodePath,sandboxPackageFamily:config.sandboxPackageFamily};
  fs.writeFileSync(path.join(fixture,'Resolve-Runtime.ps1'),"param([switch]$NeedNode)\n[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)\nWrite-Output @'\n"+JSON.stringify(fixtureRuntime)+"\n'@\n");
  const args=['exec','space value','','quote"value','中文参数','C:\\ending\\','app-server'];
  const input=Buffer.from(Array.from({length:131072},(_,i)=>i%256));
  const env={...process.env,ADAPTER_TEST_MARKER:'sentinel with 空格',CODEX_HOME:run,CODEX_WINDOWS_REGISTERED_CORE:'test-preserved-value'};
  sameOutput(command(fixtureRuntime.backendPath,args,input,env),command(path.join(fixture,'CodexPathAdapter.exe'),args,input,env));
  report.checks.argumentsUnicodeEmptyQuotesCwdEnvironmentBinaryStdioEOFAndExit=true;
  const denied=command(path.join(fixture,'CodexPathAdapter.exe'),['app-server','--stdio'],Buffer.from('{"id":7,"method":"configRequirements/read","params":{}}\n'),env);
  assert.equal(denied.status,23);
  assert.deepEqual(JSON.parse(denied.stdout.toString()),{id:7,error:{code:-32001,message:'POLICY_DENIED_TEST'}});
  report.checks.policyErrorNotSubstituted=true;

  // Keep a deleted-version snapshot while using the current production resolver.
  fs.copyFileSync(path.join(root,'Resolve-Runtime.ps1'),path.join(fixture,'Resolve-Runtime.ps1'));
  fs.writeFileSync(path.join(fixtureLocal,'startup.json'),JSON.stringify({...config,appPath:path.join(fixture,'deleted-version/ChatGPT.exe'),backendPath:path.join(fixture,'deleted-hash/codex.exe'),nodePath:path.join(fixture,'deleted-node/node.exe')}));
  sameOutput(command(config.backendPath,['--version'],Buffer.alloc(0)),command(path.join(fixture,'CodexPathAdapter.exe'),['--version'],Buffer.alloc(0)));
  report.checks.deletedOldAppCoreAndNodePathsIgnored=true;
  const direct=await policyRead(config.backendPath);
  const wrapped=await policyRead(path.join(fixture,'CodexPathAdapter.exe'));
  assert.deepEqual(wrapped,direct);
  report.checks.realDesktopPolicySequenceMatchesOriginal=true;
  report.policyEvidence={sequence:['initialize','initialized','configRequirements/read','config/read'],success:true,responseNotStored:true};
  report.files={};
  for(const name of ['CodexPathAdapter.exe','CodexPathAdapter.cs','Resolve-Runtime.ps1','desktop-entry.cjs','app-server-adapter.cjs','normalize.cjs']) {
    report.files[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
  }
  report.passed=true;
}
main().catch(error=>{report.error=error.message;console.error(error.stack);process.exitCode=1;}).finally(()=>{
  report.finishedUTC=new Date().toISOString();
  fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(local,'compatibility-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks,result:path.join(run,'result.json')}));
});
