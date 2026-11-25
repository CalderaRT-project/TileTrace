const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const node=(id,shape,inputs=[])=>({id,name:id,op:'reshape',shape,inputs,status:'resolved',source:{start_line:1,start_col:0,end_line:1,end_col:10},attrs:{},dtype:null});
function setup(nodes,configure=()=>{}) {const messages=[];const dom=new JSDOM('<main id="app"></main>',{runScripts:'outside-only'});dom.window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState:()=>null,setState:()=>{}});configure(dom.window);dom.window.eval(fs.readFileSync(path.join(__dirname,'../media/operations.js'),'utf8'));dom.window.eval(fs.readFileSync(path.join(__dirname,'../media/viewer.js'),'utf8'));const send=data=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data}));send({type:'state',state:{analysis:{nodes,kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:nodes[nodes.length-1].id,stale:false,file:'a.py',version:1,parameters:{},input_shapes:{},program_ids:[]}});return {dom,messages,send};}
const inspectionResponse=(request,output,inspection)=>({type:'inspection',request_id:request.request_id,generation:request.generation,node_id:request.node_id,inspection:{node:output,...inspection}});
function setGridView(document,mode) {
 document.querySelector(`[data-grid-view="${mode}"]`).click();
}
function setupNormal(nodes,configure) {
 const fixture=setup(nodes,configure);
 setGridView(fixture.dom.window.document,'normal');
 return fixture;
}
function setNumber(input,value) {
 input.value=String(value);
 input.dispatchEvent(new input.ownerDocument.defaultView.Event('change'));
}

test('the grid switch sits above the cards and selects the simple view by default',()=>{
 for(const size of [1,2,3,4,5,6,8,9,10,16,32]) {
  const {dom,messages}=setup([node('x',[size])]);const document=dom.window.document;
  const switcher=document.querySelector('.grid-view');
  assert.equal(document.querySelector('.flow').previousElementSibling,switcher);
  assert.equal(document.querySelector('.panel-header .grid-view'),null);
  assert.equal(switcher.querySelector('[aria-pressed="true"]').textContent,'简约');
  const card=document.querySelector('[data-card-role="output"]');
  const indices=Array.from(card.querySelectorAll('.cell'),cell=>JSON.parse(cell.dataset.index));
  assert.deepEqual(indices,Array.from({length:Math.min(4,size)},(_,i)=>[i]),String(size));
  assert.equal(!!card.querySelector('input[aria-label="列起点"]'),size>4);
  assert.equal(document.querySelector('.pill').textContent,`[${size}]`);
  const compact=document.querySelector('.index-grid').outerHTML;const count=messages.length;
  setGridView(document,'normal');
  assert.equal(document.querySelector('.grid-view [aria-pressed="true"]').textContent,'普通');
  assert.equal(document.querySelectorAll('[data-output="true"]').length,size<=8?size:6);
  setGridView(document,'simple');
  assert.equal(document.querySelector('.index-grid').outerHTML,compact);assert.equal(messages.length,count);
 }
});

test('simple matrices open at 4 by 4 and the first output click requests an exact index',()=>{
 const input=node('in',[32,32]),out=node('out',[32,32],['in']);const {dom,messages,send}=setup([input,out]);const document=dom.window.document;
 const card=document.querySelector('[data-card-role="output"]');
 assert.equal(card.querySelectorAll('[data-index]').length,16);assert.equal(card.querySelector('.pill').textContent,'[32, 32]');
 assert.deepEqual(Array.from(card.querySelectorAll('thead th')).slice(1).map(th=>th.textContent),['0','1','2','3']);
 assert.deepEqual(Array.from(card.querySelectorAll('tbody tr > th')).map(th=>th.textContent),['0','1','2','3']);
 assert.equal(card.querySelector('[data-role="toggle-grid-window"]'),null);
 card.querySelector('[data-index="[3,2]"]').click();
 const request=messages.at(-1);assert.equal(request.type,'inspectIndex');assert.equal(JSON.stringify(request.index),'[3,2]');
 send(inspectionResponse(request,out,{status:'exact',output_index:[3,2],origins:[{node_id:'in',indices:[[3,2]],total:1,truncated:false}]}));
 assert.equal(document.querySelectorAll('[data-output="true"]').length,16);
 assert.ok(document.querySelector('[data-output="true"][data-index="[3,2]"].selected-cell'));
 assert.ok(document.querySelector('[data-card-role="input"] [data-index="[3,2]"].origin'));
 assert.match(document.querySelector('.mapping').textContent,/网格高亮 1 \/ 1/);
 setGridView(document,'simple');
 assert.ok(document.querySelector('[data-output="true"][data-index="[3,2]"].selected-cell'));
});

test('simple mode switch rejects pending ordinary inspections and preserves focus and reading position',()=>{
 const input=node('in',[16]),out=node('out',[16],['in']);const {dom,messages,send}=setupNormal([input,out]);const document=dom.window.document;const scroll=scrollModel(dom);
 document.querySelector('[data-output="true"][data-index="[15]"]').click();const old=messages.at(-1);
 const toggle=document.querySelector('[data-grid-view="simple"]');toggle.focus();scroll.set(0,420);toggle.click();
 assert.deepEqual(scroll.position(),[0,420]);assert.equal(document.activeElement.dataset.gridView,'simple');
 send(inspectionResponse(old,out,{status:'exact',output_index:[15],origins:[{node_id:'in',indices:[[15]],total:1,truncated:false}]}));
 assert.equal(document.querySelectorAll('.origin').length,0);assert.equal(document.querySelectorAll('.selected-cell').length,0);
});

test('normal and simple windows retain their own offsets while switching modes',()=>{
 const {dom}=setup([node('x',[16,32])]);const document=dom.window.document;
 setNumber(document.querySelector('input[aria-label="行起点"]'),4);
 setNumber(document.querySelector('input[aria-label="列起点"]'),24);
 const compact=document.querySelector('.index-grid').outerHTML;
 assert.ok(document.querySelector('[data-index="[7,27]"]'));
 setGridView(document,'normal');
 document.querySelector('[data-role="toggle-grid-window"]').click();
 setNumber(document.querySelector('input[data-axis="0"]'),12);
 setNumber(document.querySelector('input[data-axis="1"]'),8);
 const normal=document.querySelector('.index-grid').outerHTML;
 assert.ok(document.querySelector('[data-index="[12,8]"]'));assert.ok(document.querySelector('[data-index="[15,11]"]'));
 setGridView(document,'simple');assert.equal(document.querySelector('.index-grid').outerHTML,compact);
 setGridView(document,'normal');assert.equal(document.querySelector('.index-grid').outerHTML,normal);
});

