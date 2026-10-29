import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
const dir=mkdtempSync(resolve('node_modules/.admin-tests-'));
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','src/lib/admin/parsers.ts','src/lib/admin/matching.ts','--outDir',dir,'--module','commonjs','--target','es2020','--esModuleInterop','--skipLibCheck'],{stdio:'inherit'});
const require=createRequire(import.meta.url);
const {parseSource,numberFromName}=require(join(dir,'parsers.js'));
const {buildReport,score,freshness}=require(join(dir,'matching.js'));
const {changed}=require(join(dir,'validation.js'));
const source={id:'s',resort_id:'r',url:'https://example.org/status',adapter:'berg',expected_station:'Test'};
const observation=(overrides={})=>({source_id:'s:slope:1',source:'s',resort_id:'r',kind:'slope',name:'Trasa 1',number:'1',status:'closed',raw_status:'CLOSED',url:source.url,source_updated_at:null,...overrides});
const snapshot=(slopes=[{id:1,resort:'r',number:'1',name:'Test',status:'otwarta'}],lifts=[])=>({generated_at:'2026-10-29T10:00:00Z',resorts:[{id:'r',name:'Test',status:'zamknięty'},{id:'new',name:'Nowy ośrodek'}],slopes,lifts,sources:[source]});
const result=(observations,error)=>({source,fetched_at:'2026-10-29T10:00:00Z',observations,error});
test('Berg verifies station and preserves partial status/date',()=>{assert.throws(()=>parseSource(source,JSON.stringify({skiStationName:'Other'})));const rows=parseSource(source,JSON.stringify({skiStationName:'Test',runs:[{id:'a',name:'Trasa 1',state:'OPEN',partiallyOpen:true,lastUpdate:'2026-10-28T10:00:00Z'}]}));assert.equal(rows[0].status,'partial');assert.equal(rows[0].source_updated_at,'2026-10-28T10:00:00Z');});
test('Bialka missing active is unknown, zero means closed',()=>{const rows=parseSource({...source,adapter:'bialka'},JSON.stringify({a:{'object-type':'ski-run',content:{no:'1'}},b:{'object-type':'lift',live:{active:0},content:{title:'Kolej I - Test'}}}));assert.equal(rows[0].status,'unknown');assert.equal(rows[1].status,'closed');assert.equal(rows[1].number,'I');});
test('Holiday lift and slope codes differ; schedule is not current status',()=>{const content=JSON.stringify([{id:'1',name:'Test',status:'2'},{id:'2',name:'Later',status:'4'}]);assert.equal(parseSource({...source,adapter:'holiday',kind:'lift'},content)[0].status,'closed');assert.equal(parseSource({...source,adapter:'holiday',kind:'slope'},content)[0].status,'open');assert.equal(parseSource({...source,adapter:'holiday',kind:'lift'},content)[1].status,'unknown');});
test('HTML keeps two same-named routes separate and ignores tourist lift for resort status',()=>{const html='<table><tr><th></th><th>TRASY</th></tr><tr><td>2</td><td>NIEBIESKA</td><td>Zamknięta</td></tr><tr><td>3</td><td>NIEBIESKA</td><td>Otwarta</td></tr></table><table><tr><th>WYCIĄG</th></tr><tr><td>ZBYSZEK</td><td>Czynny</td></tr></table>';const rows=parseSource({...source,adapter:'tables'},html);assert.equal(rows.length,3);assert.notEqual(rows[0].source_id,rows[1].source_id);assert.equal(rows[2].kind,'lift');assert.equal(rows[2].status,'open');const s=snapshot();assert.equal(buildReport(s,[result(rows)]).resorts[0].status,'zamknięty');});
test('Letter lift code takes priority over an ordinal table column',()=>{const rows=parseSource({...source,adapter:'tables'},'<table><tr><th>LP</th><th>WYCIĄG</th><th>STATUS</th></tr><tr><td>1</td><td>H0</td><td>Nieczynny</td></tr></table>');assert.equal(rows[0].number,'H0');});
test('HTML rejects contradictory duplicate statuses',()=>{assert.throws(()=>parseSource({...source,adapter:'tables'},'<table><tr><th>TRASA</th></tr><tr><td>1</td><td>Czynny</td><td>Nieczynny</td></tr></table>'));});
test('Availability icon must belong to the status cell',()=>{const html='<table><tr><th>Nazwa</th><th>Dostępność</th><th>Czas wjazdu</th></tr><tr><td>Test</td><td><span class="availability-type--nie"></span></td><td><span class="availability-type--tak">12 min</span></td></tr></table>';assert.equal(parseSource({...source,adapter:'wierchomla'},html)[0].status,'closed');});
test('Ski Dolina desktop/mobile copies do not concatenate status text',()=>{const html='<div class="warObiekt"><div class="TopLeft">przenośnik taśmowy</div><div class="TopRight">nieczynny</div><div class="TopLeft">przenośnik taśmowy</div><div class="TopRight">nieczynny</div></div>';const rows=parseSource({...source,adapter:'skidolina'},html);assert.equal(rows.length,1);assert.equal(rows[0].name,'przenośnik taśmowy');assert.equal(rows[0].status,'closed');});
test('Route separators and ordinal lift numbers are not interchangeable identities',()=>{assert.equal(numberFromName('Trasa nr 4/1 ŁATWA'),'4/1');assert.equal(score({number:'41'},observation({number:'4/1'}),'slope'),0);assert.equal(score({number:'1',name:null},observation({kind:'lift',number:'1',name:'Kolej A'}),'lift'),0);});
test('Snapshot includes all DB objects and resorts before scanning, failed sources never close anything',()=>{const s=snapshot();const r=buildReport(s,[result([],'HTTP 403')]);assert.equal(r.resorts.length,2);assert.equal(r.objects.length,1);assert.equal(r.objects[0].db_status,'otwarta');assert.equal(r.objects[0].observed_status,'unknown');assert.equal(r.errors.length,1);assert.equal(changed(r.objects[0]),false);});
test('Conflicting independent sources, ambiguous source items and shared mapping are blocked',()=>{const a=observation(),b=observation({source_id:'b:slope:1',source:'b',status:'open'});assert.equal(buildReport(snapshot(),[result([a,b])]).objects[0].observed_status,'unknown');const duplicate=observation({source_id:'s:slope:2'});assert.equal(changed(buildReport(snapshot(),[result([a,duplicate])]).objects[0]),false);const s=snapshot([{id:1,resort:'r',number:'1',status:'otwarta'},{id:2,resort:'r',number:'1',status:'otwarta'}]);assert.ok(buildReport(s,[result([a])]).objects.every(r=>!changed(r)));});
test('Only unambiguous known changed status is eligible; unknown/partial not writable',()=>{assert.equal(changed(buildReport(snapshot(),[result([observation()])]).objects[0]),true);for(const status of ['unknown','partial'])assert.equal(changed(buildReport(snapshot(),[result([observation({status})])]).objects[0]),false);});
test('Unmatched source objects and timestamp uncertainty remain visible',()=>{const r=buildReport(snapshot(),[result([observation({number:'99',name:'Inna'})])]);assert.equal(r.unmatched_source_objects.length,1);assert.equal(freshness(null),'brak daty źródła');assert.equal(freshness('2020-01-01T10:00:00Z'),'starsze niż 72h');assert.equal(freshness('2026-10-29T10:00:00'),'nieznana strefa daty');});
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));


