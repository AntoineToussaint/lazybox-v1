import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ImageCache, PREVIEWABLE, formatBytes, isLocalImage, loadImage, placePreview, releaseImage, type LoadedImage, type PreviewPlacement } from './attachment-images';
import { ImageLightbox } from './ImageLightbox';
import { Icon } from './Icons';
import { useRunner } from './RunnerContext';
import './attachments.css';

/** How long a pointer rests on a thumbnail before the preview opens; passing over one does not flash it. */
const HOVER_DELAY_MS = 160;
/** The preview fits in this share of the window. */
const PREVIEW_SHARE = 0.6;
/** The preview card's padding, border and caption around the image (attachments.css). */
const CARD_CHROME = { width: 14, height: 40 };

type Loading = { state: 'loading' } | { state: 'ready'; image: LoadedImage } | { state: 'failed'; reason: string };

/**
 * A picture-sized button for one image. Resting the pointer on it, or moving
 * keyboard focus to it, shows the image larger in a floating card; clicking
 * (or Enter) opens it full size.
 */
function ImageThumbnail({ name, size, loading, variant }: { name: string; size: number; loading: Loading; variant: 'composer' | 'sent' }) {
  const button = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (delay: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setPreview(true), delay); };
  const hide = useCallback(() => { window.clearTimeout(timer.current); setPreview(false); }, []);
  const image = loading.state === 'ready' ? loading.image : undefined;
  // A sent image keeps its shape at a fixed height; a composer chip is a square.
  const style: CSSProperties | undefined = variant === 'sent' && image?.width && image.height ? { width: `${Math.min(200, Math.max(48, Math.round(88 * image.width / image.height)))}px` } : undefined;
  const label = loading.state === 'failed' ? `${name}, ${formatBytes(size)} · preview unavailable` : `${name}, ${formatBytes(size)}`;
  return <>
    <button ref={button} type="button" className={`attachment-thumb ${variant === 'composer' ? 'draft-thumb' : 'sent-thumb'}`} data-state={loading.state} style={style}
      aria-label={`Open ${label}`} aria-haspopup="dialog" disabled={!image}
      onPointerEnter={event => { if (event.pointerType === 'mouse') show(HOVER_DELAY_MS); }} onPointerLeave={hide}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) show(0); }} onBlur={hide}
      onKeyDown={event => { if (event.key === 'Escape' && preview) { event.preventDefault(); event.stopPropagation(); hide(); } }}
      onClick={() => { hide(); if (image) setOpen(true); }}>
      {image ? <img src={image.thumb} alt="" decoding="async" draggable={false}/> : <span className="attachment-thumb-placeholder" aria-hidden="true"><Icon name="image" size={variant === 'sent' ? 20 : 18}/></span>}
    </button>
    {preview && image && button.current && <ImagePreview anchor={button.current} image={image} name={name} onClose={hide}/>}
    {open && image && <ImageLightbox image={image} name={name} onClose={() => setOpen(false)}/>}
  </>;
}

/**
 * The enlarged image beside its thumbnail (placePreview says where). It never
 * takes the pointer, so it cannot cover what it previews and trap the hover;
 * it follows the window's size and closes when what is under it scrolls.
 */
function ImagePreview({ anchor, image, name, onClose }: { anchor: HTMLElement; image: LoadedImage; name: string; onClose(): void }) {
  // An image that could not be decoded ahead is measured once it shows.
  const [natural, setNatural] = useState<{ width: number; height: number }>({ width: image.width, height: image.height });
  const [placement, setPlacement] = useState<PreviewPlacement | null>(null);
  useLayoutEffect(() => {
    if (!natural.width) return;
    const place = () => setPlacement(placePreview(anchor.getBoundingClientRect(), natural, { width: window.innerWidth, height: window.innerHeight }, { share: PREVIEW_SHARE, chrome: CARD_CHROME }));
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, natural]);
  useEffect(() => {
    const scrolled = (event: Event) => { if (event.target instanceof Node && event.target.contains(anchor)) onClose(); };
    window.addEventListener('scroll', scrolled, true);
    return () => window.removeEventListener('scroll', scrolled, true);
  }, [anchor, onClose]);
  const details = [natural.width && natural.height ? `${natural.width} × ${natural.height}` : '', formatBytes(image.size)].filter(Boolean).join(' · ');
  return createPortal(<div className="attachment-preview" role="tooltip" data-placed={placement ? placement.side : undefined}
    style={placement ? { left: placement.left, top: placement.top } : undefined}>
    <img src={image.url} alt="" decoding="async" style={placement ? { width: placement.width, height: placement.height } : undefined}
      onLoad={event => { if (!natural.width) setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }}/>
    <div className="attachment-preview-caption"><span>{name}</span><small>{details}</small></div>
  </div>, document.body);
}