test('jumping to a far edge origin keeps a full simple window',()=>{
 const input=node('in',[32,32]),out=node('out',[32,32],['in']);const {dom,messages,send}=setup([input,out]);const document=dom.window.document;
 document.querySelector('[data-output="true"]').click();
 send(inspectionResponse(messages.at(-1),out,{status:'exact',output_index:[0,0],origins:[{node_id:'in',indices:[[31,31]],total:1,truncated:false}]}));
 assert.match(document.querySelector('.mapping').textContent,/网格高亮 0 \/ 1/);
 document.querySelector('[data-origin-target="in"]').click();
 const card=document.querySelector('[data-card-role="input"]');
 assert.equal(card.querySelectorAll('[data-index]').length,16);
 for(const offset of card.querySelectorAll('input[type="number"]'))assert.equal(offset.value,'28');
 assert.ok(card.querySelector('[data-index="[31,31]"].origin'));
 assert.ok(document.querySelector('[data-output="true"][data-index="[0,0]"].selected-cell'));
 assert.match(document.querySelector('.mapping').textContent,/网格高亮 1 \/ 1/);
});

test('simple mode respects short axes, prefix slices and large dimensions',()=>{
 const mixed=setup([node('x',[10,3])]);const mixedDocument=mixed.dom.window.document;
 assert.equal(mixedDocument.querySelectorAll('[data-index]').length,12);assert.ok(mixedDocument.querySelector('[data-index="[3,2]"]'));
 assert.equal(mixedDocument.querySelector('input[aria-label="列起点"]'),null);
 const {dom,messages}=setup([node('x',[2,16,32])]);const document=dom.window.document;
 for(const [axis,start] of [[0,1],[1,4],[2,8]])setNumber(document.querySelector(`input[data-axis="${axis}"]`),start);
 document.querySelector('[data-output="true"][data-index="[1,7,11]"]').click();assert.equal(JSON.stringify(messages.at(-1).index),'[1,7,11]');
 const huge=setup([node('x',[1000000,1000000])]);const hugeDocument=huge.dom.window.document;
 for(const axis of [0,1])setNumber(hugeDocument.querySelector(`input[data-axis="${axis}"]`),999996);
 assert.equal(hugeDocument.querySelectorAll('.cell').length,16);
 assert.ok(hugeDocument.querySelector('[data-index="[999999,999999]"]'));
});

test('inspection replies preserve focus and offset on the correct input window',()=>{
 const a=node('a',[16]),b=node('b',[16]),out=node('out',[16],['a','b']);const {dom,messages,send}=setup([a,b,out]);const document=dom.window.document;
 document.querySelector('[data-output="true"][data-index="[0]"]').click();
 const request=messages.at(-1);const offset=document.querySelector('[data-card-node="b"] input[aria-label="列起点"]');offset.focus();setNumber(offset,8);
 send(inspectionResponse(request,out,{status:'exact',output_index:[0],origins:[{node_id:'a',indices:[[0]],total:1,truncated:false},{node_id:'b',indices:[[8]],total:1,truncated:false}]}));
 assert.equal(document.activeElement.closest('[data-card-node]').dataset.cardNode,'b');
 assert.equal(document.activeElement.getAttribute('aria-label'),'列起点');assert.equal(document.activeElement.value,'8');
 assert.ok(document.querySelector('[data-card-node="b"] [data-index="[8]"].origin'));
});

test('ResizeObserver observes current content only and handles loading without altering selection',()=>{
 let available=600,notify,observed=[];const nodes=[node('in',[8]),node('out',[8],['in'])];
 const {dom,send}=setupNormal(nodes,window=>{
  window.ResizeObserver=class {constructor(callback){notify=callback;}observe(element){observed.push(element);}disconnect(){observed=[];}};
  window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:this.classList.contains('flow')?available:this.classList.contains('flow-inputs')||this.classList.contains('flow-output')?200:0,height:100,x:0,y:0};};
 });
 const document=dom.window.document;assert.equal(document.querySelector('.flow').dataset.layout,'horizontal');assert.equal(observed.length,3);
 const oldFlow=document.querySelector('.flow');const state={analysis:{nodes,kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'out',stale:false,file:'a.py',version:1,parameters:{},input_shapes:{},program_ids:[]};
 send({type:'state',state});assert.ok(observed.every(element=>element.isConnected));assert.notEqual(document.querySelector('.flow'),oldFlow);
 const cell=document.querySelector('[data-output="true"][data-index="[7]"]');cell.click();const current=document.querySelector('[data-output="true"][data-index="[7]"]');
 available=350;notify();assert.equal(document.querySelector('.flow').dataset.layout,'vertical');assert.equal(document.querySelector('.selected-cell'),current);
 send({type:'state',state:{...state,stale:true,version:2}});notify();assert.equal(document.querySelector('.flow'),null);assert.deepEqual(observed,[document.getElementById('app')]);
});

test('flow fits actual widths and aligns grid headers without replacing the selected cell',()=>{
 const {dom,messages}=setupNormal([node('in',[16,1]),node('out',[16,1],['in'])]);const document=dom.window.document;
 let available=510,inputWidth=180,outputWidth=180,inputHeaderHeight=135;
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
  const width=this.classList.contains('flow')?available:this.classList.contains('flow-inputs')?inputWidth:this.classList.contains('flow-output')?outputWidth:0;
  const height=this.matches('[data-card-role="input"] .slice-controls')?inputHeaderHeight:100;
  return {width,height,x:0,y:0};
 };
 const cell=document.querySelector('[data-output="true"][data-index="[15,0]"]');cell.click();const request=messages.at(-1);const selected=document.querySelector('[data-output="true"][data-index="[15,0]"]');
 const resize=()=>dom.window.dispatchEvent(new dom.window.Event('resize'));
 resize();assert.equal(document.querySelector('.flow').dataset.layout,'horizontal');
 const gridOffsets=()=>Array.from(document.querySelectorAll('.grid-scroll'),grid=>grid.style.getPropertyValue('--grid-offset'));
 assert.deepEqual(gridOffsets(),['35px','0px']);
 available=350;resize();assert.equal(document.querySelector('.flow').dataset.layout,'vertical');
 available=800;outputWidth=420;inputHeaderHeight=80;resize();assert.equal(document.querySelector('.flow').dataset.layout,'horizontal');
 assert.deepEqual(gridOffsets(),['0px','20px']);
 available=600;resize();assert.equal(document.querySelector('.flow').dataset.layout,'vertical');
 assert.equal(document.querySelector('[data-output="true"][data-index="[15,0]"]'),selected);
 assert.ok(selected.classList.contains('selected-cell'));assert.equal(messages.at(-1),request);
});

