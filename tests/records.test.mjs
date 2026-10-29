import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
const dir=mkdtempSync(resolve('node_modules/.records-tests-'));
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','src/lib/admin/records.ts','--outDir',dir,'--module','commonjs','--target','es2020','--esModuleInterop','--skipLibCheck'],{stdio:'inherit'});
test('resort confirmation is audited, handles timestamp-without-zone readback and preserves CAS protection',()=>{
 const script=`
 const assert=require('node:assert/strict');
 let current,patch,states=[],conflict=false;
 const clone=v=>JSON.parse(JSON.stringify(v));
 const db={from(table){let mode='read',payload,filters=[];const q={
 insert(p){mode='insert';payload=p;return q;},update(p){mode='update';payload=p;return q;},
 eq(k,v){if(table==='admin_audit'&&mode==='update'){states.push(payload.state);return Promise.resolve({error:null});}filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},
 select(){if(table==='resorts'&&mode==='update'){patch=clone(payload);if(conflict||filters.some(([k,v])=>JSON.stringify(current[k])!==JSON.stringify(v)))return Promise.resolve({data:[],error:null});current={...current,...payload};if(current.last_checked_at)current.last_checked_at=current.last_checked_at.replace(/Z$/,'');return Promise.resolve({data:[clone(current)],error:null});}return q;},
 async single(){return {data:table==='admin_audit'?{id:'audit'}:clone(current),error:null};}
 };return q;}};
 const serverPath=${JSON.stringify(resolve(dir,'admin/server.js'))};require.cache[serverPath]={id:serverPath,filename:serverPath,loaded:true,exports:{adminClient:()=>db,dbFailure:()=>{throw Error('database failure')}}};
 const {saveRecord,revision}=require(${JSON.stringify(resolve(dir,'admin/records.js'))});
 const reset=()=>{current={id:'resort-a',name:'Test',status:'otwarty',last_checked_at:'2026-01-01T00:00:00'};states=[];patch=null;conflict=false;};
 (async()=>{
 reset();let before=clone(current);let result=await saveRecord('resorts',revision('resorts',before),{status:'otwarty'},'test-user',true);assert.ok(patch.last_checked_at);assert.equal(result.record.status,'otwarty');assert.deepEqual(states,['verified']);assert.equal(current.name,'Test');
 reset();before=clone(current);await saveRecord('resorts',revision('resorts',before),{name:'New name'},'test-user');assert.equal(patch.last_checked_at,undefined);assert.equal(current.last_checked_at,before.last_checked_at);
 reset();before=clone(current);await saveRecord('resorts',revision('resorts',before),{status:'zamknięty'},'test-user');assert.ok(patch.last_checked_at);assert.equal(current.status,'zamknięty');assert.deepEqual(states,['verified']);
 reset();before=clone(current);conflict=true;await assert.rejects(saveRecord('resorts',revision('resorts',before),{status:'zamknięty'},'test-user',true),e=>e.status===409);assert.equal(current.status,'otwarty');assert.deepEqual(states,['conflict']);
 console.log('confirmation, readback and conflict safeguards passed');
 })().catch(e=>{console.error(e);process.exitCode=1;});`;
 const output=execFileSync(process.execPath,['--conditions=react-server','-e',script],{encoding:'utf8',env:{...process.env,ADMIN_REVISION_SECRET:'test-only-signing-key'}});
 assert.match(output,/confirmation, readback and conflict safeguards passed/);
});
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
