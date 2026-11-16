import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { MenuAction } from './context-menu-model';

/**
 * The action registry: every command of the app, declared once.
 *
 * A definition says what an action is (title, group, icon, default keys,
 * where it can fire). Its behaviour comes from whoever is mounted for it: a
 * component registers a handler with `useAction`, optionally with a
 * when-enabled predicate. The keymap, the `]]` which-key menu, the command
 * palette, the shortcuts overlay, the macOS menu bar and context menus all
 * read this one list, so they cannot drift apart.
 *
 * Keys are written as KeyboardEvent names joined by `+` for a chord
 * (`Meta+k`, `Ctrl+Shift+p`), spaces between the keys of a sequence
 * (`] ] i`), and ` or ` between alternatives (`Meta+k or ] ] p`). `Mod+` in a
 * default is ⌘ on a Mac and Ctrl elsewhere; saved keymaps hold the resolved key.
 */
export type ActionScope = 'global' | 'navigation' | 'agent';
export type ActionGroup = 'General' | 'Go to' | 'Workspace' | 'Conversation' | 'Sidebar' | 'Message box';
export type MenuSection = 'File' | 'Go' | 'Help';
export type ActionDefinition = {
  id: string;
  title: string;
  group: ActionGroup;
  icon: string;
  /** Default keys, before `Mod+` is resolved for the platform; '' for none. */
  keys: string;
  scope: ActionScope;
  /** Extra words the palette matches ("cheatsheet" finds the shortcuts). */
  keywords?: string;
  /** Listed in the command palette (default true). */
  palette?: boolean;
  /** The native menu (desktop) lists it under this menu, with this title. */
  menu?: { section: MenuSection; title: string; separatorBefore?: boolean };
  /** Runs even while a dialog is open (it opens or closes one of its own). */
  overDialogs?: boolean;
  /** The settings refuse an empty shortcut. */
  required?: boolean;
  /** Members of a numbered series ("Go to workspace 1…9") share this. */
  series?: string;
};

const workspaceSlots = Array.from({ length: 9 }, (_, i) => i + 1);