test('flow keeps the selectable output first and coordinate details below the grids',()=>{
 const input=node('in',[8]),output=node('out',[2,4],['in']);
 const {dom,messages,send}=setup([input,output]);const document=dom.window.document;
 const flow=document.querySelector('.flow');
 assert.ok(flow.firstElementChild.classList.contains('flow-output'));
 assert.equal(flow.querySelector('.mapping'),null);
 assert.ok(flow.nextElementSibling.classList.contains('mapping-panel'));
 assert.match(flow.getAttribute('aria-label'),/输入.*reshape.*输出/);
 assert.equal(document.querySelector('.operation-meta .operator').textContent,'reshape');
 const cell=flow.querySelector('[data-output="true"][data-index="[1,2]"]');
 assert.ok(cell.classList.contains('matrix-cell'));assert.match(cell.getAttribute('aria-label'),/\[1, 2\]/);
 cell.click();
 send(inspectionResponse(messages.at(-1),output,{status:'exact',output_index:[1,2],origins:[{node_id:'in',indices:[[6]],total:1,truncated:false}]}));
 assert.equal(document.querySelector('[data-output="true"][data-index="[1,2]"]').getAttribute('aria-pressed'),'true');
 assert.match(document.querySelector('.mapping-panel .mapping').textContent,/输出 \[1, 2\].*in.*\[6\]/);
});

test('tensor cards keep one metadata line and move directions and counts to tooltips',()=>{
 const rows=node('rows',[16]);const expanded=node('expanded',[16,1],['rows']);expanded.op='expand_dims';expanded.attrs={mapping:'expand_dims',axes:[1]};
 const {dom,messages}=setupNormal([rows,expanded]);const document=dom.window.document;
 for(const card of document.querySelectorAll('.tensor-card')) {
  assert.equal(card.querySelectorAll(':scope > p').length,1);
  assert.doesNotMatch(card.textContent,/一维索引|长度超过|每卡最多|显示.*总计|当前切片包含/);
  assert.match(card.querySelector('.pill').title,/16/);assert.match(card.querySelector('.grid-scroll').title,/显示 6.*总计 16/);
  assert.match(card.querySelector('table').getAttribute('aria-label'),/显示 6.*总计 16/);
  assert.ok(card.querySelector('[data-role="toggle-grid-window"]'));
 }
 assert.match(document.querySelector('[data-card-role="input"] .pill').title,/行轴/);
 document.querySelector('[data-output="true"][data-index="[15,0]"]').click();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).index)),[15,0]);
});

test('long vectors show head and tail with an accessible ellipsis and exact tail coordinates',()=>{
 for(const size of [8,9,16,1000000]) {
  const v=node('v',[size]);const {dom,messages}=setupNormal([v]);const card=dom.window.document.querySelector('[data-card-role="output"]');
  const indices=Array.from(card.querySelectorAll('[data-index]'),c=>JSON.parse(c.dataset.index)[0]);
  assert.deepEqual(indices,size<=8?Array.from({length:size},(_,i)=>i):[0,1,2,size-3,size-2,size-1]);
  assert.equal(card.querySelectorAll('.axis-ellipsis').length,size<=8?0:1);
  assert.equal(card.querySelector('.pill').textContent,`[${size}]`);
  if(size>8){const gap=card.querySelector('.axis-ellipsis');assert.match(gap.getAttribute('aria-label'),/3.*省略/);card.querySelector(`[data-index="[${size-1}]"]`).click();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).index)),[size-1]);}
 }
});

test('matrix overview folds both axes and expanding a gap reveals actual middle coordinates',()=>{
 const {dom,messages}=setupNormal([node('x',[16,32])]);const document=dom.window.document;
 let card=document.querySelector('[data-card-role="output"]');
 assert.equal(card.querySelectorAll('[data-index]').length,36);assert.ok(card.querySelector('[data-index="[15,31]"]'));assert.equal(card.querySelector('[data-index="[7,7]"]'),null);
 const gap=card.querySelector('.axis-ellipsis[data-axis="0"]');gap.focus();gap.click();
 assert.equal(document.activeElement.dataset.role,'toggle-grid-window');
 card=document.querySelector('[data-card-role="output"]');assert.ok(card.querySelector('[data-index="[3,0]"]'));assert.equal(card.querySelectorAll('.axis-ellipsis').length,0);assert.ok(card.querySelectorAll('[data-index]').length<=128);
 const col=card.querySelector('input[data-axis="1"]');col.value='5';col.dispatchEvent(new dom.window.Event('change'));
 document.querySelector('[data-output="true"][data-index="[3,5]"]').click();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).index)),[3,5]);
 document.querySelector('[data-card-role="output"] [data-role="toggle-grid-window"]').click();
 assert.ok(document.querySelector('[data-output="true"][data-index="[15,31]"]'));assert.equal(document.querySelectorAll('[data-card-role="output"] .axis-ellipsis').length,8);
});

test('collapsed input origins count only visible head/tail cells and can reveal omitted sources',()=>{
 const {dom,messages,send}=setupNormal([node('in',[16]),node('out',[1],['in'])]);const document=dom.window.document;
 document.querySelector('[data-output="true"]').click();
 send(inspectionResponse(messages.at(-1),node('out',[1],['in']),{status:'exact',output_index:[0],origins:[{node_id:'in',indices:[[7]],total:1,truncated:false}]}));
 assert.equal(document.querySelectorAll('.origin').length,0);assert.match(document.querySelector('.mapping').textContent,/高亮 0 \/ 1/);
 document.querySelector('[data-origin-target="in"]').click();assert.ok(document.querySelector('[data-node="in"][data-index="[7]"].origin'));assert.match(document.querySelector('.mapping').textContent,/高亮 1 \/ 1/);
});