/** One file attached to the message being written: an image as its thumbnail, anything else as a named chip. */
export function ComposerAttachment({ file, disabled, onRemove }: { file: File; disabled?: boolean; onRemove(): void }) {
  const image = isLocalImage(file);
  const [loading, setLoading] = useState<Loading>({ state: 'loading' });
  useEffect(() => {
    if (!image) return;
    let alive = true, loaded: LoadedImage | undefined;
    setLoading({ state: 'loading' });
    void loadImage(file).then(value => { loaded = value; if (alive) setLoading({ state: 'ready', image: value }); else releaseImage(value); });
    return () => { alive = false; if (loaded) releaseImage(loaded); };
  }, [file, image]);
  const remove = <button type="button" className="attachment-remove" aria-label={`Remove ${file.name}`} title="Remove" disabled={disabled} onClick={onRemove}><Icon name="close" size={12}/></button>;
  // A file that says it is an image but does not decode is shown by its name, not as a broken picture.
  if (loading.state === 'ready' && !loading.image.width) return <li className="attachment-chip file" title="This image could not be previewed; it is still sent"><Icon name="image" size={16}/><span className="attachment-name" title={file.name}>{file.name}</span><small>{formatBytes(file.size)}</small>{remove}</li>;
  if (!image) return <li className="attachment-chip file"><Icon name="file" size={16}/><span className="attachment-name" title={file.name}>{file.name}</span><small>{formatBytes(file.size)}</small>{remove}</li>;
  return <li className="attachment-chip image"><ImageThumbnail name={file.name} size={file.size} loading={loading} variant="composer"/>{remove}</li>;
}

export type SentFile = { name: string; size: number; mediaType?: string; path?: string };

/** Sent images of every conversation in this window, by Runner path. */
const sentImages = new ImageCache();

/** One image a sent message carried, fetched from the Runner once it scrolls into view. */
function SentImage({ file }: { file: SentFile & { path: string } }) {
  const { api } = useRunner();
  const holder = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState<Loading>({ state: 'loading' });
  useEffect(() => {
    const node = holder.current; if (!node || visible) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: '200px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    sentImages.acquire(file.path, async () => {
      const content = await api.readAttachment({ path: file.path });
      return new Blob([content.data as Uint8Array<ArrayBuffer>], { type: content.mediaType });
    }).then(image => { if (alive) setLoading(image.width ? { state: 'ready', image } : { state: 'failed', reason: 'the image could not be decoded' }); }, error => { if (alive) setLoading({ state: 'failed', reason: error instanceof Error ? error.message : String(error) }); });
    return () => { alive = false; sentImages.release(file.path); };
  }, [visible, file.path, api]);
  if (loading.state === 'failed') return <li ref={holder} className="attachment-chip file" title={`Preview unavailable: ${loading.reason}`}><Icon name="image" size={16}/><span className="attachment-name">{file.name}</span><small>{formatBytes(file.size)}</small></li>;
  return <li ref={holder} className="attachment-chip image"><ImageThumbnail name={file.name} size={file.size} loading={loading} variant="sent"/></li>;
}

/** The files a sent message carried: images as thumbnails, the rest as named chips. */
export function SentAttachments({ files }: { files: SentFile[] }) {
  return <ul className="sent-files" aria-label="Sent attachments">{files.map((file, i) => file.path && PREVIEWABLE.test(file.mediaType || '')
    ? <SentImage key={i} file={file as SentFile & { path: string }}/>
    : <li key={i} className="attachment-chip file"><Icon name="file" size={16}/><span className="attachment-name" title={file.name}>{file.name}</span><small>{formatBytes(file.size)}</small></li>)}</ul>;
}
