import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Code, ConnectError, type RunnerClient } from '@lazybox/client-core';
import type { Collection, TerminalStatus } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { useRunner } from './RunnerContext';
import { Icon } from './Icons';
import './terminal.css';

/** Workspaces whose terminal panel was just asked for from the header. */
const requested = new Set<string>();
const listeners = new Set<() => void>();
/** Ask the workspace's terminal panel (now or once it mounts and has listed its shells) to
 * take focus: on a running shell when there is one, otherwise on a new one it starts. */
export function requestTerminal(collectionId: string) { requested.add(collectionId); for (const listener of listeners) listener(); }

const theme = { background: '#17181e', foreground: '#d4d5de', cursor: '#bdb1ed', cursorAccent: '#17181e', selectionBackground: '#3d3852', black: '#1d1e24', red: '#e08a8a', green: '#9fc79a', yellow: '#dcc58e', blue: '#8eaee0', magenta: '#bdb1ed', cyan: '#8fcbcf', white: '#d4d5de', brightBlack: '#6b6d7a', brightRed: '#efa3a3', brightGreen: '#b5dcb0', brightYellow: '#ead7a4', brightBlue: '#a9c3ef', brightMagenta: '#d2c8f5', brightCyan: '#a7dde0', brightWhite: '#f1f1f6' };
const encoder = new TextEncoder();
const inputLimit = 32 << 10;

const exitText = (status: TerminalStatus) => status.error || (status.signal ? `Shell ended by ${status.signal}` : status.exitCode === undefined ? 'Shell ended' : `Shell exited with code ${status.exitCode}`);

export function TerminalPanel({ workspaceId, collections, viewState }: { workspaceId: string; collections: Collection[]; viewState?: ViewStateStore }) {
  const { api } = useRunner();
  const collection = collections.find(value => value.id === workspaceId);
  const key = viewState ? `${viewState.key}:terminal` : '';
  const [terminals, setTerminals] = useState<TerminalStatus[]>([]);
  const [selected, setSelected] = useState(() => (key && viewState?.getItem(key)) || '');
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState(''), [listError, setListError] = useState(''), [opening, setOpening] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const listed = useRef<TerminalStatus[]>([]), selectedRef = useRef(selected); selectedRef.current = selected;
  const focusView = useRef<(() => void) | null>(null);
  const size = useRef({ cols: 80, rows: 24 });
  const choose = (id: string) => { setSelected(id); if (key) try { viewState?.setItem(key, id); } catch { /* the choice is a convenience */ } };
  const refresh = async (signal?: AbortSignal) => {
    const result = await api.listTerminals({ collectionId: workspaceId }, { signal });
    if (signal?.aborted) return;
    setTerminals(result.terminals); listed.current = result.terminals;
    const ids = result.terminals.map(value => value.id);
    // A terminal that appeared since the last look was just opened: show it.
    const fresh = known.current ? ids.filter(id => !known.current!.has(id)) : [];
    if (fresh.length) choose(fresh.at(-1)!);
    else setSelected(current => ids.includes(current) ? current : ids.at(-1) || '');
    known.current = new Set(ids);
  };
  const open = async () => {
    if (!workspaceId || opening) return;
    setOpening(true); setError('');
    try {
      const terminal = await api.openTerminal({ collectionId: workspaceId, directory, cols: size.current.cols, rows: size.current.rows, requestKey: crypto.randomUUID() });
      known.current?.add(terminal.id); choose(terminal.id); await refresh();
    } catch (error) { setError(String(error)); }
    finally { setOpening(false); }
  };
  const close = async (id: string) => {
    try { await api.closeTerminal({ terminalId: id }); await refresh(); }
    catch (error) { setError(String(error)); }
  };
  useEffect(() => {
    known.current = null; setTerminals([]); setError(''); setListError('');
    if (!workspaceId) return;
    const control = new AbortController(); let updating = false;
    const update = async () => {
      if (updating) return; updating = true;
      try { await refresh(control.signal); if (!control.signal.aborted) { setListError(''); consumeRef.current(); } }
      catch (error) { if (!control.signal.aborted) setListError(`Could not list terminals: ${String(error)}`); }
      finally { updating = false; }
    };
    void update(); const timer = setInterval(() => void update(), 2000);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, workspaceId]);
  // A request waits until this workspace's shells are listed, so asking twice never starts a second one.
  const consume = () => {
    if (!workspaceId || known.current === null || !requested.delete(workspaceId)) return;
    const live = listed.current.filter(terminal => !terminal.done);
    if (!live.length) { void open(); return; }
    if (!live.some(terminal => terminal.id === selectedRef.current)) choose(live.at(-1)!.id);
    requestAnimationFrame(() => focusView.current?.());
  };
  const consumeRef = useRef(consume); consumeRef.current = consume;
  useEffect(() => {
    const listener = () => consumeRef.current();
    listeners.add(listener); listener();
    return () => { listeners.delete(listener); };
  }, [workspaceId]);
  const current = terminals.find(value => value.id === selected);
  const ready = !!collection && collection.state === 'ready';
  return <section className="terminal-panel">{(error || listError) && <div className="error" role="alert">{error || listError}</div>}
    {!workspaceId ? <p className="module-empty">Choose a workspace to open a terminal in it.</p> : <>
      <div className="terminal-tabs" role="tablist" aria-label="Terminals">
        {terminals.map(terminal => <span key={terminal.id} className={'terminal-tab' + (terminal.id === selected ? ' selected' : '') + (terminal.done ? ' exited' : '')}>
          <button role="tab" aria-selected={terminal.id === selected} title={terminal.title} onClick={() => choose(terminal.id)}>{terminal.directory || 'Workspace root'}{terminal.done ? ' · exited' : ''}</button>
          <button className="terminal-close" aria-label={`Close terminal ${terminal.directory || 'Workspace root'}`} title={terminal.done ? 'Remove' : 'Close (hangs up the shell)'} onClick={() => void close(terminal.id)}>×</button>
        </span>)}
        <span className="terminal-new">
          <label><span className="sr-only">Terminal directory</span><select aria-label="Terminal directory" value={directory} onChange={event => setDirectory(event.target.value)}>
            <option value="">Workspace root</option>{collection?.members.map(member => member.spec?.name && <option key={member.spec.name} value={member.spec.name}>{member.spec.name}</option>)}
          </select></label>
          <button aria-label="New terminal" title="New terminal" disabled={!ready || opening} onClick={() => void open()}><Icon name="plus" size={14}/><span>New terminal</span></button>
        </span>
      </div>
      {current ? <TerminalView key={current.id} api={api} terminal={current} focusRef={focusView} onSize={value => { size.current = value; }} onError={setError}/>
        : <p className="module-empty">{ready ? 'No terminal is open in this workspace. A terminal runs your login shell on the Runner, in the directory you choose, and keeps running when the Runner restarts.' : 'The workspace is not ready for a terminal.'}{ready && <><br/><button className="primary" disabled={opening} onClick={() => void open()}>Start terminal</button></>}</p>}
    </>}
  </section>;
}