test('origin text abbreviates returned coordinates without inventing an unenumerated tail',()=>{
 const {dom,messages,send}=setup([node('in',[1000000]),node('out',[1],['in'])]);const document=dom.window.document;
 document.querySelector('[data-output="true"]').click();
 send(inspectionResponse(messages.at(-1),node('out',[1],['in']),{status:'exact',output_index:[0],origins:[{node_id:'in',indices:Array.from({length:16},(_,i)=>[i]),total:1000000,truncated:true}]}));
 const text=document.querySelector('.coordinates').textContent;assert.equal(text,'[0] · [1] · [2] · … · [13] · [14] · [15]');assert.doesNotMatch(text,/999999/);
 assert.match(document.querySelector('.mapping').textContent,/来源枚举已截断/);assert.match(document.querySelector('.mapping').textContent,/返回坐标的首尾/);
 assert.equal(document.querySelector('.origin-summary code').textContent,'[0] … [15]');
});

test('expanding and collapsing keeps page position and toggle focus',()=>{
 const {dom}=setupNormal([node('out',[16])]);const document=dom.window.document;const scroll=scrollModel(dom);let toggle=document.querySelector('[data-role="toggle-grid-window"]');
 toggle.focus();scroll.set(0,420);toggle.click();
 assert.deepEqual(scroll.position(),[0,420]);assert.equal(document.activeElement.dataset.role,'toggle-grid-window');assert.equal(document.querySelectorAll('[data-output="true"]').length,16);
 toggle=document.activeElement;toggle.click();assert.deepEqual(scroll.position(),[0,420]);assert.equal(document.activeElement.dataset.role,'toggle-grid-window');assert.equal(document.querySelectorAll('[data-output="true"]').length,6);
});

test('one-dimensional row indices follow new-axis use without changing coordinate rank',()=>{
 const rows=node('rows',[16]);const expanded=node('expanded',[16,1],['rows']);expanded.op='expand_dims';expanded.attrs={mapping:'expand_dims',axes:[1]};
 const {dom,messages,send}=setupNormal([rows,expanded]);const document=dom.window.document;
 assert.equal(document.querySelector('[data-card-role="output"] tbody').rows.length,7);
 send({type:'state',state:{analysis:{nodes:[rows,expanded],kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'rows',stale:false,file:'a.py',version:1,parameters:{},input_shapes:{},program_ids:[]}});
 const card=document.querySelector('[data-card-role="output"]');
 assert.equal(card.querySelectorAll('tbody tr').length,7);
 assert.equal(card.querySelectorAll('tbody tr:first-child td').length,1);
 assert.equal(card.querySelector('.pill').textContent,'[16]');
 assert.match(card.querySelector('.pill').title,/行轴/);
 card.querySelector('[data-index="[15]"]').click();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).index)),[15]);
});

