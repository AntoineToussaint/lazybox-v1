import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { Icon } from './Icons';
import { sizedSvg, type Rendered, type Size } from './diagram-svg';
import './mermaid-diagram.css';
import { getAppearance } from './appearance/apply';
import { mermaidTheme } from './appearance/integrations';
import { useAppearance } from './appearance/useAppearance';

let mermaidReady: Promise<typeof import('mermaid')['default']> | undefined;
/** Mermaid, configured for the window's current theme (re-applied before each render). */
function diagrams() {
  return (mermaidReady ??= import('mermaid').then(({ default: mermaid }) => mermaid)).then(mermaid => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'flowchart'], theme: 'base', themeVariables: mermaidTheme(getAppearance()), htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: 50000, maxEdges: 500, suppressErrorRendering: true });
    return mermaid;
  });
}

/** Mounted once near the viewport: off-screen diagrams in a long conversation cost nothing. */
function useNearViewport(ref: RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (near || !node) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    // The margin applies to the observer's root only, so the root is the
    // conversation's scroll pane, not the window it is clipped by.
    let root = node.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setNear(true); }, { root, rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

const MIN_SCALE = 0.1, MAX_SCALE = 8, STEP = 1.25, INLINE_HEIGHT = 520;
type View = { scale: number; x: number; y: number; fitted: boolean };

/** Zoom and pan state for one viewport onto a diagram of natural size `size`. */
function useDiagramView(size: Size, mode: 'inline' | 'full') {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0, fitted: true });
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const fitScale = useCallback((width: number, height: number) => mode === 'inline'
    // Inline, the whole diagram shows at a readable size; tall ones are cropped and pan.
    ? Math.min(1, width / size.width, Math.max(INLINE_HEIGHT / size.height, 0.5))
    : Math.min(3, width / size.width, height / size.height) * 0.96, [mode, size.width, size.height]);
  const place = useCallback((scale: number, x: number, y: number, fitted = false): View => {
    const { width, height } = frame;
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const w = size.width * scale, h = size.height * scale;
    // Smaller than the viewport: centred. Larger: never dragged entirely out of view.
    x = w <= width ? (width - w) / 2 : Math.min(0, Math.max(width - w, x));
    y = h <= height ? (height - h) / 2 : Math.min(0, Math.max(height - h, y));
    return { scale, x, y, fitted };
  }, [frame, size.width, size.height]);
  const fit = useCallback(() => setView(place(fitScale(frame.width, frame.height), 0, 0, true)), [place, fitScale, frame]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observe = () => setFrame(previous => previous.width === node.clientWidth && previous.height === node.clientHeight ? previous : { width: node.clientWidth, height: node.clientHeight });
    observe();
    const observer = new ResizeObserver(observe);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // A fitted view follows the viewport; one the reader zoomed keeps its scale.
  useLayoutEffect(() => {
    if (!frame.width) return;
    setView(current => current.fitted ? place(fitScale(frame.width, frame.height), 0, 0, true) : place(current.scale, current.x, current.y));
  }, [frame, place, fitScale]);
  const zoomAt = useCallback((factor: number, px = frame.width / 2, py = frame.height / 2) => setView(current => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor)), ratio = scale / current.scale;
    return place(scale, px - (px - current.x) * ratio, py - (py - current.y) * ratio);
  }), [place, frame]);
  const actual = useCallback(() => zoomAt(1 / view.scale), [zoomAt, view.scale]);
  const pan = useCallback((dx: number, dy: number) => setView(current => place(current.scale, current.x + dx, current.y + dy)), [place]);
  // Inline the viewport keeps the height of the fitted diagram, so zooming never moves the conversation.
  const inlineHeight = mode === 'inline' && frame.width ? Math.min(INLINE_HEIGHT, Math.ceil(size.height * fitScale(frame.width, INLINE_HEIGHT))) : undefined;
  return { viewport, view, frame, fit, actual, zoomAt, pan, inlineHeight };
}
type DiagramView = ReturnType<typeof useDiagramView>;

function ZoomControls({ control }: { control: DiagramView }) {
  const { view, zoomAt, fit, actual } = control;
  return <div className="diagram-zoom" role="group" aria-label="Zoom">
    <button type="button" className="diagram-tool" aria-label="Zoom out" title="Zoom out (−)" disabled={view.scale <= MIN_SCALE} onClick={() => zoomAt(1 / STEP)}><Icon name="zoomOut" size={14}/></button>
    <output className="diagram-scale" aria-live="polite" aria-label="Zoom level">{Math.round(view.scale * 100)}%</output>
    <button type="button" className="diagram-tool" aria-label="Zoom in" title="Zoom in (+)" disabled={view.scale >= MAX_SCALE} onClick={() => zoomAt(STEP)}><Icon name="zoomIn" size={14}/></button>
    <button type="button" className="diagram-tool" aria-label="Fit diagram" title="Fit to view (0)" aria-pressed={view.fitted} onClick={fit}><Icon name="fit" size={14}/></button>
    <button type="button" className="diagram-tool text" aria-label="Actual size" title="Actual size, 100% (1)" onClick={actual}>1:1</button>
  </div>;
}

