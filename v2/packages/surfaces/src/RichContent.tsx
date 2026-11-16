import { fileReference, type FileLink } from './file-reference';
import { preloadEditor } from './editor-loader';
import { isMac } from './workbench';
import { Children, isValidElement, memo, useMemo, useState, type ReactNode } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import yaml from 'highlight.js/lib/languages/yaml';
import diff from 'highlight.js/lib/languages/diff';
import './rich-content.css';
import { contextMenu, copyText } from './ContextMenu';
import { codeBlockItems, fileLinkItems } from './chat-context-menu';
import type { OpenModifiers } from './file-links';
for (const [name, language] of Object.entries({json,bash,typescript,python,go,rust,yaml,diff})) hljs.registerLanguage(name,language);
hljs.registerAliases(['js','javascript','tsx','jsx','ts'],{languageName:'typescript'});

function Copy({text}:{text:string}) {
 const [state,setState]=useState('Copy');
 return <button type="button" aria-label="Copy code" onClick={()=>void navigator.clipboard.writeText(text).then(()=>setState('Copied'),()=>setState('Copy failed'))}>{state}</button>;
}
export const CodeBlock=memo(function CodeBlock({text,language='',label}:{text:string;language?:string;label?:string}) {
 const highlighted=useMemo(()=>text.length<=100000&&hljs.getLanguage(language)?hljs.highlight(text,{language,ignoreIllegals:true}).value:undefined,[text,language]);
 return <div className="code-block" onContextMenu={contextMenu('code-block',()=>codeBlockItems(text,language),{text,language})}><header><span>{label||language||'Text'}</span><Copy text={text}/></header><pre aria-label={label||`${language||'Plain text'} code`}><code>{highlighted===undefined?text:<span dangerouslySetInnerHTML={{__html:highlighted}}/>}</code></pre></div>;
});
const mermaidSource=(text:string)=><CodeBlock text={text} language="mermaid"/>;
function codeText(node:ReactNode):string {if(typeof node==='string')return node;if(Array.isArray(node))return node.map(codeText).join('');return '';}
const components={
 pre:({children}:{children?:ReactNode})=>{
  const child=Children.toArray(children)[0];
  if(!isValidElement<{className?:string;children?:ReactNode}>(child))return <pre>{children}</pre>;
  const language=/language-([^\s]+)/.exec(child.props.className||'')?.[1]?.toLowerCase()||'';
  const text=codeText(child.props.children).replace(/\n$/,'');
  return language==='mermaid'?<MermaidDiagram text={text} sourceView={mermaidSource}/>:<CodeBlock text={text} language={language}/>;
 },
 a:({href,children}:{href?:string;children?:ReactNode})=>href&&/^https?:\/\//i.test(href)?<a href={href} target="_blank" rel="noopener noreferrer" onContextMenu={contextMenu('link',()=>[{label:'Open link',icon:'external',run:()=>{window.open(href,'_blank','noopener,noreferrer');}},{label:'Copy link',icon:'link',run:()=>copyText(href,'Copied link')}],{href})}>{children}</a>:<span className="content-reference">{children}</span>,
 // Do not load external images from model output just by viewing a message.
 img:({alt}:{alt?:string})=><span className="content-reference">{alt||'Image reference'}</span>,
};
const fileTitle=`Open file · ${isMac?'⌥':'Alt+'}click for a quick look · ${isMac?'⌘':'Ctrl+'}click to open beside`;
/** All agent-authored prose uses this renderer, including help and planning.
 * Raw HTML is never interpreted; code and diagram source remain copyable. */
/** `onOpenFile` gets the click's modifiers: Alt asks for a quick look, Cmd/Ctrl for the file beside the current one. */
export const RichContent=memo(function RichContent({text,onOpenFile}:{text:string;onOpenFile?(reference:FileLink,how:OpenModifiers):void}) {
 const fileMenu=(file:FileLink)=>contextMenu('file-link',()=>fileLinkItems(file,onOpenFile!),file);
 const rawJSON=useMemo(()=>{if(text.length>200000||!/^\s*[\[{]/.test(text))return false;try{JSON.parse(text);return true;}catch{return false;}},[text]);
 return <div className="rich-content">{rawJSON?<CodeBlock text={text} language="json"/>:<Markdown remarkPlugins={[remarkGfm]} components={{...components,
 a:({href,children})=>{const file=href&&fileReference(href);return file&&onOpenFile?<button className="file-reference" title={fileTitle} onPointerEnter={preloadEditor} onClick={event=>onOpenFile(file,event)} onContextMenu={fileMenu(file)}>{children}</button>:components.a({href,children});},
 code:({children,className})=>{const file=!className&&typeof children==='string'?fileReference(children,'automatic'):undefined;return file&&onOpenFile?<button className="file-reference inline-file" title={fileTitle} onPointerEnter={preloadEditor} onClick={event=>onOpenFile(file,event)} onContextMenu={fileMenu(file)}>{children}</button>:<code className={className}>{children}</code>;}
 }}>{text}</Markdown>}</div>;
});