test('vector direction follows uses and selected transform, never variable names',()=>{
 const vector=node('query_rows',[16]);const rowUse=node('r',[16,1],['query_rows']);rowUse.op='expand_dims';rowUse.attrs={mapping:'expand_dims',axes:[1]};
 const colUse=node('c',[1,16],['query_rows']);colUse.op='expand_dims';colUse.attrs={mapping:'expand_dims',axes:[0]};
 const {dom,send}=setupNormal([vector,rowUse,colUse]);const document=dom.window.document;
 const select=id=>send({type:'state',state:{analysis:{nodes:[vector,rowUse,colUse],kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:id,stale:false,file:'a.py',version:1,parameters:{},input_shapes:{},program_ids:[]}});
 select('query_rows');assert.match(document.querySelector('[data-card-role="output"] .pill').title,/未指定行列方向/);
 select('r');assert.equal(document.querySelector('[data-card-role="input"] tbody').rows.length,7);
 select('c');assert.equal(document.querySelector('[data-card-role="input"] tbody').rows.length,1);
 const unused=setup([node('query_rows',[16])]);assert.match(unused.dom.window.document.querySelector('[data-card-role="output"] .pill').title,/未指定行列方向/);
});

test('vertical vector origins and windows preserve the same logical index across directions',()=>{
 const vector=node('v',[64]);const r=node('r',[64,1],['v']);r.op='expand_dims';r.attrs={mapping:'expand_dims',axes:[1]};
 const c=node('c',[1,64],['v']);c.op='expand_dims';c.attrs={mapping:'expand_dims',axes:[0]};
 const {dom,send,messages}=setupNormal([vector,c,r]);const document=dom.window.document;
 document.querySelector('[data-output="true"][data-index="[0,0]"]').click();
 send(inspectionResponse(messages.at(-1),r,{status:'exact',output_index:[0,0],origins:[{node_id:'v',indices:[[47]],total:1,truncated:false}]}));
 document.querySelector('[data-origin-target="v"]').click();
 let card=document.querySelector('[data-card-role="input"]');assert.ok(card.querySelector('[data-index="[47]"].origin'));assert.equal(card.querySelector('input[data-axis="0"]').value,'47');
 const start=card.querySelector('input[data-axis="0"]');start.value='32';start.dispatchEvent(new dom.window.Event('change'));
 card=document.querySelector('[data-card-role="input"]');assert.equal(card.querySelector('tbody tr').firstChild.textContent,'32');assert.ok(card.querySelector('[data-index="[47]"].origin'));
 assert.match(document.querySelector('.mapping').textContent,/当前网格高亮 1 \/ 1/);
 send({type:'state',state:{analysis:{nodes:[vector,c,r],kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'c',stale:false,file:'a.py',version:1,parameters:{},input_shapes:{},program_ids:[]}});
 card=document.querySelector('[data-card-role="input"]');assert.equal(card.querySelector('tbody').rows.length,1);assert.equal(card.querySelector('input[data-axis="0"]').value,'32');assert.ok(card.querySelector('[data-index="[32]"]'));
});
function scrollModel(dom,clampLoading=false) {
 let x=0,y=0;
 Object.defineProperties(dom.window,{scrollX:{configurable:true,get:()=>x},scrollY:{configurable:true,get:()=>y}});
 dom.window.scrollTo=(left,top)=>{x=left;y=clampLoading&&!dom.window.document.querySelector('[data-output="true"]')?0:top;};
 const root=dom.window.document.getElementById('app');const replace=root.replaceChildren.bind(root);
 root.replaceChildren=(...children)=>{x=0;y=0;replace(...children);};
 return {set:(left,top)=>{x=left;y=top;},position:()=>[x,y]};
}

test('FlashAttention shows both KV iterations and dot origins as a row and column',()=>{
 const {spawnSync}=require('node:child_process');const root=path.resolve(__dirname,'../..');
 const venv=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const code='import sys,json; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from tiletrace import analyze,inspect_transform; a=analyze(Path(sys.argv[2]).read_text(encoding="utf-8")); n=[n for n in a["nodes"] if n["op"]=="dot"][2]; print(json.dumps({"analysis":a,"node":n,"inspection":inspect_transform(a,n["id"],[0,1])}))';
 const result=spawnSync(fs.existsSync(venv)?venv:'python',['-I','-S','-c',code,root,path.join(root,'examples/flash_attention.py')],{encoding:'utf8',cwd:root,windowsHide:true,timeout:10000});
 assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);
 const {dom,send,messages}=setupNormal(data.analysis.nodes);
 const select=(id,program_ids=[])=>send({type:'state',state:{analysis:data.analysis,selected:id,stale:false,file:'attention.py',version:1,parameters:{},input_shapes:{},program_ids}});
 select(data.analysis.nodes.find(n=>n.name==='query_rows').id);
 assert.equal(dom.window.document.querySelector('[data-card-role="output"] tbody').rows.length,7);
 select(data.analysis.nodes.find(n=>n.name==='head_cols').id);
 assert.equal(dom.window.document.querySelector('[data-card-role="output"] tbody').rows.length,1);
 select(data.analysis.nodes.find(n=>n.name==='q').id);
 assert.match(dom.window.document.querySelector('[data-card-role="output"] .pill').title,/16 行 × 32 列/);
 select(data.node.id);
 const document=dom.window.document;const groups=Array.from(document.querySelectorAll('.step-group'));
 for(const offset of [0,32]){
  const group=groups.find(item=>item.querySelector('.step-group-label').textContent===`start_n=${offset}`);
  assert.ok(group?.querySelector('button[aria-label*="dot"]'),`dot in start_n=${offset}`);
 }
 assert.match(document.body.textContent,/矩阵乘法归约长度/);
 document.querySelector('[data-output="true"][data-index="[0,1]"]').click();
 send(inspectionResponse(messages.at(-1),data.node,data.inspection));
 // The overview shows six head/tail coordinates per axis; origins retain 32.
 assert.equal(document.querySelectorAll('[data-node="'+data.node.inputs[0]+'"].origin').length,6);
 assert.equal(document.querySelectorAll('[data-node="'+data.node.inputs[1]+'"].origin').length,6);
 assert.equal(data.inspection.origins[0].total,32);
 assert.equal(data.inspection.origins[1].total,32);
 assert.deepEqual(Array.from(document.querySelectorAll('.origin-summary code'),item=>item.textContent),['[0, :]','[:, 1]']);

 const [q,,,,v]=data.analysis.read_blocks;
 select(q.axes[0].arange_node);
 assert.match(document.querySelector('.block-header').textContent,/示例 program \[0\]/);
 select(q.axes[0].arange_node,[1]);
 assert.match(document.querySelector('.block-diagram').getAttribute('aria-label'),/Q 当前读取块.*行 \[16, 32\)/);
 assert.match(document.querySelector('.block-ranges').textContent,/16 × program_id\(0\).*掩码 < 64/);
 assert.equal(document.querySelector('.block-highlight').style.top,'25%');
 document.querySelector('[data-output="true"][data-index="[2]"]').click();
 assert.equal(document.querySelector('.mapping-panel .block-coordinate').textContent,'块内 [2] → Q 行 18');
 select(v.node_id,[1]);
 assert.match(document.querySelector('.block-header').textContent,/V · start_n=32/);
 assert.match(document.querySelector('.block-diagram').getAttribute('aria-label'),/行 \[32, 64\)/);
 select(q.axes[1].arange_node);
 const access=document.querySelector('.block-access');
 access.focus();access.value=v.node_id;access.dispatchEvent(new dom.window.Event('change'));
 assert.equal(document.activeElement.value,v.node_id);
 assert.equal(document.querySelector('.block-highlight').style.top,'50%');
});

test('the compact step list follows a newly selected step without moving the page',()=>{
 const nodes=Array.from({length:10},(_,index)=>node(`n${index}`,[2,4]));
 const {dom,send}=setup(nodes,window=>{
  Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get(){
   return this.matches('.operation-list')&&this.closest('.step-navigation').dataset.expanded==='true'?60:0;
  }});
  window.HTMLElement.prototype.getBoundingClientRect=function(){
   if(this.matches('.operation')){
    const list=this.closest('.operation-list');
    const top=100+Number(this.dataset.node.slice(1))*20-list.scrollTop;
    return {top,bottom:top+20,width:100};
   }
   return {top:100,bottom:160,width:this.matches('.flow')?500:100};
  };
 });
 const document=dom.window.document;const scroll=scrollModel(dom);scroll.set(0,320);
 assert.equal(document.querySelector('.steps-toggle').getAttribute('aria-expanded'),'false');
 document.querySelector('.steps-toggle').click();
 assert.equal(document.querySelector('.operation-list').scrollTop,140);
 document.querySelector('.operation-list').scrollTop=0;
 const state={analysis:{nodes,kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'n7',stale:false,file:'a.py',version:1};
 send({type:'state',state});
 assert.equal(document.querySelector('.steps-toggle').getAttribute('aria-expanded'),'true');
 assert.equal(document.querySelector('.operation-list').scrollTop,100);
 document.querySelector('.operation-list').scrollTop=40;
 send({type:'state',state});
 assert.equal(document.querySelector('.operation-list').scrollTop,40);
 assert.deepEqual(scroll.position(),[0,320]);
});

test('the header uses the file name and keeps actionable diagnostics above the workbench',()=>{
 const out=node('out',[2,4]);const {dom,send}=setup([out]);const document=dom.window.document;
 const file='C:\\project\\kernel.py';
 send({type:'state',state:{file,selected:'out',stale:false,analysis:{nodes:[out],kernels:['k'],kernel:'k',
  diagnostics:[{severity:'info',message:'Routine note'},{severity:'error',message:'Shape conflict'}],
  missing_parameters:['BLOCK']}}});
 assert.equal(document.querySelector('h1').textContent,'kernel.py');
 assert.equal(document.querySelector('h1').title,file);
 assert.equal(document.querySelector('.panel-header select'),null);
 assert.equal(document.querySelector('.analysis-notice').nextElementSibling.className,'error');
 assert.equal(document.querySelector('.error').nextElementSibling.className,'workspace');
 assert.equal(document.querySelector('.diagnostics').open,false);
 assert.match(document.querySelector('.diagnostics').textContent,/Routine note/);
 document.querySelector('.parameters').open=false;
 document.querySelector('.analysis-notice button').click();
 assert.equal(document.querySelector('.parameters').open,true);
 assert.equal(document.activeElement,document.querySelector('.parameters textarea'));
});