/** The pannable, zoomable surface: drag, arrows, Ctrl/⌘+wheel, pinch, double-click. */
function DiagramCanvas({ rendered, control, mode, onExpand, label }: { rendered: Rendered; control: DiagramView; mode: 'inline' | 'full'; onExpand?(): void; label: string }) {
  const { viewport, view, zoomAt, pan, fit, actual, inlineHeight } = control;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [dragging, setDragging] = useState(false);
  // Wheel and Safari's gesture events must be non-passive to keep the page from zooming.
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const point = (event: { clientX: number; clientY: number }) => { const box = node.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top] as const; };
    const wheel = (event: WheelEvent) => {
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = Math.max(-50, Math.min(50, event.deltaY * scale));
        zoomAt(Math.exp(-delta * 0.01), ...point(event));
      } else if (mode === 'full') {
        // Full screen there is no page to scroll: the wheel pans.
        event.preventDefault();
        pan(-event.deltaX * scale, -event.deltaY * scale);
      }
    };
    let gestureScale = 1;
    const gestureStart = (event: Event) => { event.preventDefault(); gestureScale = 1; };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      zoomAt(gesture.scale / gestureScale, ...point(gesture)); gestureScale = gesture.scale;
    };
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('gesturestart', gestureStart);
    node.addEventListener('gesturechange', gestureChange);
    return () => { node.removeEventListener('wheel', wheel); node.removeEventListener('gesturestart', gestureStart); node.removeEventListener('gesturechange', gestureChange); };
  }, [viewport, zoomAt, pan, mode]);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const others = [...pointers.current].filter(([id]) => id !== event.pointerId).map(([, p]) => p);
    if (others.length === 1) {
      // Two fingers: zoom by the change in their distance, about their midpoint.
      const other = others[0], box = event.currentTarget.getBoundingClientRect();
      const before = Math.hypot(previous.x - other.x, previous.y - other.y), after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before > 0) zoomAt(after / before, (event.clientX + other.x) / 2 - box.left, (event.clientY + other.y) / 2 - box.top);
    } else if (!others.length) pan(event.clientX - previous.x, event.clientY - previous.y);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const up = (event: PointerEvent<HTMLDivElement>) => { pointers.current.delete(event.pointerId); if (!pointers.current.size) setDragging(false); };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 192 : 48;
    const action: Record<string, () => void> = {
      ArrowLeft: () => pan(step, 0), ArrowRight: () => pan(-step, 0), ArrowUp: () => pan(0, step), ArrowDown: () => pan(0, -step),
      '+': () => zoomAt(STEP), '=': () => zoomAt(STEP), '-': () => zoomAt(1 / STEP), _: () => zoomAt(1 / STEP), '0': fit, '1': actual,
      ...(onExpand ? { f: onExpand, Enter: onExpand } : {}),
    };
    const run = !event.metaKey && !event.ctrlKey && !event.altKey && action[event.key];
    if (run) { event.preventDefault(); run(); }
  };
  const help = useId();
  return <div ref={viewport} className={`diagram-viewport ${mode}${dragging ? ' dragging' : ''}`} style={inlineHeight ? { height: inlineHeight } : undefined}
    tabIndex={0} role="group" aria-roledescription="zoomable diagram" aria-label={label} aria-describedby={help}
    title={mode === 'inline' ? 'Drag to pan · Ctrl/⌘ + scroll or pinch to zoom · double-click to zoom in · Enter for full screen' : undefined}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
    onDoubleClick={event => { const box = event.currentTarget.getBoundingClientRect(); zoomAt(event.shiftKey ? 1 / 2 : 2, event.clientX - box.left, event.clientY - box.top); }}>
    <span id={help} className="diagram-help">Arrow keys pan. Plus and minus zoom. 0 fits the diagram, 1 shows it at actual size.{onExpand ? ' Enter opens it full screen.' : ''}</span>
    <img src={rendered.src} alt="Mermaid diagram" draggable={false} width={Math.round(rendered.width * view.scale)} height={Math.round(rendered.height * view.scale)} style={{ transform: `translate(${view.x}px, ${view.y}px)` }}/>
  </div>;
}

function CopyButton({ text, label, children }: { text: string; label: string; children: ReactNode }) {
  const [state, setState] = useState('');
  useEffect(() => { if (!state) return; const timer = setTimeout(() => setState(''), 1600); return () => clearTimeout(timer); }, [state]);
  return <button type="button" className="diagram-tool text" aria-label={label} title={label} onClick={() => void navigator.clipboard.writeText(text).then(() => setState('Copied'), () => setState('Copy failed'))}>{state || children}</button>;
}

