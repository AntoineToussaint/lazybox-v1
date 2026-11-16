import type { Collection, Session, Profile } from '@lazybox/protocol';

/**
 * The conversation's own title, or '' while it has none. The Runner starts a
 * conversation titled after its working folder, which for a workspace is the
 * workspace's generated name ("strongly-tight-collie"): that is not a title.
 */
export function conversationTitle(session?:Session):string{
 const title=session?.title?.trim()||'';
 if(!title)return '';
 const folder=(session?.workingDirectory||'').split('/').filter(Boolean).at(-1)||'';
 return title===folder?'':title;
}
/** A short title suggested from the first message: its first line, up to a word boundary. */
export function titleFromMessage(text:string,limit=60):string{
 const line=text.split('\n').map(value=>value.replace(/[#>*_`]+/g,'').replace(/\s+/g,' ').trim()).find(Boolean)||'';
 if(line.length<=limit)return line.replace(/[.?!:;,]+$/,'');
 const cut=line.slice(0,limit);const space=cut.lastIndexOf(' ');
 return (space>limit/2?cut.slice(0,space):cut).replace(/[.?!:;,]+$/,'')+'…';
}
/**
 * One line for a workspace's branch: the branch once when every repository is
 * on it ("feature/x", "5 repositories"), otherwise the first and "+N".
 */
export function branchSummary(workspace?:Collection):{name:string;detail:string;title:string}|undefined{
 const members=workspace?.members.filter(member=>member.spec?.branch)||[];
 if(!members.length)return undefined;
 const branches=[...new Set(members.map(member=>member.spec!.branch))];
 const title=members.map(member=>`${member.spec!.name}: ${member.spec!.branch}`).join('\n');
 if(branches.length===1)return {name:branches[0],detail:members.length>1?`${members.length} repositories`:'',title};
 return {name:branches[0],detail:`+${branches.length-1} ${branches.length===2?'branch':'branches'}`,title};
}

/** Creation order is independent of selection, status, and RPC response order.
 * Older Runners omit timestamps; stable IDs provide a deterministic tie-break. */
export function mergeConversations(saved: readonly Session[], live: readonly Session[]): Session[] {
  const rows = new Map(saved.map(session => [session.id, session]));
  for (const session of live) {
    const previous = rows.get(session.id);
    rows.set(session.id, {
      ...previous, ...session,
      title: session.title || previous?.title || '',
      createdAtUnixMillis: session.createdAtUnixMillis || previous?.createdAtUnixMillis || 0n,
    });
  }
  const superseded = new Set([...rows.values()].map(session => session.previousExecutionId).filter(Boolean));
  return [...rows.values()].filter(session => !superseded.has(session.id)).sort((a, b) => {
    if (a.createdAtUnixMillis !== b.createdAtUnixMillis) return a.createdAtUnixMillis > b.createdAtUnixMillis ? -1 : 1;
    const left=a.conversationId || a.id, right=b.conversationId || b.id;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** Never present an account profile ID as model information. */
export function sessionModelLabel(session?:Session,reportedModel=''):string {
 if(reportedModel)return reportedModel;
 if(session?.model)return session.modelReported?session.model:`${session.model} (requested)`;
 return '';
}
export function sessionAccountLabel(session?:Session,profile?:Profile):string {
 if(profile?.label&&profile.id!=='claude-default'&&profile.id!=='codex-default')return profile.label;
 if(profile?.isolation==='inherited'||session?.profileId==='claude-default'||session?.profileId==='codex-default')return 'Account not reported';
 return session?.profileId?'Saved account':'Loading account…';
}
export function conversationDetails(session:Session,profiles:readonly Profile[],includeAccount=true):string {
 const profile=profiles.find(value=>value.id===session.profileId);
 const provider=session.provider||profile?.provider||'';
 const agent=provider==='claude'?'Claude':provider==='codex'?'Codex':provider||'Agent';
 return [agent,sessionModelLabel(session),includeAccount?sessionAccountLabel(session,profile):''].filter(Boolean).join(' · ');
}