test('output clicks and matching replies keep page/list/grid scroll, expanded parameters and focus',()=>{
 const inputs=[node('in',[8]),node('out',[2,4],['in'])];const {dom,messages,send}=setup(inputs);const document=dom.window.document;const scroll=scrollModel(dom);
 document.querySelector('.parameters').open=true;document.querySelector('.operation-list').scrollTop=80;document.querySelector('.expression').scrollTop=12;
 document.querySelector('[data-card-node="in"] .grid-scroll').scrollLeft=65;document.querySelector('[data-card-node="out"] .grid-scroll').scrollLeft=35;
 const cell=document.querySelector('[data-output="true"][data-index="[1,2]"]');cell.focus();scroll.set(7,620);cell.click();
 const check=()=>{assert.deepEqual(scroll.position(),[7,620]);assert.equal(document.querySelector('.parameters').open,true);assert.equal(document.querySelector('.operation-list').scrollTop,80);assert.equal(document.querySelector('.expression').scrollTop,12);assert.equal(document.querySelector('[data-card-node="in"] .grid-scroll').scrollLeft,65);assert.equal(document.querySelector('[data-card-node="out"] .grid-scroll').scrollLeft,35);assert.equal(document.activeElement.dataset.index,'[1,2]');};
 check();send(inspectionResponse(messages.at(-1),inputs[1],{status:'exact',output_index:[1,2],origins:[{node_id:'in',indices:[[6]],total:1,truncated:false}]}));check();
});

test('parameter caret/size/scroll and manual collapsed state survive background updates',()=>{
 const nodes=[node('out',[2,4])];const {dom,send}=setup(nodes);const document=dom.window.document;const scroll=scrollModel(dom);
 document.querySelector('.parameters').open=true;const textarea=document.querySelector('textarea');textarea.value='{"BLOCK":8}';textarea.dispatchEvent(new dom.window.Event('input'));textarea.style.height='96px';textarea.scrollTop=14;textarea.focus();textarea.setSelectionRange(4,8);scroll.set(0,200);
 const state={analysis:{nodes,kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'out',stale:false,file:'a.py',version:1,parameters:{},input_shapes:{},program_ids:[]};
 send({type:'state',state});assert.deepEqual(scroll.position(),[0,200]);const restored=document.querySelector('textarea');assert.equal(document.activeElement,restored);assert.equal(restored.selectionStart,4);assert.equal(restored.selectionEnd,8);assert.equal(restored.scrollTop,14);assert.equal(restored.style.height,'96px');
 document.querySelector('.parameters').open=false;send({type:'state',state});assert.equal(document.querySelector('.parameters').open,false);
});

test('a worker launch failure ends the waiting prompt until a new analysis begins',()=>{
 const {dom,send}=setup([node('out',[2])]);
 const document=dom.window.document;
 const loading={stale:true,file:'a.py',version:2,generation:2};
 const error='找不到可用的 Python 3.10 或更高版本。';
 send({type:'state',state:{...loading,error}});
 assert.equal(document.querySelector('.status').textContent,'分析不可用');
 assert.equal(document.querySelector('.error').textContent,error);
 assert.equal(document.querySelector('.notice'),null);
 send({type:'state',state:{...loading,generation:3}});
 assert.equal(document.querySelector('.status').textContent,'等待分析');
 assert.match(document.querySelector('.notice').textContent,/等待当前版本分析完成/);
});

test('temporary stale layout cannot overwrite saved viewport and a different file starts at top',()=>{
 const nodes=[node('out',[2,4])];const {dom,send}=setup(nodes);const document=dom.window.document;const scroll=scrollModel(dom,true);scroll.set(0,620);document.querySelector('.operation-list').scrollTop=80;document.querySelector('.parameters').open=true;
 const analysis={nodes,kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]};
 send({type:'state',state:{stale:true,file:'a.py',version:2,generation:2,parameters:{},input_shapes:{},program_ids:[]}});assert.equal(scroll.position()[1],0);
 send({type:'state',state:{analysis,selected:'out',stale:false,file:'a.py',version:2,generation:2,parameters:{},input_shapes:{},program_ids:[]}});assert.equal(scroll.position()[1],620);assert.equal(document.querySelector('.operation-list').scrollTop,80);assert.equal(document.querySelector('.parameters').open,true);
 send({type:'state',state:{analysis,selected:'out',stale:false,file:'b.py',version:1,generation:3,parameters:{},input_shapes:{},program_ids:[]}});assert.equal(scroll.position()[1],0);assert.equal(document.querySelector('.operation-list').scrollTop,0);assert.equal(document.querySelector('.parameters').open,false);
});

test('automatically restored surviving focus must not turn loading clamp into the saved viewport',()=>{
 for(const control of ['textarea','apply']) {
  const nodes=[node('out',[2,4])];const {dom,send}=setup(nodes);const document=dom.window.document;const scroll=scrollModel(dom,true);
  document.querySelector('.parameters').open=true;
  const focused=control==='textarea'?document.querySelector('textarea'):Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='应用参数并重新分析');focused.focus();scroll.set(0,200);
  const fields={file:'a.py',version:2,generation:2,parameters:{},input_shapes:{},program_ids:[]};
  send({type:'state',state:{...fields,stale:true}});assert.equal(scroll.position()[1],0);assert.notEqual(document.activeElement,document.body);
  send({type:'state',state:{...fields,stale:false,analysis:{nodes,kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'out'}});
  assert.equal(scroll.position()[1],200,control);
 }
});