function FullScreenDiagram({ rendered, onClose }: { rendered: Rendered; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const control = useDiagramView(rendered, 'full');
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    node.querySelector<HTMLElement>('.diagram-viewport')?.focus();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} className="diagram-fullscreen" aria-label="Mermaid diagram, full screen" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header>
      <strong>Mermaid diagram</strong>
      <ZoomControls control={control}/>
      <div className="diagram-actions"><CopyButton text={rendered.text} label="Copy Mermaid source">Copy source</CopyButton><CopyButton text={rendered.svg} label="Copy SVG">Copy SVG</CopyButton>
        <button type="button" className="diagram-tool" aria-label="Close full screen" title="Close (Esc)" onClick={onClose}><Icon name="close" size={16}/></button></div>
    </header>
    <DiagramCanvas rendered={rendered} control={control} mode="full" label="Mermaid diagram viewer, full screen"/>
    <footer>Drag, scroll or use the arrow keys to pan · Ctrl/⌘ + scroll, pinch, or + and − to zoom · 0 fits · 1 is actual size · Esc closes</footer>
  </dialog>;
}

function DiagramViewer({ rendered, actions }: { rendered: Rendered; actions: ReactNode }) {
  const control = useDiagramView(rendered, 'inline');
  const [expanded, setExpanded] = useState(false);
  const expand = useRef<HTMLButtonElement>(null);
  const close = () => { setExpanded(false); requestAnimationFrame(() => expand.current?.focus()); };
  return <>
    <header><span>Mermaid diagram</span><div className="diagram-toolbar"><ZoomControls control={control}/>
      <button ref={expand} type="button" className="diagram-tool" aria-label="Open full screen" title="Full screen (Enter)" onClick={() => setExpanded(true)}><Icon name="expand" size={14}/></button>
      {actions}<CopyButton text={rendered.svg} label="Copy SVG">SVG</CopyButton></div></header>
    <DiagramCanvas rendered={rendered} control={control} mode="inline" onExpand={() => setExpanded(true)} label="Mermaid diagram viewer"/>
    {expanded && <FullScreenDiagram rendered={rendered} onClose={close}/>}
  </>;
}

/**
 * A Mermaid block in agent prose: rendered when it nears the screen, then
 * zoomable. `eager` renders it at once: a document has few diagrams, and a
 * printed one must not be a placeholder.
 */
export function MermaidDiagram({ text, sourceView, eager = false }: { text: string; sourceView(text: string): ReactNode; eager?: boolean }) {
  const figure = useRef<HTMLElement>(null);
  const near = useNearViewport(figure) || eager;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [result, setResult] = useState<Rendered | { text: string; error: string }>();
  const [source, setSource] = useState(false);
  // A new theme redraws the diagram in its colours.
  const look = useAppearance(), lookKey = `${look.theme.id}|${look.theme.tokens.accent}|${look.theme.tokens.surface}|${look.theme.tokens.text}|${look.typography.uiFont}`;
  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    // Debounce partial fenced blocks while the answer is streaming.
    const timer = setTimeout(() => { void (async () => {
      try {
        if (text.length > 50000) throw Error('Diagram is too large to preview.');
        const mermaid = await diagrams();
        if (cancelled) return;
        const { svg } = await mermaid.render(`diagram-${id}`, text);
        const sized = sizedSvg(svg);
        if (!sized) throw Error('Diagram has no size.');
        if (!cancelled) setResult({ ...sized, text });
      } catch { if (!cancelled) setResult({ text, error: 'Diagram preview unavailable. Check the Mermaid source.' }); }
    })(); }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, id, near, lookKey]);
  const current = result?.text === text ? result : undefined;
  const sourceToggle = <button type="button" className="diagram-tool text" aria-pressed={source} title={source ? 'Show the diagram' : 'Show the Mermaid source'} onClick={() => setSource(!source)}>{source ? 'Diagram' : 'Source'}</button>;
  const copySource = <CopyButton text={text} label="Copy Mermaid source">Copy</CopyButton>;
  return <figure ref={figure} className="mermaid-block">
    {current && 'svg' in current && !source
      ? <DiagramViewer rendered={current} actions={<>{sourceToggle}{copySource}</>}/>
      : <>
        <header><span>Mermaid diagram</span><div className="diagram-toolbar">{current && 'svg' in current && sourceToggle}{copySource}</div></header>
        {current && 'error' in current && <p role="status">{current.error}</p>}
        {source || (current && 'error' in current) ? sourceView(text) : <p role="status" className="diagram-pending" style={{ minHeight: 120 }}>Rendering diagram…</p>}
      </>}
  </figure>;
}
