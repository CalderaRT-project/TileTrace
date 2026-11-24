const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function createController({root,python,holdFirstAnalysis=false,trusted=true,inspectError=false,holdInspections=false,analysisNodes,sourceText,autoOpen}={}) {
 const messages=[],calls=[],launches=[],disposals=[],pendingAnalyses=[],pendingInspections=[],reveals=[];
 let panelDisposed;let panelCreations=0;
 const node={id:'n1',name:'x',op:'arange',inputs:[],shape:[2],status:'resolved',source:{start_line:4,start_col:8,end_line:4,end_col:22},attrs:{},dtype:null};
 const uri={scheme:'file',fsPath:path.join(root,'kernel.py'),toString:()=>`file:///${root}/kernel.py`};
 const folder={uri:{fsPath:root,toString:()=>`file:///${root}`}};
 const document={uri,languageId:'python',fileName:uri.fsPath,version:1,getText:()=> sourceText??'import triton\nimport triton.language as tl\n@triton.jit\ndef k():\n    x = tl.arange(0,2)\n'};
 const editor={document,selection:{active:{line:4,character:4}},viewColumn:1};
 const disposable={dispose(){}};
 const panel={webview:{cspSource:'vscode-resource:',asWebviewUri:x=>String(x),postMessage:m=>{messages.push(m);return Promise.resolve(true);},onDidReceiveMessage:()=>disposable},onDidDispose:callback=>{panelDisposed=callback;return disposable;},reveal(...args){reveals.push(args);},dispose(){}};
 const vscode={workspace:{isTrusted:trusted,getWorkspaceFolder:()=>folder,getConfiguration:()=>({get:(key,fallback)=>key==='pythonPath'&&python?python:key==='autoOpen'&&autoOpen!==undefined?autoOpen:fallback})},window:{activeTextEditor:editor,createOutputChannel:()=>({append(){},appendLine(){},dispose(){}}),createWebviewPanel:()=>{panelCreations++;return panel;},showInformationMessage:()=>Promise.resolve()},Uri:{joinPath:(uri,...pieces)=>String(uri)+'/'+pieces.join('/')},ViewColumn:{Beside:2},Range:class{constructor(line,col,endLine,endCol){this.start={line,character:col};this.end={line:endLine,character:endCol};}}};
 class WorkerClient {
  constructor(options){this.id=launches.push(options);}
  dispose(){disposals.push(this.id);}
  async request(method,p){
   calls.push({id:this.id,method,p});
   if(method==='inspect'){
    const result={node,inputs:[],output_index:p.index,status:'exact',origins:[]};
    if(holdInspections)return new Promise((resolve,reject)=>pendingInspections.push({resolve:()=>resolve(result),reject}));
    if(inspectError)throw new Error('inspection fixture unavailable');
    return result;
   }
   if(method!=='analyze')throw new Error('Unexpected worker method: '+method);
   const result={document_id:p.document_id,version:p.version,kernel:'k',kernels:['k'],nodes:analysisNodes??[node],diagnostics:[],missing_parameters:[],parameters:{}};
   if(holdFirstAnalysis&&this.id===1)return new Promise(resolve=>pendingAnalyses.push(()=>resolve(result)));
   return result;
  }
 }
 const filename=path.resolve(__dirname,'../out/extension.js');const source=fs.readFileSync(filename,'utf8');const exported={};
 const sandbox={exports:exported,require:name=>name==='vscode'?vscode:name==='./worker'?{WorkerClient}:require(name.startsWith('.')?path.resolve(path.dirname(filename),name):name),setTimeout,clearTimeout,process,Buffer};
 vm.runInNewContext(source+'\nexports.TestController = Controller;',sandbox,{filename});
 const controller=new exported.TestController({extensionPath:path.resolve(__dirname,'..'),extensionUri:'file:///extension',subscriptions:[]});
 return {controller,editor,messages,calls,launches,disposals,pendingAnalyses,pendingInspections,panel,reveals,panelCreations:()=>panelCreations,closePanel:()=>panelDisposed?.()};
}
const until=async(predicate)=>{const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw new Error('Controller condition timed out');await new Promise(resolve=>setTimeout(resolve,10));}};
module.exports={createController,until};
