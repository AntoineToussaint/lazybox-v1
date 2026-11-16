import { readPreference, writePreference } from "./view-state";
import { useEffect, useRef, useState } from "react";
import type { ViewStateStore } from "@lazybox/platform";
export const keyboardActions = [
  {
    id: "navigation.exit",
    label: "Leave agent for navigation",
    scope: "global",
    keys: "] ]",
  },
  {
    id: "workspace.new",
    label: "New workspace",
    scope: "global",
    keys: "] ] w",
  },
  {
    id: "conversation.new",
    label: "New conversation",
    scope: "global",
    keys: "] ] c",
  },
  { id: "snippets.open", label: "Snippets", scope: "global", keys: "] ] s" },
  { id: "inbox.open", label: "Inbox", scope: "global", keys: "] ] i" },
  {
    id: "navigation.next",
    label: "Next entry",
    scope: "navigation",
    keys: "j",
  },
  {
    id: "navigation.previous",
    label: "Previous entry",
    scope: "navigation",
    keys: "k",
  },
  {
    id: "navigation.parent",
    label: "Workspace / left pane",
    scope: "navigation",
    keys: "h",
  },
  {
    id: "navigation.open",
    label: "Open entry / agent",
    scope: "navigation",
    keys: "l",
  },
  { id: "chat.send", label: "Send message", scope: "agent", keys: "Enter" },
] as const;
export type Action = (typeof keyboardActions)[number]["id"];
export type Keymap = Record<Action, string>;
export function keyboardPreset(preset = "vim"): Keymap {
  const map = Object.fromEntries(
    keyboardActions.map((a) => [a.id, a.keys]),
  ) as Keymap;
  if (preset === "arrows") {
    map["navigation.next"] = "ArrowDown";
    map["navigation.previous"] = "ArrowUp";
    map["navigation.parent"] = "ArrowLeft";
    map["navigation.open"] = "ArrowRight";
  }
  if (preset === "tmux")
    for (const id of Object.keys(map) as Action[]) {
      map[id] = map[id].replace("] ]", "Ctrl+b");
      if (id.startsWith("navigation.") && id !== "navigation.exit")
        map[id] =
          "Ctrl+b " +
          ((
            {
              "navigation.next": "ArrowDown",
              "navigation.previous": "ArrowUp",
              "navigation.parent": "ArrowLeft",
              "navigation.open": "ArrowRight",
            } as Partial<Keymap>
          )[id] || map[id]);
    }
  return map;
}
export function validateKeymap(map: Keymap): string {
  for (const action of keyboardActions) {
    const value = map[action.id]?.trim();
    if (!value) return `Set a shortcut for ${action.label}.`;
    if(value.split(/\s+/).some(key=>!/^(?:(?:Ctrl|Meta|Alt|Shift)\+)*(?:[^\s+]|Enter|Escape|Tab|Space|ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Backspace|Delete|Home|End|PageUp|PageDown|F[1-9][0-9]?)$/.test(key)))return `Invalid key in ${action.label}. Use a character or a key such as Ctrl+b or ArrowDown.`;
    if (value.split(/\s+/).length > 4)
      return "Shortcuts support up to four keys.";
  }
  for (const a of keyboardActions)
    for (const b of keyboardActions)
      if (
        a.id !== b.id &&
        map[a.id].trim().replace(/\s+/g," ") === map[b.id].trim().replace(/\s+/g," ") &&
        (a.scope === b.scope || a.scope === "global" || b.scope === "global")
      )
        return `${a.label} conflicts with ${b.label}.`;
  return "";
}
const storageKey = "keyboard:v2";
export function readKeymap(store?: ViewStateStore): Keymap {
  try {
    const raw = JSON.parse(
      readPreference(store, storageKey) ||
        "null",
    );
    const map = { ...keyboardPreset(), ...raw };
    return validateKeymap(map) ? keyboardPreset() : normalizeKeymap(map);
  } catch {
    return keyboardPreset();
  }
}
function normalizeKeymap(map:Keymap):Keymap{return Object.fromEntries(keyboardActions.map(a=>[a.id,map[a.id].trim().replace(/\s+/g," ")])) as Keymap;}
export function saveKeymap(map: Keymap, store?: ViewStateStore) {
  const error = validateKeymap(map);
  if (error) throw Error(error);
  map=normalizeKeymap(map);
  writePreference(store, storageKey, JSON.stringify(map));
  window.dispatchEvent(new Event("lazybox-keymap"));
}
/** The first key of every global sequence (the leader, such as "]"), as
 * KeyboardEvent.key: Vim editing leaves these to the keyboard dispatcher. */
