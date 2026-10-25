import { mkdir, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import pg from 'pg';
import { loadRemediationPlan } from '../../../scripts/remediation-plan.mjs';
const runId='6da15bf60576d8a202839939';
if(process.argv.length!==2) throw new Error('No census arguments permitted');
const plan=await loadRemediationPlan(runId);
const directory=`evidence/remediation/browser-${runId}`;
await mkdir(directory,{recursive:true});
const file=`${directory}/census-${Date.now()}-${randomUUID()}.jsonl`;
const output=await open(file,'wx',0o600);
const emit=async value=>output.write(JSON.stringify(value)+'\n');
const client=new pg.Client({connectionString:plan.env.DATABASE_URL,application_name:'taky-runtime-census',connectionTimeoutMillis:5000,query_timeout:3000,options:'-c default_transaction_read_only=on -c statement_timeout=2000 -c lock_timeout=1000'});
try {
 await client.connect();
 const actual=(await client.query("SELECT current_database() AS database,current_user AS role,current_setting('transaction_read_only') AS read_only")).rows[0];
 if(actual?.database!==plan.database||actual.role!==plan.role||actual.read_only!=='on')throw new Error('Census identity mismatch');
 await emit({runId,attested:true,...actual});
 const began=Date.now();
 for(let sample=0;sample<90&&Date.now()-began<120000;sample++){
  const target=began+sample*1000;
  if(Date.now()<target)await new Promise(resolve=>setTimeout(resolve,target-Date.now()));
  const start=Date.now();
  const rows=(await client.query(`SELECT pid,client_port,backend_start,
   CASE WHEN state IN ('active','idle','idle in transaction','idle in transaction (aborted)','disabled') THEN state ELSE 'other' END AS state,
   CASE WHEN wait_event_type IN ('Activity','BufferPin','Client','Extension','IO','IPC','Lock','LWLock','Timeout') THEN wait_event_type ELSE 'other-or-none' END AS wait_type,
   CASE WHEN wait_event IN ('ClientRead','ClientWrite','transactionid','tuple','advisory','relation','virtualxid','DataFileRead','DataFileWrite','WALSync','WALWrite','BufferIO','ProcArray','LockManager','PgSleep','SyncRep') THEN wait_event ELSE 'other-or-none' END AS wait_event,
   round(greatest(0,extract(epoch FROM(clock_timestamp()-xact_start))*1000)) AS transaction_age_ms,
   pg_blocking_pids(pid) AS blockers,
   CASE WHEN position('pg_advisory_xact_lock_shared' in lower(query))>0 THEN 'ADVISORY_SHARED' WHEN position('pg_advisory_xact_lock' in lower(query))>0 THEN 'ADVISORY_EXCLUSIVE' WHEN query~*'^[[:space:]]*select' THEN 'SELECT' WHEN query~*'^[[:space:]]*insert' THEN 'INSERT' WHEN query~*'^[[:space:]]*update' THEN 'UPDATE' WHEN query~*'^[[:space:]]*delete' THEN 'DELETE' WHEN query~*'^[[:space:]]*(begin|start)' THEN 'BEGIN' WHEN query~*'^[[:space:]]*commit' THEN 'COMMIT' WHEN query~*'^[[:space:]]*rollback' THEN 'ROLLBACK' ELSE 'OTHER' END AS query_class
   FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() ORDER BY pid LIMIT 100`)).rows;
  await emit({sample,at:new Date().toISOString(),observer_lateness_ms:Math.max(0,start-target),query_wall_ms:Date.now()-start,actors:rows,host:{load:os.loadavg(),free_memory_bytes:os.freemem(),cpus:os.cpus().length}});
 }
 await emit({outcome:0});
}catch(error){await emit({outcome:1,code:typeof error?.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?error.code:'CENSUS_FAILED'});process.exitCode=1;}
finally{await client.end();await output.close();console.info(`Census evidence: ${file}`);}
