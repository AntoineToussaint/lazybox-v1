import {useCallback,useLayoutEffect,useRef,useState,type UIEvent} from 'react';
import type {ConversationReader} from './transcript-cache';

/** Messages mounted when a conversation opens, and added per step toward its start. */
export const INITIAL_MESSAGES=40,EARLIER_MESSAGES=60;

/** Follow the rendered content, including asynchronous diagrams and viewport changes.
 * Earlier history is mounted as the reader nears the top, keeping what they look at in place. */
export function useChatScroll(reader:ConversationReader,messages:readonly unknown[],pendingCount:number|undefined){
 const paneRef=useRef<HTMLDivElement>(null),contentRef=useRef<HTMLDivElement>(null);
 const following=useRef(reader.view.following);
 const [followingLatest,setFollowingLatest]=useState(reader.view.following);
 const [visibleMessages,setVisibleMessages]=useState(reader.view.visibleMessages);
 const prependHeight=useRef<number|undefined>(undefined);
 const dimensions=useRef({height:0,width:0,content:0});
 const hidden=useRef(0);hidden.current=Math.max(0,messages.length-visibleMessages);
 const measure=(pane:HTMLDivElement)=>{dimensions.current={height:pane.clientHeight,width:pane.clientWidth,content:pane.scrollHeight};};
 // WebKit has no scroll anchoring. While the reader is not following, the
 // first row on screen keeps its place when content above it changes height,
 // such as a diagram rendering as it nears the viewport.
 const anchor=useRef<{node:Element;offset:number}|undefined>(undefined);
 const capture=(pane:HTMLDivElement)=>{
  anchor.current=undefined;const top=pane.getBoundingClientRect().top;
  for(const node of contentRef.current?.children||[]){const box=node.getBoundingClientRect();if(box.bottom>top){anchor.current={node,offset:box.top-top};return;}}
 };
 const restore=(pane:HTMLDivElement)=>{
  const held=anchor.current;if(!held?.node.isConnected)return;
  const shift=held.node.getBoundingClientRect().top-pane.getBoundingClientRect().top-held.offset;
  if(Math.abs(shift)>=1)pane.scrollTop+=shift;
 };
 const pin=(pane:HTMLDivElement)=>{pane.scrollTop=pane.scrollHeight;measure(pane);};
 const setFollowing=useCallback((value:boolean)=>{following.current=value;reader.view.following=value;setFollowingLatest(value);},[reader]);
 const loadEarlier=useCallback((pane:HTMLDivElement|null)=>{
  if(!hidden.current||prependHeight.current!==undefined)return;
  prependHeight.current=pane?.scrollHeight;setVisibleMessages(count=>count+EARLIER_MESSAGES);
 },[]);
 // Within a screen of the top, the next step of history is mounted before the reader reaches it.
 const nearTop=(pane:HTMLDivElement)=>hidden.current>0&&pane.scrollTop<Math.max(400,pane.clientHeight);
 useLayoutEffect(()=>{
  following.current=reader.view.following;setFollowingLatest(reader.view.following);setVisibleMessages(reader.view.visibleMessages);
  const pane=paneRef.current,content=contentRef.current;if(!pane||!content)return;
  pane.scrollTop=reader.view.following?pane.scrollHeight:reader.view.scrollTop;measure(pane);
  if(!reader.view.following)capture(pane);
  const resize=new ResizeObserver(()=>{if(following.current)pin(pane);else{restore(pane);measure(pane);}});
  resize.observe(pane);resize.observe(content);
  return()=>{resize.disconnect();reader.view.scrollTop=pane.scrollTop;reader.view.following=following.current;};
 },[reader]);
 useLayoutEffect(()=>{
  const pane=paneRef.current;if(!pane)return;
  if(prependHeight.current!==undefined){pane.scrollTop+=pane.scrollHeight-prependHeight.current;prependHeight.current=undefined;measure(pane);capture(pane);}
  else if(following.current)pin(pane);
  reader.view.visibleMessages=visibleMessages;
  if(nearTop(pane))loadEarlier(pane);
 },[reader,messages,visibleMessages,pendingCount,loadEarlier]);
 const onScroll=(event:UIEvent<HTMLDivElement>)=>{
  const pane=event.currentTarget,previous=dimensions.current;
  // Browser layout scrolls are not evidence that the user stopped following.
  if(following.current&&(previous.height!==pane.clientHeight||previous.width!==pane.clientWidth||previous.content!==pane.scrollHeight)){pin(pane);return;}
  setFollowing(pane.scrollHeight-pane.scrollTop-pane.clientHeight<48);measure(pane);reader.view.scrollTop=pane.scrollTop;
  if(following.current)anchor.current=undefined;else capture(pane);
  if(nearTop(pane))loadEarlier(pane);
 };
 const jumpToLatest=()=>{setFollowing(true);if(paneRef.current)pin(paneRef.current);};
 const showEarlier=useCallback(()=>{setFollowing(false);loadEarlier(paneRef.current);},[setFollowing,loadEarlier]);
 return{paneRef,contentRef,followingLatest,visibleMessages,onScroll,jumpToLatest,showEarlier};
}