export function leaderKeys(map: Keymap): string[] {
  return [...new Set(keyboardActions.filter((a) => a.scope === "global").map((a) => map[a.id].trim().split(/\s+/)[0]).map((key) => (key === "Space" ? " " : key)))];
}
/** Opt-in Vim editing, separately for the message box and the file editor. */
export type VimPreferences = { composer: boolean; editor: boolean };
const vimKey = "vim-editing:v1";
export function readVimPreferences(store?: ViewStateStore): VimPreferences {
  try {
    const raw = JSON.parse(readPreference(store, vimKey) || "{}");
    return { composer: raw?.composer === true, editor: raw?.editor === true };
  } catch {
    return { composer: false, editor: false };
  }
}
export function saveVimPreferences(preferences: VimPreferences, store?: ViewStateStore) {
  writePreference(store, vimKey, JSON.stringify({ composer: !!preferences.composer, editor: !!preferences.editor }));
  window.dispatchEvent(new Event("lazybox-keymap"));
}
export function useVimPreferences(store?: ViewStateStore): VimPreferences {
  const [preferences, setPreferences] = useState(() => readVimPreferences(store));
  useEffect(() => {
    const reload = () => setPreferences((previous) => {
      const next = readVimPreferences(store);
      return previous.composer === next.composer && previous.editor === next.editor ? previous : next;
    });
    reload();
    window.addEventListener("lazybox-keymap", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("lazybox-keymap", reload);
      window.removeEventListener("storage", reload);
    };
  }, [store]);
  return preferences;
}
/** A user-defined entry in the ]] menu: one key that sends or inserts a snippet. */
export type MenuEntry = { key: string; label: string; snippet: string; mode: "send" | "insert" };
/** What the ]] menu shows while a sequence is in progress. */
export type KeyHint = { prefix: string; items: { keys: string; label: string }[] };
const menuKey = "leader-menu:v1";
const builtInMenuKeys = (map: Keymap) => {
  const leader = map["navigation.exit"].trim();
  return keyboardActions.map((a) => map[a.id].trim()).filter((keys) => keys.startsWith(leader + " ")).map((keys) => keys.slice(leader.length + 1));
};
export function readMenu(store?: ViewStateStore): MenuEntry[] {
  try {
    const raw = JSON.parse(readPreference(store, menuKey) || "[]");
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.key === "string" && typeof e.snippet === "string" && typeof e.label === "string").map((e) => ({ key: e.key, label: e.label, snippet: e.snippet, mode: e.mode === "insert" ? "insert" : "send" })) : [];
  } catch {
    return [];
  }
}
export function validateMenu(entries: MenuEntry[], map: Keymap): string {
  const taken = new Set(builtInMenuKeys(map));
  for (const e of entries) {
    if (!/^(?:[a-z0-9]|Shift\+[a-z])$/.test(e.key)) return `Menu key "${e.key}" must be one letter or digit.`;
    if (taken.has(e.key)) return `Menu key "${e.key}" is already used.`;
    if (!e.snippet.trim()) return `Choose a snippet for "${e.key}".`;
    if (e.label.length > 60) return `Label for "${e.key}" is too long.`;
    taken.add(e.key);
  }
  return entries.length > 36 ? "The menu holds up to 36 entries." : "";
}
export function saveMenu(entries: MenuEntry[], store?: ViewStateStore) {
  const error = validateMenu(entries, readKeymap(store));
  if (error) throw Error(error);
  writePreference(store, menuKey, JSON.stringify(entries));
  window.dispatchEvent(new Event("lazybox-keymap"));
}
/** Asks the focused chat to send or insert a snippet chosen from the ]] menu. */
export function useMenuSnippet(callback: (entry: MenuEntry) => void) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const listener = (event: Event) => ref.current((event as CustomEvent<MenuEntry>).detail);
    window.addEventListener("lazybox-menu", listener);
    return () => window.removeEventListener("lazybox-menu", listener);
  }, []);
}

