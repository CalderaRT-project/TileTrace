const test=require('node:test'); const assert=require('node:assert/strict'); const path=require('node:path');
const fs=require('node:fs'); const os=require('node:os'); const {execFileSync}=require('node:child_process');
const {workerLaunchOptions}=require('../out/launch');
const {WorkerClient}=require('../out/worker');
const make=(timeout=1000,log=()=>{})=>new WorkerClient({command:process.execPath,args:[path.join(__dirname,'worker-fixture.cjs')],cwd:__dirname,env:process.env,timeout,log});
test('worker correlates out of order responses and separates stderr',async()=>{
 const logs=[]; const w=make(1000,x=>logs.push(x));
 try {const [a,b]=await Promise.all([w.request('echo',{delay:60,value:'a'}),w.request('stderr',{value:'b'})]); assert.equal(a.value,'a');assert.equal(b.value,'b');assert.ok(logs.join('').includes('diagnostic only'));await assert.rejects(w.request('error',{}),/invalid shape/);} finally{w.dispose();}
});
test('worker exit rejects every pending request',async()=>{const w=make();try {await assert.rejects(Promise.all([w.request('wait',{}),w.request('exit',{})]),/退出|closed|exit/i);}finally{w.dispose();}});
test('timeout closes process and allows next request to restart',async()=>{const w=make(1000);try{await assert.rejects(w.request('wait',{}),/超时|timeout/i); assert.deepEqual(await w.request('echo',{value:8}),{value:8});}finally{w.dispose();}});
test('spawn error rejects instead of hanging',async()=>{const w=new WorkerClient({command:'__nonexistent_triton_python__',args:[],cwd:__dirname,env:process.env,timeout:500,log:()=>{}});try{await assert.rejects(w.request('echo',{}),/Python|ENOENT/);}finally{w.dispose();}});

test('automatic launch recovers when python3 becomes available without a python command',
 {skip:process.platform==='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tiletrace-python-path-'));
 const backend=path.resolve(__dirname,'../..');
 const options=workerLaunchOptions('python',backend,()=>{},root);
 const worker=new WorkerClient(options);
 try {
  const source=fs.readFileSync(path.join(__dirname,'fixtures','broadcast.py'),'utf8');
  options.env.PATH='';
  await assert.rejects(worker.request('analyze',{source}),/找不到可用的 Python 3\.10/);

  const venv=path.join(backend,'.venv','bin','python');
  const executable=execFileSync(fs.existsSync(venv)?venv:'python3',
   ['-I','-S','-c','import os, sys; print(os.path.realpath(sys.executable))'],{encoding:'utf8'}).trim();
  const bin=path.join(root,'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(executable,path.join(bin,'python3'));
  options.env.PATH=bin;
  const [first,second]=await Promise.all([
   worker.request('analyze',{source,version:1}),
   worker.request('analyze',{source,version:2})
  ]);
  assert.equal(first.kernel,'broadcast_demo');
  assert.deepEqual([first.version,second.version],[1,2]);
 } finally {
  worker.dispose();
  fs.rmSync(root,{recursive:true,force:true});
 }
});