test('SkiResort full tables keep slope and lift status dictionaries separate',()=>{
 const html='<table class="sitour-table"><thead><tr><th>Nartostrady</th></tr></thead><tbody><tr><td><span class="status-2"></span></td><td>1a1</td><td>Ford</td><td>red</td><td>1600m</td></tr></tbody></table><table class="sitour-table"><thead><tr><th>Kolejki liniowe i wyciągi</th></tr></thead><tbody><tr><td><span class="status-2"></span></td><td>A2 <span class="type-4"></span>Protěž</td><td>1300 m</td></tr><tr><td><span class="status-9"></span></td><td>A3 Other</td><td>300 m</td></tr></tbody></table>';
 const rows=parseSource({...source,adapter:'skiresort'},html);assert.equal(rows.length,3);assert.equal(rows[0].status,'open');assert.equal(rows[1].status,'closed');assert.equal(rows[1].number,'A2');assert.equal(rows[1].length_m,1300);assert.equal(rows[2].status,'unknown');
});
test('Szczyrk reads status image in the status cell, not a timetable or biking content',()=>{
 const html='<p>Bike trasa 1 czynna</p><table id="lanovky_table"><tbody><tr><td class="stav"><img alt="Nieczynne"></td><td class="cislo">A1</td><td class="name">Gondola</td><td class="number">1434</td></tr></tbody></table>';
 const rows=parseSource({...source,adapter:'szczyrk-lifts'},html);assert.equal(rows.length,1);assert.equal(rows[0].kind,'lift');assert.equal(rows[0].status,'closed');assert.equal(rows[0].length_m,1434);
});
test('Zwardon closed icon overrides the static Czynny timetable label',()=>{
 const rows=parseSource({...source,adapter:'zwardon'},'<div><h2>Baby<br>Lift</h2><div>Czynny: 9-16</div><img src="/images/site/icons/ski-lift-close.png"></div>');assert.equal(rows[0].name,'Baby Lift');assert.equal(rows[0].status,'closed');
});
test('Zieleniec ignores hidden opposite statuses and does not invent a slope ordinal',()=>{
 const html='<div class="wyciagi-target"><h3>B1 Talerzyk</h3><div class="div-block-89"><div class="text-block">Test</div></div><div class="lift-status is-open w-condition-invisible">Otwarty</div><div class="lift-status is-closed">Zamknięty</div><div class="career7_title-wrapper is-wyciag"><div class="heading-style-h6">B1 Ośla łączka</div><div class="button-group-copy"><div class="tag w-condition-invisible">Czynna</div><div class="tag">Nieczynna</div></div></div></div>';
 const rows=parseSource({...source,adapter:'zieleniec'},html);assert.equal(rows.length,2);assert.ok(rows.every(row=>row.status==='closed'));assert.equal(rows[1].number,'');
});
test('Letter piste names provide codes without turning Trasa Biegowa into route B',()=>{assert.equal(numberFromName('Trasa A'),'A');assert.equal(numberFromName('Trasa Biegowa'),'');});
test('Length-only clues remain manual and duplicate lengths never become candidates',()=>{
 const db={id:1,resort:'r',number:'A',name:null,length_m:640,status:'otwarty'};const o=observation({kind:'lift',number:'',name:'Kolej krzesełkowa',length_m:640});
 const row=buildReport(snapshot([],[db]),[result([o])]).objects[0];assert.equal(row.candidates.length,1);assert.equal(row.observed_status,'unknown');assert.equal(changed(row),false);
 const duplicates=buildReport(snapshot([],[db,{...db,id:2,number:'B'}]),[result([o])]);assert.ok(duplicates.objects.every(row=>!row.candidates.length));
});
test('Lift type and descriptive prefixes separate similarly named surface and conveyor lifts',()=>{
 const db={name:'Zgorzelisko',type:'orczyk'};assert.ok(score(db,observation({kind:'lift',name:'Wyciąg orczykowy Zgorzelisko'}),'lift')>score(db,observation({kind:'lift',name:'Wyciąg taśmowy Zgorzelisko'}),'lift'));
 assert.ok(score({name:'Czarodziejska'},observation({name:'Czarodziejska Polana'}),'slope')>0);
});