export function invokeAction(id: Action) {
  window.dispatchEvent(new CustomEvent("lazybox-action", { detail: id }));
}
export function useKeyboardAction(id: Action, callback: () => void) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent).detail === id) ref.current();
    };
    window.addEventListener("lazybox-action", listener);
    return () => window.removeEventListener("lazybox-action", listener);
  }, [id]);
}
function eventKey(e: KeyboardEvent) {
  return `${e.ctrlKey ? "Ctrl+" : ""}${e.metaKey ? "Meta+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey && (e.key.length > 1 || /^[a-z]$/i.test(e.key)) ? "Shift+" : ""}${e.key === " " ? "Space" : e.key.length === 1 ? e.key.toLowerCase() : e.key}`;
}
export function useKeyboardNavigation(store?: ViewStateStore, enabled = true) {
  const [hint, setHint] = useState<KeyHint | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let map = readKeymap(store),
      menu = readMenu(store),
      sequence: string[] = [],
      typed: HTMLTextAreaElement | undefined;
    const reset = () => {
      sequence = [];
      typed = undefined;
      setHint(null);
    };
    const reload = () => {
      map = readKeymap(store);
      menu = readMenu(store);
      reset();
    };
    const keydown = (e: KeyboardEvent) => {
      // A key another handler consumed (a Vim command, say) still ends a pending sequence.
      if (e.defaultPrevented && sequence.length) reset();
      if (
        e.isComposing ||
        e.repeat ||
        e.defaultPrevented ||
        document.querySelector("dialog[open]")
      )
        return;
      const target = e.target as HTMLElement,
        agent = target.matches("[data-agent-composer]"),
        navigation = !!target.closest(".collection-panel");
      if (e.key === "Escape") {
        reset();
        return;
      }
      if (
        !agent &&
        (target.matches("input,textarea,select") || target.isContentEditable)
      ) {
        reset();
        return;
      }
      const leader = map["navigation.exit"].trim();
      // User entries live under the leader, next to the built-in actions.
      const candidates: { id: string; label: string; keys: string; entry?: MenuEntry }[] = [
        ...keyboardActions
          .filter((a) => a.scope === "global" || (a.scope === "agent" && agent) || (a.scope === "navigation" && navigation))
          .map((a) => ({ id: a.id as string, label: a.label as string, keys: map[a.id] })),
        ...menu.map((entry) => ({ id: "menu:" + entry.key, label: entry.label || entry.snippet, keys: `${leader} ${entry.key}`, entry })),
      ];
      const key = eventKey(e);
      let next = [...sequence, key];
      let matches = candidates.filter(
        (a) =>
          a.keys.split(/\s+/).slice(0, next.length).join(" ") ===
          next.join(" "),
      );
      if (!matches.length) {
        reset();
        next = [key];
        matches = candidates.filter((a) => a.keys.split(/\s+/)[0] === key);
        if (!matches.length) return;
      }
      // A lone closing bracket remains ordinary text. Only the completed leader removes it.
      // In Vim normal or visual mode the message box takes no typing, so the bracket is only the leader.
      const literal = agent && !["normal", "visual"].includes(target.dataset.vimMode || "");
      if (literal && sequence.length === 0 && key === "]") {
        sequence = next;
        typed = target as HTMLTextAreaElement;
        return;
      }
      e.preventDefault();
      if (typed && key === "]" && sequence.length === 1) {
        const position = typed.selectionStart;
        if (typed.value[position - 1] === "]") {
          const value =
            typed.value.slice(0, position - 1) + typed.value.slice(position);
          Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          )!.set!.call(typed, value);
          typed.setSelectionRange(position - 1, position - 1);
          typed.dispatchEvent(new Event("input", { bubbles: true }));
        }
        typed = undefined;
      }
      sequence = next;
      const exact = matches.find((a) => a.keys === next.join(" "));
      if (exact?.entry) window.dispatchEvent(new CustomEvent("lazybox-menu", { detail: exact.entry }));
      else if (exact) invokeAction(exact.id as Action);
      const descendants = matches.filter((a) => a.keys.split(/\s+/).length > next.length);
      if (descendants.length)
        setHint({
          prefix: next.join(" "),
          items: descendants.map((a) => ({ keys: a.keys.split(/\s+/).slice(next.length).join(" "), label: a.label })),
        });
      else reset();
    };
    const navigate = (event: Event) => {
      const id = (event as CustomEvent<Action>).detail;
      if (!id.startsWith("navigation.")) return;
      const entries = [
        ...document.querySelectorAll<HTMLElement>(
          ".collection-panel [data-navigation-item],.collection-panel .conversation-link",
        ),
      ];
      const active = document.activeElement as HTMLElement,
        index = entries.indexOf(active);
      if (id === "navigation.exit") {
        (
          entries.find((e) => e.getAttribute("aria-current") === "page") ||
          entries[0] ||
          document.querySelector<HTMLElement>(".chat-heading button")
        )?.focus();
      }
      if (id === "navigation.next" || id === "navigation.previous") {
        entries[
          Math.max(
            0,
            Math.min(
              entries.length - 1,
              (index < 0 ? 0 : index) + (id === "navigation.next" ? 1 : -1),
            ),
          )
        ]?.focus();
      }
      if (id === "navigation.parent")
        active
          .closest(".collection-group")
          ?.querySelector<HTMLElement>(".workspace-link")
          ?.focus();
      if (id === "navigation.open") {
        active.closest(".collection-panel") && active.click();
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>("[data-agent-composer]")?.focus(),
        );
      }
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown",reset);window.addEventListener("blur",reset);
    window.addEventListener("lazybox-action", navigate);
    window.addEventListener("lazybox-keymap", reload);
    window.addEventListener("storage", reload);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown",reset);window.removeEventListener("blur",reset);
      window.removeEventListener("lazybox-action", navigate);
      window.removeEventListener("lazybox-keymap", reload);
      window.removeEventListener("storage", reload);
    };
  }, [store, enabled]);
  return hint;
}

export function useKeymap(store?:ViewStateStore){
 const [map,setMap]=useState(()=>readKeymap(store));
 useEffect(()=>{const reload=()=>setMap(readKeymap(store));window.addEventListener('lazybox-keymap',reload);window.addEventListener('storage',reload);return()=>{window.removeEventListener('lazybox-keymap',reload);window.removeEventListener('storage',reload);};},[store]);return map;
}
