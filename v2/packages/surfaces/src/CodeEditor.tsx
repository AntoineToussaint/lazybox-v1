import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as monaco from 'monaco-editor';
import './monaco-languages';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';

import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';

globalThis.MonacoEnvironment = { getWorker: (_id, label) => label === 'json' ? new JsonWorker() : ['typescript','javascript'].includes(label) ? new TsWorker() : ['css','scss','less'].includes(label) ? new CssWorker() : ['html','handlebars','razor'].includes(label) ? new HtmlWorker() : new EditorWorker() };
monaco.editor.defineTheme('lazybox', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background':'#1b1c22', 'editorLineNumber.foreground':'#666976', 'editor.lineHighlightBackground':'#252630', 'editor.selectionBackground':'#50496a' } });

// monaco-vim's ex commands are global; each one finds its editor's handlers here.
type VimAdapter = { editor: monaco.editor.ICodeEditor; on(event: string, handler: (...args: never[]) => void): void; openNotification(text: string): void; dispose(): void };
type ExHandlers = { write(thenQuit: boolean): void; quit(force: boolean): void };
const exHandlers = new WeakMap<object, ExHandlers>();
let exCommandsDefined = false;
function defineExCommands(VimMode: unknown) {
 if (exCommandsDefined) return;
 exCommandsDefined = true;
 const vim = (VimMode as { Vim: { defineEx(name: string, prefix: string, run: (cm: VimAdapter, params: { argString?: string }) => void): void } }).Vim;
 vim.defineEx('write', 'w', cm => exHandlers.get(cm.editor)?.write(false));
 vim.defineEx('wq', 'wq', cm => exHandlers.get(cm.editor)?.write(true));
 vim.defineEx('xit', 'x', cm => exHandlers.get(cm.editor)?.write(true));
 vim.defineEx('quit', 'q', (cm, params) => exHandlers.get(cm.editor)?.quit(params.argString?.trim() === '!'));
}

/** `onSave` resolves to false when the file was not saved. With `vim`, Esc
 * belongs to the editor (Vim users press it reflexively to be sure they are in
 * normal mode), and :q closes through the dialog's unsaved-changes guard. */
export default function CodeEditor({path,value,readOnly,line,vim=false,onChange,onSave,onQuit}:{path:string;value:string;readOnly:boolean;line?:number;vim?:boolean;onChange(value:string):void;onSave():unknown;onQuit?(force:boolean):void}) {
 const container=useRef<HTMLDivElement>(null),status=useRef<HTMLDivElement>(null),instance=useRef<monaco.editor.IStandaloneCodeEditor>(null);
 const change=useRef(onChange),save=useRef(onSave),quit=useRef(onQuit),locked=useRef(readOnly);change.current=onChange;save.current=onSave;quit.current=onQuit;locked.current=readOnly;
 const vimActive=useRef(false);
 const [vimError,setVimError]=useState('');
 useEffect(()=>{
  const uri=monaco.Uri.parse(`inmemory://workspace/${crypto.randomUUID()}/${path}`);
  const model=monaco.editor.createModel(value,undefined,uri);
  const editor=monaco.editor.create(container.current!,{model,theme:'lazybox',readOnly,automaticLayout:true,minimap:{enabled:false},fontSize:13,lineHeight:21,padding:{top:14,bottom:14},scrollBeyondLastLine:false,wordWrap:'off',renderLineHighlight:'line',tabSize:2,ariaLabel:'File source editor',fixedOverflowWidgets:true});
  instance.current=editor;
  const subscription=editor.onDidChangeModelContent(()=>change.current(editor.getValue()));
  editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS,()=>save.current());
  if(line){editor.setPosition({lineNumber:line,column:1});editor.revealLineInCenter(line);}
  return()=>{subscription.dispose();editor.dispose();model.dispose();instance.current=null;};
 },[path]);
 useEffect(()=>{
  const editor=instance.current;if(!vim||!editor)return;
  let adapter:VimAdapter|undefined,disposed=false;setVimError('');
  // Loaded on demand: nobody without Vim editing pays for it.
  import('monaco-vim').then(({initVimMode,VimMode,StatusBar})=>{
   if(disposed||!status.current)return;
   defineExCommands(VimMode);
   // monaco-vim drives Monaco's textarea input. With Chromium's native
   // EditContext, keys typed just before Esc arrive after Vim has left insert
   // mode and are dropped or reordered, so Vim editing keeps the textarea.
   editor.updateOptions({editContext:false});
   // The same mode words as the message box, and no stale <Esc> in the key echo.
   class Bar extends StatusBar{
    setMode(event:{mode:string;subMode?:string}){this.setText(event.mode==='visual'&&event.subMode&&event.subMode!=='characterwise'?`VISUAL ${event.subMode==='linewise'?'LINE':'BLOCK'}`:event.mode.toUpperCase());}
    setKeyBuffer(keys:string){const end=keys.lastIndexOf('<Esc>');super.setKeyBuffer(end<0?keys:keys.slice(end+5));}
   }
   adapter=initVimMode(editor,status.current,Bar) as unknown as VimAdapter;
   vimActive.current=true;
   exHandlers.set(editor,{
    write(thenQuit){
     if(locked.current){adapter?.openNotification('Read-only · choose Edit file to change it');return;}
     void Promise.resolve(save.current()).then(saved=>{if(saved===false){adapter?.openNotification('Not saved · see the message above');return;}adapter?.openNotification(`"${path.split('/').at(-1)}" written`);if(thenQuit)quit.current?.(false);});
    },
    quit(force){quit.current?.(force);},
   });
  },error=>{if(!disposed)setVimError(`Vim editing could not load: ${String(error)}`);});
  return()=>{disposed=true;vimActive.current=false;exHandlers.delete(editor);if(adapter){adapter.dispose();editor.updateOptions({editContext:true});}};
 },[vim,path]);
 useEffect(()=>{if(instance.current&&instance.current.getValue()!==value)instance.current.setValue(value);},[value]);
 useEffect(()=>{instance.current?.updateOptions({readOnly});},[readOnly]);
 // Cancelling the keydown keeps the dialog open; Vim and Monaco's own
 // widgets (suggest, find) still receive the Escape.
 const keepEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&vimActive.current)event.preventDefault();};
 return <div className="code-editor-frame" onKeyDownCapture={vim?keepEscape:undefined}>
  <div ref={container} className="workspace-code-editor" data-testid="workspace-code-editor"/>
  {vim&&<div className="vim-status" aria-label="Vim status"><div ref={status} className="vim-status-bar" role="status"/>{vimError?<span className="vim-notification" role="alert">{vimError}</span>:<span className="vim-status-help">:w save · :q close · :wq save and close</span>}</div>}
 </div>;
}