test('intentional parameter input during loading keeps the new position and caret',()=>{
 const nodes=[node('out',[2,4])];const {dom,send}=setup(nodes);const document=dom.window.document;const scroll=scrollModel(dom,true);scroll.set(0,620);
 const fields={file:'a.py',version:2,generation:2,parameters:{},input_shapes:{},program_ids:[]};
 send({type:'state',state:{...fields,stale:true}});
 const textarea=document.querySelector('textarea');textarea.focus();textarea.value='{"BLOCK":16}';textarea.setSelectionRange(3,7);textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 send({type:'state',state:{...fields,stale:false,analysis:{nodes,kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'out'}});
 assert.equal(scroll.position()[1],0);assert.equal(document.activeElement,document.querySelector('textarea'));assert.equal(document.activeElement.selectionStart,3);assert.equal(document.activeElement.selectionEnd,7);
});
test('output click requests exact index and highlights immediate input origin',()=>{const {dom,messages,send}=setup([node('in',[8]),node('out',[2,4],['in'])]);dom.window.document.querySelector('[data-output="true"][data-index="[0,1]"]').click();assert.equal(messages.at(-1).type,'inspectIndex');assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).index)),[0,1]);send(inspectionResponse(messages.at(-1),node('out',[2,4],['in']),{status:'exact',output_index:[0,1],origins:[{node_id:'in',indices:[[1]],total:1,truncated:false}]}));assert.ok(dom.window.document.querySelector('[data-node="in"][data-index="[1]"]').classList.contains('origin'));send({type:'state',state:{stale:true,file:'a.py',version:2}});assert.equal(dom.window.document.querySelectorAll('.origin').length,0);assert.equal(dom.window.document.querySelectorAll('[data-output="true"]').length,0);});
test('huge tensors stay capped, rank three supports prefix slices, symbolic tensors have no grid',()=>{const {dom,messages}=setup([node('x',[4,1000000,1000000])]);assert.ok(dom.window.document.querySelectorAll('[data-index]').length<=128);const slice=dom.window.document.querySelector('input[data-axis="0"]');assert.ok(slice);slice.value='3';slice.dispatchEvent(new dom.window.Event('change'));const cell=dom.window.document.querySelector('[data-output="true"]');cell.click();assert.equal(messages.at(-1).index[0],3);assert.match(dom.window.document.querySelector(".grid-scroll").title,/显示.*总计/);const symbolic=setup([node('s',['BLOCK',4])]);assert.equal(symbolic.dom.window.document.querySelectorAll('[data-index]').length,0);assert.match(symbolic.dom.window.document.body.textContent,/符号/);});
test('malicious source text is rendered literally and unavailable mappings clear origins',()=>{const x=node('x',[1]);x.name='<img src=x onerror=alert(1)>';const {dom,messages,send}=setup([x]);assert.equal(dom.window.document.querySelectorAll('img').length,0);dom.window.document.querySelector('[data-output="true"]').click();send(inspectionResponse(messages.at(-1),x,{status:'unavailable',output_index:[0],origins:[],message:'symbolic mapping'}));assert.match(dom.window.document.body.textContent,/symbolic mapping/);});
test('off-slice origins are explained and navigation reveals the mapped input cell',()=>{
 const {dom,messages,send}=setup([node('in',[4,2,4]),node('out',[2,4],['in'])]);
 dom.window.document.querySelector('[data-output="true"]').click();
 send(inspectionResponse(messages.at(-1),node('out',[2,4],['in']),{status:'exact',output_index:[0,0],origins:[{node_id:'in',indices:[[3,1,2]],total:1,truncated:false}]}));
 assert.match(dom.window.document.body.textContent,/高亮 0 \/ 1/);assert.match(dom.window.document.body.textContent,/范围之外/);
 const jump=Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent==='定位首个来源坐标');jump.click();
 const cell=dom.window.document.querySelector('[data-node="in"][data-index="[3,1,2]"]');assert.ok(cell.classList.contains('origin'));assert.match(dom.window.document.body.textContent,/高亮 1 \/ 1/);
});
test('scalar output requests the empty coordinate and invalid JSON sends no apply request',()=>{
 const {dom,messages}=setup([node('scalar',[])]);dom.window.document.querySelector('[data-output="true"]').click();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).index)),[]);
 const input=dom.window.document.querySelector('textarea');input.value='{invalid';input.dispatchEvent(new dom.window.Event('input'));
 Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent==='应用参数并重新分析').click();assert.match(dom.window.document.body.textContent,/JSON 格式无效/);assert.equal(messages.some(m=>m.type==='applyParameters'),false);
});
test('new analysis resets reused node ID slices after shape shrink and rank change',()=>{
 const {dom,messages,send}=setup([node('x',[4,8,8])]);
 const prefix=dom.window.document.querySelector('input[data-axis="0"]');prefix.value='3';prefix.dispatchEvent(new dom.window.Event('change'));
 const state=(shape,generation,file)=>({type:'state',state:{analysis:{nodes:[node('x',shape)],kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'x',stale:false,file,version:2,generation,parameters:{},input_shapes:{},program_ids:[]}});
 send(state([2,8,8],2,'a.py'));dom.window.document.querySelector('[data-output="true"]').click();
 assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).index)),[0,0,0]);
 send(state([8,8],3,'b.py'));dom.window.document.querySelector('[data-output="true"]').click();
 assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).index)),[0,0]);
});
test('two-click and new-generation inspection responses require current browser token',()=>{
 const {dom,messages,send}=setup([node('x',[2])]);
 dom.window.document.querySelector('[data-output="true"][data-index="[0]"]').click();const first=messages.at(-1);
 dom.window.document.querySelector('[data-output="true"][data-index="[1]"]').click();const second=messages.at(-1);
 const response=(request,index)=>({type:'inspection',request_id:request.request_id,generation:request.generation,node_id:'x',inspection:{node:node('x',[2]),status:'exact',output_index:index,origins:[]}});
 send(response(first,[0]));assert.doesNotMatch(dom.window.document.querySelector('.mapping').textContent,/输出 \[0\]/);
 send({...response(first,[0]),inspection:{node:node('x',[2]),status:'unavailable',output_index:[0],origins:[],message:'old-error'}});assert.doesNotMatch(dom.window.document.querySelector('.mapping').textContent,/old-error/);
 send(response(second,[1]));assert.match(dom.window.document.querySelector('.mapping').textContent,/输出 \[1\]/);
 send({type:'state',state:{analysis:{nodes:[node('x',[2])],kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'x',stale:false,file:'b.py',version:2,generation:2,parameters:{},input_shapes:{},program_ids:[]}});
 dom.window.document.querySelector('[data-output="true"][data-index="[0]"]').click();const third=messages.at(-1);
 send(response(second,[1]));assert.doesNotMatch(dom.window.document.querySelector('.mapping').textContent,/输出 \[1\]/);
 send({...response(third,[0]),generation:1});assert.doesNotMatch(dom.window.document.querySelector('.mapping').textContent,/输出 \[0\] →/);
 send(response(third,[0]));assert.match(dom.window.document.querySelector('.mapping').textContent,/输出 \[0\] →/);
});
test('output slice changes clear current mappings and invalidate pending inspection',()=>{
 const {dom,messages,send}=setup([node('x',[4,2,4])]);dom.window.document.querySelector('[data-output="true"]').click();const first=messages.at(-1);
 const reply=inspectionResponse(first,node('x',[4,2,4]),{status:'exact',output_index:[0,0,0],origins:[]});send(reply);
 const slice=dom.window.document.querySelector('input[data-axis="0"]');slice.value='3';slice.dispatchEvent(new dom.window.Event('change'));
 assert.doesNotMatch(dom.window.document.querySelector('.mapping').textContent,/输出 \[0, 0, 0\]/);assert.equal(dom.window.document.querySelectorAll('.selected-cell').length,0);
 dom.window.document.querySelector('[data-output="true"]').click();const second=messages.at(-1);
 const nextSlice=dom.window.document.querySelector('input[data-axis="0"]');nextSlice.value='2';nextSlice.dispatchEvent(new dom.window.Event('change'));
 send(inspectionResponse(second,node('x',[4,2,4]),{status:'exact',output_index:[3,0,0],origins:[]}));assert.doesNotMatch(dom.window.document.querySelector('.mapping').textContent,/输出 \[3, 0, 0\]/);
});
test('input slice navigation retains current pending output query and its valid origins',()=>{
 const {dom,messages,send}=setup([node('in',[4,2,4]),node('out',[2,4],['in'])]);dom.window.document.querySelector('[data-output="true"]').click();const request=messages.at(-1);
 const slice=dom.window.document.querySelector('[data-card-node="in"] input[data-axis="0"]');slice.value='3';slice.dispatchEvent(new dom.window.Event('change'));
 send(inspectionResponse(request,node('out',[2,4],['in']),{status:'exact',output_index:[0,0],origins:[{node_id:'in',indices:[[3,1,2]],total:1,truncated:false}]}));
 assert.ok(dom.window.document.querySelector('[data-node="in"][data-index="[3,1,2]"]').classList.contains('origin'));assert.match(dom.window.document.querySelector('.mapping').textContent,/高亮 1 \/ 1/);
});

test('demo defaults to nine tensor steps and detailed toggle restores sixteen with matching navigation',()=>{
 const demo=require('./operations-fixture.cjs')();const {dom,messages,send}=setup(demo.nodes);
 assert.equal(dom.window.document.querySelectorAll('.operation').length,9);
 assert.deepEqual(Array.from(dom.window.document.querySelectorAll('.operation'),b=>b.dataset.node),demo.nodes.filter(n=>!['constant','parameter'].includes(n.op)).map(n=>n.id));
 const state={analysis:demo,selected:demo.nodes.find(n=>n.name==='rows').id,stale:false,file:'demo.py',version:1,generation:1,parameters:{},input_shapes:{},program_ids:[],show_all:false};
 send({type:'state',state});
 const next=Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent==='下一步 →');next.click();
 assert.equal(messages.at(-1).node_id,demo.nodes.find(n=>n.name==='cols').id);
 const toggle=dom.window.document.querySelector('input[data-role="show-all-nodes"]');assert.ok(toggle);toggle.checked=true;toggle.dispatchEvent(new dom.window.Event('change'));
 assert.equal(messages.at(-1).type,'setNodeVisibility');assert.equal(messages.at(-1).show_all,true);
 send({type:'state',state:{...state,show_all:true}});assert.equal(dom.window.document.querySelectorAll('.operation').length,16);
 const detailedNext=Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent==='下一步 →');detailedNext.click();
 assert.equal(messages.at(-1).node_id,demo.nodes[6].id);
});