function TerminalView({ api, terminal, focusRef, onSize, onError }: { api: RunnerClient; terminal: TerminalStatus; focusRef: { current: (() => void) | null }; onSize(size: { cols: number; rows: number }): void; onError(error: string): void }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TerminalStatus>(terminal);
  const [connection, setConnection] = useState('Connecting');
  const id = terminal.id;
  useEffect(() => {
    const element = host.current; if (!element) return;
    const view = new Terminal({ theme, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, allowProposedApi: false });
    const fit = new FitAddon(); view.loadAddon(fit); view.open(element);
    const focus = () => view.focus(); focusRef.current = focus;
    const control = new AbortController(), signal = control.signal;
    let done = false;
    // Input is sent in order, one request at a time; keys typed meanwhile are batched.
    let pending: Uint8Array[] = [], sending = false;
    const flush = async () => {
      if (sending) return; sending = true;
      try {
        while (pending.length && !signal.aborted) {
          const joined = new Uint8Array(pending.reduce((total, part) => total + part.length, 0));
          let at = 0; for (const part of pending) { joined.set(part, at); at += part.length; }
          pending = [];
          for (let start = 0; start < joined.length; start += inputLimit) await api.writeTerminal({ terminalId: id, data: joined.subarray(start, start + inputLimit) }, { signal });
        }
      } catch (error) { if (!signal.aborted && !done) onError(`Terminal input failed: ${String(error)}`); pending = []; }
      finally { sending = false; }
    };
    const send = (data: Uint8Array) => { if (done) return; pending.push(data); void flush(); };
    const input = view.onData(data => send(encoder.encode(data)));
    const binary = view.onBinary(data => send(Uint8Array.from(data, character => character.charCodeAt(0) & 255)));
    let sized = '';
    const resize = () => {
      try { fit.fit(); } catch { return; }
      const value = `${view.cols}x${view.rows}`; if (value === sized || done) return; sized = value;
      onSize({ cols: view.cols, rows: view.rows });
      void api.resizeTerminal({ terminalId: id, cols: view.cols, rows: view.rows }, { signal }).catch(error => { if (!signal.aborted && !done) onError(`Terminal resize failed: ${String(error)}`); });
    };
    const observer = new ResizeObserver(() => resize()); observer.observe(element);
    requestAnimationFrame(() => { resize(); view.focus(); });
    void (async () => {
      let offset = 0n;
      while (!signal.aborted) {
        try {
          setConnection(offset ? 'Reconnecting' : 'Connecting');
          for await (const event of api.watchTerminal({ terminalId: id, after: offset }, { signal })) {
            if (event.data.length) view.write(event.data);
            offset = event.offset + BigInt(event.data.length);
            if (event.status) setStatus(event.status);
            setConnection('Live');
            if (event.status?.done && !event.data.length) {
              done = true; view.options.disableStdin = true; view.options.cursorBlink = false;
              view.write(`\r\n\x1b[2m[${exitText(event.status)}]\x1b[0m\r\n`);
            }
          }
          if (done || signal.aborted) return;
        } catch (error) {
          if (signal.aborted) return;
          const code = ConnectError.from(error).code;
          if (code === Code.NotFound) { setConnection('Closed'); return; }
          setConnection(`Disconnected: ${String(error)}`);
        }
        await new Promise<void>(resolve => { const timer = setTimeout(resolve, 1000); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
      }
    })();
    return () => { if (focusRef.current === focus) focusRef.current = null; control.abort(); observer.disconnect(); input.dispose(); binary.dispose(); view.dispose(); };
  }, [api, id]);
  return <div className="terminal-view">
    <div ref={host} className="terminal-host" data-testid="terminal" data-terminal-id={id}/>
    <footer><span className="mono" title={status.shell}>{status.title}</span><span>{status.done ? exitText(status) : connection}</span></footer>
  </div>;
}