const head = [
  { id: 'palette.open', title: 'Command palette', group: 'General', icon: 'search', keys: 'Mod+k or Mod+Shift+p or ] ] p', scope: 'global', palette: false, overDialogs: true, keywords: 'commands actions search run', menu: { section: 'Go', title: 'Command Palette…' } },
  { id: 'shortcuts.open', title: 'Keyboard shortcuts', group: 'General', icon: 'keyboard', keys: '? or Mod+/ or ] ] ?', scope: 'global', overDialogs: true, keywords: 'keys keymap help cheatsheet bindings', menu: { section: 'Help', title: 'Keyboard Shortcuts' } },
  { id: 'settings.open', title: 'Open settings', group: 'General', icon: 'sliders', keys: 'Mod+,', scope: 'global', keywords: 'preferences options configure' },
  { id: 'appearance.toggle', title: 'Switch between light and dark', group: 'General', icon: 'contrast', keys: '', scope: 'global', keywords: 'theme dark light mode appearance colour color' },
  { id: 'inbox.open', title: 'Open the inbox', group: 'General', icon: 'inbox', keys: '] ] i', scope: 'global', keywords: 'attention notifications waiting', menu: { section: 'Go', title: 'Inbox' } },
  { id: 'attention.next', title: 'Next conversation that needs you', group: 'Go to', icon: 'bell', keys: 'Mod+j or ] ] n', scope: 'global', keywords: 'agent waiting approval question failed review jump', menu: { section: 'Go', title: 'Next Conversation That Needs You', separatorBefore: true } },
  { id: 'attention.previous', title: 'Previous conversation that needs you', group: 'Go to', icon: 'bell', keys: 'Mod+Shift+j', scope: 'global', keywords: 'agent waiting approval question failed review jump back', menu: { section: 'Go', title: 'Previous Conversation That Needs You' } },
  { id: 'conversation.next', title: 'Next conversation in this workspace', group: 'Go to', icon: 'chevronRight', keys: 'Mod+]', scope: 'global', keywords: 'agent down', menu: { section: 'Go', title: 'Next Conversation' } },
  { id: 'conversation.previous', title: 'Previous conversation in this workspace', group: 'Go to', icon: 'back', keys: 'Mod+[', scope: 'global', keywords: 'agent up', menu: { section: 'Go', title: 'Previous Conversation' } },
] as const satisfies readonly ActionDefinition[];
type Slot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
const slotDefinitions = workspaceSlots.map((n): ActionDefinition & { id: `workspace.select.${Slot}` } => ({ id: `workspace.select.${n as Slot}`, title: `Go to workspace ${n}`, group: 'Go to', icon: 'collections', keys: `Mod+${n}`, scope: 'global', palette: false, series: 'workspace.select' }));
const tail = [
  { id: 'files.find', title: 'Go to file', group: 'Go to', icon: 'search', keys: '] ] f or Mod+p', scope: 'global', keywords: 'open file quick', menu: { section: 'Go', title: 'Go to File…', separatorBefore: true } },
  { id: 'navigation.exit', title: 'Focus the sidebar', group: 'Go to', icon: 'sidebar', keys: '] ]', scope: 'global', required: true, keywords: 'leave agent navigation leader' },
  { id: 'workspace.new', title: 'New workspace', group: 'Workspace', icon: 'plus', keys: '] ] w', scope: 'global', keywords: 'create add repositories', menu: { section: 'File', title: 'New Workspace…' } },
  { id: 'conversation.new', title: 'New conversation', group: 'Workspace', icon: 'chat', keys: '] ] c', scope: 'global', keywords: 'start agent session chat', menu: { section: 'File', title: 'New Conversation…' } },
  { id: 'changes.show', title: 'Review changes', group: 'Workspace', icon: 'branch', keys: '] ] d', scope: 'global', keywords: 'diff git commit pull request' },
  { id: 'files.explorer', title: 'Browse files', group: 'Workspace', icon: 'folder', keys: '] ] e', scope: 'global', keywords: 'explorer tree' },
  { id: 'terminal.open', title: 'Open a terminal', group: 'Workspace', icon: 'terminal', keys: '', scope: 'global', keywords: 'shell console' },
  { id: 'artifacts.open', title: 'Show artifacts', group: 'Workspace', icon: 'artifact', keys: '] ] a', scope: 'global', keywords: 'documents reports' },
  { id: 'web.open', title: 'Open a web page', group: 'Workspace', icon: 'globe', keys: '] ] b', scope: 'global', keywords: 'browser web viewer url link site preview', menu: { section: 'File', title: 'New Web Panel' } },
  { id: 'console.toggle', title: 'Show or hide command output', group: 'Workspace', icon: 'output', keys: '] ] o', scope: 'global', keywords: 'console close open log run tests' },
  { id: 'workspace.window', title: 'Open this workspace in a new window', group: 'Workspace', icon: 'external', keys: '', scope: 'global', keywords: 'detach' },
  { id: 'page.customize', title: 'Customize this page', group: 'Workspace', icon: 'pencil', keys: '', scope: 'global', keywords: 'layout panels edit arrange' },
  { id: 'layout.configure', title: 'Layout configuration', group: 'Workspace', icon: 'sliders', keys: '', scope: 'global', keywords: 'json import export' },
  { id: 'snippets.open', title: 'Open snippets', group: 'Conversation', icon: 'snippets', keys: '] ] s', scope: 'global', keywords: 'prompt template' },
  { id: 'composer.focus', title: 'Focus the message box', group: 'Conversation', icon: 'chat', keys: '', scope: 'global', keywords: 'type write composer prompt' },
  // Activity detail of the conversation in front (activity-detail.ts).
  { id: 'activity.cycle', title: 'Cycle activity detail', group: 'Conversation', icon: 'activity', keys: '] ] v', scope: 'global', keywords: 'quiet smart verbose tool calls commands steps noise collapse expand detail' },
  { id: 'activity.quiet', title: 'Activity detail: Quiet', group: 'Conversation', icon: 'collapse', keys: '', scope: 'global', keywords: 'tool calls commands steps hide less noise minimal' },
  { id: 'activity.smart', title: 'Activity detail: Smart', group: 'Conversation', icon: 'sparkle', keys: '', scope: 'global', keywords: 'tool calls commands steps summary group collapse' },
  { id: 'activity.verbose', title: 'Activity detail: Verbose', group: 'Conversation', icon: 'expand', keys: '', scope: 'global', keywords: 'tool calls commands steps every line all full show' },
  { id: 'activity.default', title: 'Activity detail: Use the default', group: 'Conversation', icon: 'refresh', keys: '', scope: 'global', keywords: 'tool calls commands reset settings' },
  // The agent's latest shell code block (code-runs.tsx).
  { id: 'code.run-last', title: 'Run the last command block', group: 'Conversation', icon: 'play', keys: '] ] r', scope: 'global', keywords: 'shell bash script execute code block agent ask' },
  { id: 'code.run-last-myself', title: 'Run the last command block myself…', group: 'Conversation', icon: 'terminal', keys: '', scope: 'global', keywords: 'shell bash script execute code block console yourself' },
  { id: 'navigation.next', title: 'Next entry', group: 'Sidebar', icon: 'chevron', keys: 'j', scope: 'navigation', palette: false },
  { id: 'navigation.previous', title: 'Previous entry', group: 'Sidebar', icon: 'up', keys: 'k', scope: 'navigation', palette: false },
  { id: 'navigation.parent', title: 'Workspace / left pane', group: 'Sidebar', icon: 'back', keys: 'h', scope: 'navigation', palette: false },
  { id: 'navigation.open', title: 'Open entry / agent', group: 'Sidebar', icon: 'chevronRight', keys: 'l', scope: 'navigation', palette: false },
  { id: 'chat.send', title: 'Send message', group: 'Message box', icon: 'send', keys: 'Enter', scope: 'agent', palette: false, required: true },
  { id: 'help.welcome', title: 'Welcome and getting started', group: 'General', icon: 'sparkle', keys: '', scope: 'global', overDialogs: true, keywords: 'onboarding first run start tour help', menu: { section: 'Help', title: 'Welcome to Lazybox', separatorBefore: true } },
  { id: 'help.whats-new', title: "What's new", group: 'General', icon: 'notes', keys: '', scope: 'global', overDialogs: true, keywords: 'release notes changelog update version help', menu: { section: 'Help', title: "What's New" } },
  { id: 'help.docs', title: 'Documentation', group: 'General', icon: 'notes', keys: '', scope: 'global', keywords: 'docs manual guide help', menu: { section: 'Help', title: 'Lazybox Documentation' } },
] as const satisfies readonly ActionDefinition[];

