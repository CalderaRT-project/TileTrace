import {execFile} from 'node:child_process';
import {accessSync,constants,statSync} from 'node:fs';
import * as path from 'node:path';
import {WorkerOptions} from './worker';

const PYTHON_CHECK=['-I','-S','-c','import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'];

function executableFile(candidate:string):boolean {
  try {
    accessSync(candidate,constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function pathCommands(env:NodeJS.ProcessEnv):string[] {
  if(process.platform==='win32')return ['python','python3'];
  const directories=[...new Set((env.PATH??'/usr/bin:/bin').split(path.delimiter).filter(directory=>path.isAbsolute(directory)))];
  return ['python3','python'].flatMap(name=>directories.map(directory=>path.join(directory,name))).filter(executableFile);
}

function canRun(command:string,args:string[],cwd:string,env:NodeJS.ProcessEnv):Promise<boolean> {
  return new Promise(resolve=>{
    execFile(command,args,{cwd,env,timeout:2000,windowsHide:true},error=>resolve(!error));
  });
}

async function findPython(workspaceRoot:string,cwd:string,env:NodeJS.ProcessEnv):Promise<string> {
  const venv=process.platform==='win32'
    ?path.join(workspaceRoot,'.venv','Scripts','python.exe')
    :path.join(workspaceRoot,'.venv','bin','python');
  for(const command of [venv,...pathCommands(env)]){
    // The macOS shim can open the developer tools installer if no tools are selected.
    if(process.platform==='darwin'&&command==='/usr/bin/python3'&&
       !await canRun('/usr/bin/xcode-select',['-p'],cwd,env))continue;
    if(await canRun(command,PYTHON_CHECK,cwd,env))return command;
  }
  throw new Error('找不到可用的 Python 3.10 或更高版本。请在 VS Code 设置中配置 tiletrace.pythonPath。');
}

// Owned code only: paths travel as argv data, never as interpolated Python source.
export const WORKER_BOOTSTRAP='import sys,runpy; sys.path.insert(0,sys.argv.pop(1)); runpy.run_module("tiletrace.worker",run_name="__main__",alter_sys=True)';
export function workerLaunchOptions(pythonPath:string,pythonRoot:string,log:(text:string)=>void,workspaceRoot?:string):WorkerOptions {
  const trustedRoot=path.resolve(pythonRoot);
  const env={...process.env};
  const command=pythonPath==='python'&&workspaceRoot?()=>findPython(workspaceRoot,trustedRoot,env):pythonPath;
  return {command,args:['-I','-S','-u','-c',WORKER_BOOTSTRAP,trustedRoot],cwd:trustedRoot,env,log};
}
