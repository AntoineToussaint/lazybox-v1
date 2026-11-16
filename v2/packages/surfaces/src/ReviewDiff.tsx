import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import hljs from 'highlight.js/lib/core';
import type { ReviewComment } from '@lazybox/protocol';
import './RichContent';
import { ReviewComposer, ReviewThread } from './ReviewThread';
import { isLine, languageOf, linesLabel, parseDiff, placeComment, selectionTarget, type DiffRow, type ReviewView } from './review-model';
import { useWorkspaceReview } from './useWorkspaceReview';
import './review.css';
import { contextMenu, copyText } from './ContextMenu';

type Range = { anchor: number; end: number };
const HIGHLIGHT_LIMIT = 6000;
const GIT_HEADER = /^(diff --git |index |--- |\+\+\+ )/;

/** A file's diff you can comment on: click + beside a line (or drag, or
 * Shift-click to extend) to comment on one line or a range; saved comments
 * show as threads under their lines. Comments whose lines are not in this
 * diff (outdated, or outside its hunks) are listed above it with their quote. */
export type ReviewFocus = { id: string; nonce: number };
export function ReviewDiff({ workspaceId, member, path, text, view, base, focus }: { workspaceId: string; member: string; path: string; text: string; view: ReviewView; base: string; focus?: ReviewFocus }) {
  const review = useWorkspaceReview(workspaceId);
  const rows = useMemo(() => parseDiff(text), [text]);
  const language = languageOf(path);
  const highlighted = useMemo(() => {
    const known = language && hljs.getLanguage(language);
    if (!known || rows.length > HIGHLIGHT_LIMIT) return undefined;
    return rows.map(row => isLine(row) ? hljs.highlight(row.text, { language, ignoreIllegals: true }).value : '');
  }, [rows, language]);
  const [range, setRange] = useState<Range>(), [composing, setComposing] = useState(false);
  const dragging = useRef(false);
  // What was typed survives changing the range, which moves the composer.
  const draft = useRef('');
  // A different file or diff starts afresh.
  useEffect(() => { setRange(undefined); setComposing(false); draft.current = ''; }, [member, path, text]);
  useEffect(() => { const stop = () => { if (dragging.current) { dragging.current = false; setComposing(true); } }; window.addEventListener('pointerup', stop); return () => window.removeEventListener('pointerup', stop); }, []);

  const { placed, unplaced, marked } = useMemo(() => {
    const comments = review.comments.filter(c => c.member === member && c.path === path);
    const placed = new Map<number, ReviewComment[]>(), unplaced: ReviewComment[] = [], marked = new Set<number>();
    for (const comment of comments) {
      const row = placeComment(rows, comment);
      if (row === undefined) { unplaced.push(comment); continue; }
      placed.set(row, [...(placed.get(row) || []), comment]);
      // Mark every line the comment covers, walking back along its side.
      let left = comment.snippet.length;
      for (let i = row; i >= 0 && left > 0; i--) { const r = rows[i]; if (isLine(r) && (comment.side === 'old' ? r.type !== 'add' : r.type !== 'del')) { marked.add(i); left--; } }
    }
    return { placed, unplaced, marked };
  }, [rows, review.comments, member, path]);
  const target = range ? selectionTarget(rows, range.anchor, range.end) : undefined;
  const selected = useMemo(() => {
    const out = new Set<number>();
    if (!range || !target) return out;
    const from = Math.min(range.anchor, range.end), to = target.lastRow;
    for (let i = from; i <= to; i++) if (isLine(rows[i]) && rows[i].hunk === rows[range.anchor].hunk) out.add(i);
    return out;
  }, [range, target, rows]);

  const start = (index: number, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.shiftKey && range) { setRange({ anchor: range.anchor, end: index }); setComposing(true); return; }
    dragging.current = true; setComposing(false); setRange({ anchor: index, end: index });
  };
  const extend = (index: number) => { if (dragging.current && range && rows[index]?.hunk === rows[range.anchor].hunk) setRange({ anchor: range.anchor, end: index }); };
  const keyboard = (index: number, shift: boolean) => { setRange(shift && range ? { anchor: range.anchor, end: index } : { anchor: index, end: index }); setComposing(true); };
  const cancel = () => { setComposing(false); setRange(undefined); draft.current = ''; };
  const save = async (body: string) => {
    if (!target) return;
    await review.add({ member, path, side: target.side, startLine: target.startLine, snippet: target.snippet, body, view, base });
    setComposing(false); setRange(undefined); draft.current = '';
  };

  const lineNumber = (row: DiffRow) => isLine(row) ? (row.type === 'del' ? row.oldLine : row.newLine) : undefined;
  return <div className="review-diff-wrap">
    {review.error && review.loaded && !review.review && <p className="review-muted" role="status">Review comments unavailable: {review.error}</p>}
    {unplaced.length > 0 && <section className="review-elsewhere" aria-label="Comments not on lines in this diff">
      <h4>{unplaced.length === 1 ? '1 comment' : `${unplaced.length} comments`} on lines not in this diff</h4>
      {unplaced.map(comment => <ReviewThread key={comment.id} comment={comment} review={review} quote focused={focus?.id === comment.id} focusNonce={focus?.nonce}/>)}
    </section>}
    <div className="review-diff" role="grid" aria-label="File diff" aria-multiselectable="true">
      {rows.map((row, index) => {
        // The file header repeats what the panel's title already says.
        if (row.kind === 'meta' && GIT_HEADER.test(row.text)) return null;
        if (!isLine(row)) return <div key={index} role="row" className={`review-row is-${row.kind}`}><span role="gridcell" className="review-meta">{row.text}</span></div>;
        const number = lineNumber(row)!, side = row.type === 'del' ? 'removed line' : 'line';
        const threads = placed.get(index);
        const composerHere = composing && target && target.lastRow === index;
        return <Fragment key={index}>
          <div role="row" aria-selected={selected.has(index)} className={`review-row is-${row.type}${selected.has(index) ? ' is-selected' : ''}${marked.has(index) ? ' is-commented' : ''}`} onPointerEnter={() => extend(index)}
            onContextMenu={contextMenu('diff-line', () => [
              selected.size > 1 && selected.has(index)
                ? { label: `Comment on ${linesLabel(target!.side, target!.startLine, target!.endLine).toLowerCase()}`, icon: 'chat', run: () => setComposing(true) }
                : { label: 'Add review comment', icon: 'chat', run: () => keyboard(index, false) },
              { label: 'Copy line', icon: 'copy', run: () => copyText(row.text, 'Copied line') },
            ], { member, path, line: number, side: row.type === 'del' ? 'old' : 'new' })}>
            <span role="gridcell" className="review-number">{row.oldLine ?? ''}</span>
            <span role="gridcell" className="review-number">{row.newLine ?? ''}</span>
            <span role="gridcell" className="review-gutter">
              <button type="button" className="review-add" aria-label={`Comment on ${side} ${number}`} title="Comment on this line · drag or Shift-click to choose several"
                onPointerDown={event => start(index, event)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); keyboard(index, event.shiftKey); } }}>+</button>
            </span>
            <span role="gridcell" className="review-code"><span className="review-sign">{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}</span>{highlighted ? <span dangerouslySetInnerHTML={{ __html: highlighted[index] || ' ' }}/> : row.text || ' '}</span>
          </div>
          {composerHere && <div className="review-inline"><ReviewComposer initial={draft.current} onDraft={text => { draft.current = text; }} label={`Comment on ${linesLabel(target.side, target.startLine, target.endLine).toLowerCase()}`} submitLabel="Add comment" onCancel={cancel} onSubmit={save}/>
            <small className="review-hint">{linesLabel(target.side, target.startLine, target.endLine)} · Shift-click another line to change the range</small></div>}
          {threads && <div className="review-inline">{threads.map(comment => <ReviewThread key={comment.id} comment={comment} review={review} focused={focus?.id === comment.id} focusNonce={focus?.nonce}/>)}</div>}
        </Fragment>;
      })}
    </div>
  </div>;
}