export type ActionId = (typeof head)[number]['id'] | (typeof tail)[number]['id'] | `workspace.select.${Slot}`;
export const actionDefinitions: readonly (ActionDefinition & { id: ActionId })[] = [...head, ...slotDefinitions, ...tail];
export const actionGroups: readonly ActionGroup[] = ['General', 'Go to', 'Workspace', 'Conversation', 'Sidebar', 'Message box'];
const byId = new Map<string, ActionDefinition>(actionDefinitions.map(definition => [definition.id, definition]));
export function actionDefinition(id: string): ActionDefinition | undefined { return byId.get(id); }

// ---- Keys ----------------------------------------------------------------

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const modifierOrder = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const;
/** The alternatives of one keymap value: "Meta+k or ] ] p" → ["Meta+k", "] ] p"]. */
export function bindings(value: string | undefined): string[] {
  return (value || '').split(/\s+or\s+/).map(binding => binding.trim().replace(/\s+/g, ' ')).filter(Boolean);
}
export function joinBindings(values: readonly string[]): string { return values.join(' or '); }
/** One key with its modifiers in a fixed order, a lone letter lowercased: "Shift+Meta+P" → "Meta+Shift+p". */
export function canonicalKey(key: string): string {
  const parts = key.split('+');
  // "Meta++" names the plus key itself.
  let name = parts.pop() || '';
  if (!name && parts.length) { parts.pop(); name = '+'; }
  const modifiers = new Set(parts.map(part => part === 'Cmd' || part === 'Command' ? 'Meta' : part === 'Control' ? 'Ctrl' : part === 'Option' ? 'Alt' : part));
  if (name.length === 1) name = name.toLowerCase();
  return [...modifierOrder.filter(modifier => modifiers.has(modifier)), name].map((part, i, all) => i === all.length - 1 ? part : part + '+').join('');
}
export function canonicalBinding(binding: string): string { return binding.trim().split(/\s+/).map(canonicalKey).join(' '); }
/** Resolve `Mod+` for a platform: ⌘ on a Mac, Ctrl elsewhere. */
export function resolveMod(value: string, mac = isMac): string {
  return joinBindings(bindings(value).map(binding => canonicalBinding(binding.replaceAll('Mod+', mac ? 'Meta+' : 'Ctrl+'))));
}
/** A chord is one key held with Ctrl or ⌘: it fires even from a text field. */
export function isChord(binding: string): boolean {
  const keys = binding.trim().split(/\s+/);
  return keys.length === 1 && /(?:^|\+)(?:Ctrl|Meta)\+/.test(keys[0]);
}
const symbols: Record<string, string> = { ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Enter: '↵', Escape: 'Esc', Backspace: '⌫', Delete: '⌦', Tab: '⇥', Space: 'Space', PageUp: 'Page Up', PageDown: 'Page Down' };
/** How one key of a binding reads on screen: "Meta+Shift+p" → "⇧⌘P" on a Mac, "Ctrl+Shift+P" elsewhere. */
export function displayKey(key: string, mac = isMac): string {
  const canonical = canonicalKey(key), parts = canonical.split('+');
  let name = parts.pop() || ''; if (!name) { parts.pop(); name = '+'; }
  const modifiers = new Set(parts);
  const chord = modifiers.has('Ctrl') || modifiers.has('Meta') || modifiers.has('Alt');
  const shown = symbols[name] || (chord && name.length === 1 ? name.toUpperCase() : name);
  if (mac) return [modifiers.has('Ctrl') ? '⌃' : '', modifiers.has('Alt') ? '⌥' : '', modifiers.has('Shift') ? '⇧' : '', modifiers.has('Meta') ? '⌘' : '', shown].join('');
  return [modifiers.has('Ctrl') ? 'Ctrl+' : '', modifiers.has('Meta') ? 'Win+' : '', modifiers.has('Alt') ? 'Alt+' : '', modifiers.has('Shift') ? 'Shift+' : '', shown].join('');
}
/** Every key of a binding as it reads on screen: "] ] i" → ["]", "]", "i"]. */
export function displayBinding(binding: string, mac = isMac): string[] { return binding.trim().split(/\s+/).filter(Boolean).map(key => displayKey(key, mac)); }