test('arange folds its scalar bounds into readable attributes without singleton input grids',()=>{
 const demo=require('./operations-fixture.cjs')();const rows=demo.nodes.find(n=>n.name==='rows');const {dom,send}=setup(demo.nodes);
 send({type:'state',state:{analysis:demo,selected:rows.id,stale:false,file:'demo.py',version:1,generation:1,parameters:{},input_shapes:{},program_ids:[],show_all:false}});
 assert.equal(dom.window.document.querySelectorAll('.flow [data-card-node]').length,1);
 assert.match(dom.window.document.querySelector('.operation-details').textContent,/起点.*0/);
 assert.match(dom.window.document.querySelector('.operation-details').textContent,/终点.*BLOCK_M.*2/);
 assert.match(dom.window.document.querySelector('.operation-details').textContent,/长度.*2/);
 send({type:'state',state:{analysis:demo,selected:rows.id,stale:false,file:'demo.py',version:1,generation:1,parameters:{},input_shapes:{},program_ids:[],show_all:true}});
 assert.equal(dom.window.document.querySelectorAll('.flow [data-card-node]').length,3);
});

test('scalar reduction and its arithmetic remain visible while scalar index preparation folds',()=>{
 const make=(id,op,shape,inputs=[])=>({...node(id,shape,inputs),op});
 const nodes=[make('pid','program_id',[]),make('block','parameter',[]),make('start','mul',[],['pid','block']),make('x','arange',[8]),make('sum','sum',[],['x']),make('eps','constant',[]),make('denominator','add',[],['sum','eps']),make('result','div',[8],['x','denominator'])];
 const {dom,messages,send}=setup(nodes);
 assert.deepEqual(Array.from(dom.window.document.querySelectorAll('.operation'),b=>b.dataset.node),['x','sum','denominator','result']);
 send({type:'state',state:{analysis:{nodes,kernels:['k'],kernel:'k',diagnostics:[],missing_parameters:[]},selected:'denominator',stale:false,file:'a.py',version:1,generation:1,parameters:{},input_shapes:{},program_ids:[]}});
 assert.ok(dom.window.document.querySelector('[data-card-node="sum"]'));assert.equal(dom.window.document.querySelector('[data-card-node="eps"]'),null);
 assert.ok(dom.window.document.querySelector('[data-output="true"][data-index="[]"]'));
 dom.window.document.querySelector('[data-output="true"]').click();
 send(inspectionResponse(messages.at(-1),make('denominator','add',[],['sum','eps']),{status:'exact',output_index:[],origins:[{node_id:'sum',indices:[[]],total:1,truncated:false},{node_id:'eps',indices:[[]],total:1,truncated:false}]}));
 const folded=dom.window.document.querySelector('[data-origin-node="eps"]');assert.ok(folded);assert.match(folded.textContent,/参数与属性/);assert.doesNotMatch(folded.textContent,/网格高亮 1/);assert.equal(folded.querySelectorAll('button').length,0);
});
