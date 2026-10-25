import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadRemediationPlan } from '../../../scripts/remediation-plan.mjs';
const runId='6da15bf60576d8a202839939';
if(process.argv.length!==2)throw new Error('No orchestration arguments permitted');
await loadRemediationPlan(runId);
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR||'/private/tmp',LANG:'en_US.UTF-8',CI:'1',NEXT_TELEMETRY_DISABLED:'1'};
const events=[];
const record=(event,extra={})=>events.push({event,at:new Date().toISOString(),...extra});
let observer,observerDone,seen='';
const browser=spawn(process.execPath,['scripts/run-remediation-browser.mjs','--prepared-run',runId,'--grep','expense persisted'],{cwd:process.cwd(),env,detached:true,stdio:['ignore','pipe','pipe']});
record('browser-started',{pid:browser.pid});
function inspect(chunk){
 const text=chunk.toString();process.stdout.write(text);seen=(seen+text).slice(-32768);
 if(!observer&&seen.includes(`Standalone server ready on http://127.0.0.1:3820; run ${runId}`)){
  observer=spawn(process.execPath,['.local/qa/runtime/census.mjs'],{cwd:process.cwd(),env,detached:true,stdio:['ignore','pipe','pipe']});
  record('observer-started-after-readiness',{pid:observer.pid});
  observer.stdout.on('data',value=>process.stdout.write(value));observer.stderr.on('data',()=>record('observer-stderr'));
  observerDone=new Promise(resolve=>{observer.once('error',()=>resolve({code:null,error:true}));observer.once('close',(code,signal)=>resolve({code,signal}));});
 }
}
browser.stdout.on('data',inspect);browser.stderr.on('data',inspect);
let timedOut=false;
const timeout=setTimeout(()=>{timedOut=true;record('orchestration-timeout');for(const child of [browser,observer])if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}},660000);
const result=await new Promise(resolve=>{browser.once('error',()=>resolve({code:null,error:true}));browser.once('close',(code,signal)=>resolve({code,signal}));});
record('browser-finished',result);
const observed=observerDone?await observerDone:{notStarted:true};record('observer-finished',observed);
clearTimeout(timeout);
const directory=`evidence/remediation/browser-${runId}`;await mkdir(directory,{recursive:true});
await writeFile(`${directory}/orchestration.json`,JSON.stringify({runId,timedOut,events},null,2)+'\n',{flag:'wx'});
process.exitCode=result.code===0&&!timedOut?0:1;