/** The key a chord was pressed as, by physical key, so ⌥ and ⇧ do not change the letter. */
const codeNames: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=', Space: 'Space' };
export function chordFromEvent(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const code = event.code || '';
  const name = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5) : codeNames[code] || (event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return `${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Meta+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${name}`;
}

// ---- Handlers ------------------------------------------------------------

type Handler = { run(argument?: unknown): void; enabled?(): boolean };
const handlers = new Map<string, Set<{ current: Handler }>>();
let revision = 0;
const listeners = new Set<() => void>();
const changed = () => { revision++; for (const listener of listeners) listener(); };
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Register handlers for actions while mounted; `false` registers nothing. Latest callbacks are used. */
export function useActions(record: Partial<Record<ActionId, Handler | Handler['run'] | false | undefined>>) {
  const refs = useRef(new Map<string, { current: Handler }>());
  const ids = Object.keys(record).filter(id => record[id as ActionId]).sort().join('|');
  for (const [id, value] of Object.entries(record) as [string, Handler | Handler['run'] | false | undefined][]) {
    if (!value) continue;
    const handler = typeof value === 'function' ? { run: value } : value;
    const ref = refs.current.get(id);
    if (ref) ref.current = handler; else refs.current.set(id, { current: handler });
  }
  useEffect(() => {
    const mine = ids ? ids.split('|') : [];
    for (const id of mine) {
      const ref = refs.current.get(id)!;
      if (!handlers.has(id)) handlers.set(id, new Set());
      handlers.get(id)!.add(ref);
    }
    changed();
    return () => { for (const id of mine) { const ref = refs.current.get(id); if (ref) handlers.get(id)?.delete(ref); } changed(); };
  }, [ids]);
}
/** One handler for one action while mounted. */
export function useAction(id: ActionId, run: (argument?: unknown) => void, enabled?: () => boolean) {
  useActions({ [id]: { run, enabled } } as Partial<Record<ActionId, Handler>>);
}
function enabledHandlers(id: string) {
  return [...handlers.get(id) || []].filter(ref => { try { return ref.current.enabled?.() !== false; } catch { return false; } });
}
/** Whether something in this window can run the action now. */
export function actionEnabled(id: string): boolean { return enabledHandlers(id).length > 0; }
/** Re-renders when handlers come and go. */
export function useActionRevision(): number { return useSyncExternalStore(subscribe, () => revision); }

