import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
const dir=mkdtempSync(resolve('node_modules/.collector-network-'));
try {
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','src/lib/admin/collector.ts','--outDir',dir,'--module','commonjs','--target','es2020','--esModuleInterop','--resolveJsonModule','--skipLibCheck'],{stdio:'inherit'});
 test('collector rejects arbitrary destinations and reports HTTP, redirect, size and timeout failures without observations',()=>{
  const script=`
   const assert=require('node:assert/strict');const {checkSource}=require(${JSON.stringify(dir+'\\collector.js')});const catalog=require('./src/lib/admin/source-catalog.json');const source=catalog.find(s=>s.adapter==='berg');
   (async()=>{
    let calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})};
    await assert.rejects(checkSource('https://127.0.0.1/private'),e=>e.status===400);assert.equal(calls,0);
    let r=await checkSource(source.id);assert.equal(calls,1);assert.equal(r.observations.length,0);assert.match(r.error,/domen/);
    global.fetch=async()=>new Response('Forbidden',{status:403});r=await checkSource(source.id);assert.equal(r.observations.length,0);assert.match(r.error,/403/);
    global.fetch=async()=>new Response('x'.repeat(3000001));r=await checkSource(source.id);assert.equal(r.observations.length,0);assert.match(r.error,/3 MB/);
    global.fetch=async()=>{throw new DOMException('timeout','TimeoutError')};r=await checkSource(source.id);assert.equal(r.observations.length,0);assert.match(r.error,/10 sekund/);
    global.fetch=async()=>new Response(JSON.stringify({skiStationName:source.expected_station,runs:[{id:'1',name:'Trasa 1',state:'CLOSED'}]}));r=await checkSource(source.id);assert.equal(r.error,undefined);assert.equal(r.observations[0].status,'closed');assert.ok(r.observations[0].fetched_at);
    console.log('network safeguards passed');
   })().catch(e=>{console.error(e);process.exitCode=1;});`;
  const output=execFileSync(process.execPath,['--conditions=react-server','-e',script],{encoding:'utf8'});
  assert.match(output,/network safeguards passed/);
 });
} finally {process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));}