let lastKeyRun = { id: '', at: 0 };
/**
 * Run an action: every enabled handler in this window, plus listeners of the
 * `lazybox-action` event (the sidebar's j/k navigation). True when a handler ran.
 */
export function runAction(id: string, argument?: unknown, source: 'keys' | 'menu' | 'palette' | 'other' = 'other'): boolean {
  if (source === 'keys') lastKeyRun = { id, at: Date.now() };
  const ready = enabledHandlers(id);
  for (const ref of ready) ref.current.run(argument);
  window.dispatchEvent(new CustomEvent('lazybox-action', { detail: id }));
  return ready.length > 0;
}
/**
 * From the native menu. If the webview already took the key that the menu
 * item names (both saw it), the action ran from the keyboard a moment ago.
 */
export function runMenuAction(id: string): boolean {
  if (lastKeyRun.id === id && Date.now() - lastKeyRun.at < 400) return false;
  return runAction(id, undefined, 'menu');
}

// ---- Views of the registry ----------------------------------------------

export type ResolvedAction = { id: ActionId; title: string; group: ActionGroup; icon: string; keys: string[]; enabled: boolean; run(argument?: unknown): void };
/**
 * Actions by id or group with the current keys and enablement: what a context
 * menu or toolbar shows. `keymap` maps ids to their keys (see keyboard.ts).
 */
export function actionsFor(selector: { ids?: readonly ActionId[]; group?: ActionGroup }, keymap?: Partial<Record<string, string>>): ResolvedAction[] {
  const chosen = selector.ids ? selector.ids.map(id => byId.get(id)).filter((d): d is ActionDefinition => !!d) : actionDefinitions.filter(d => !selector.group || d.group === selector.group);
  return chosen.map(definition => ({
    id: definition.id as ActionId, title: definition.title, group: definition.group, icon: definition.icon,
    keys: bindings(keymap ? keymap[definition.id] : resolveMod(definition.keys)),
    enabled: actionEnabled(definition.id), run: (argument?: unknown) => { runAction(definition.id, argument); },
  }));
}
/**
 * Context-menu items (ContextMenu's `MenuAction`) for actions by id, with the
 * person's first key as the hint: `registerContextMenu(scope, () => actionMenuItems([...], keymap))`.
 */
export function actionMenuItems(ids: readonly ActionId[], keymap?: Partial<Record<string, string>>): MenuAction[] {
  return actionsFor({ ids }, keymap).map(action => ({ label: action.title, icon: action.icon, shortcut: action.keys[0] ? displayBinding(action.keys[0]).join(' ') : undefined, disabled: !action.enabled, run: () => action.run() }));
}

/** What the native menu bar shows: the menu entries with their first chord as the accelerator. */
export type NativeMenuItem = { id: string; title: string; section: MenuSection; accelerator?: string; separatorBefore: boolean };
export function nativeMenuItems(keymap: Partial<Record<string, string>>): NativeMenuItem[] {
  const accelerator = (binding: string) => binding.split('+').map((part, i, all) => i < all.length - 1 ? ({ Meta: 'Cmd', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' } as Record<string, string>)[part] || part : part.length === 1 ? part.toUpperCase() : part).join('+');
  return actionDefinitions.flatMap(definition => {
    const menu = (definition as ActionDefinition).menu;
    if (!menu) return [];
    const chord = bindings(keymap[definition.id]).find(isChord);
    return [{ id: `action:${definition.id}`, title: menu.title, section: menu.section, accelerator: chord ? accelerator(chord) : undefined, separatorBefore: !!menu.separatorBefore }];
  });
}
