import { LeaderMenuSettings } from "./LeaderMenuSettings";
import { useState } from "react";
import type { ViewStateStore } from "@lazybox/platform";
import {
  keyboardActions,
  keyboardPreset,
  readKeymap,
  saveKeymap,
  saveVimPreferences,
  useVimPreferences,
  type Action,
  type VimPreferences,
} from "./keyboard";
import { Icon } from "./Icons";
import { SettingsGroup, SettingsHeader, SettingsRow } from "./settings-parts";

export function KeyboardSettings({ store }: { store?: ViewStateStore }) {
  const [map, setMap] = useState(() => readKeymap(store)),
    [status, setStatus] = useState(""),
    [dirty, setDirty] = useState(false);
  return (
    <section className="keyboard-settings">
      <SettingsHeader
        title="Keyboard"
        description={<>Keys work outside the message box. Separate a sequence with spaces: <code>Ctrl+b</code> is a chord, <code>] ] s</code> a sequence.</>}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            saveKeymap(map, store);
            setStatus("Shortcuts saved.");
            setDirty(false);
          } catch (error) {
            setStatus(String(error).replace(/^Error:\s*/, ""));
          }
        }}
      >
        <SettingsGroup title="Navigation shortcuts">
          <SettingsRow label="Start from a preset" htmlFor="keyboard-preset" description="Fills in every shortcut below. Nothing changes until you save.">
            <select
              id="keyboard-preset"
              defaultValue="custom"
              onChange={(e) => {
                setMap(keyboardPreset(e.target.value));
                setDirty(true);
                setStatus("");
              }}
            >
              <option value="custom" disabled>Your shortcuts</option>
              <option value="vim">Vim · ]] and h j k l</option>
              <option value="tmux">Ctrl+b prefix · arrow keys</option>
              <option value="arrows">Arrow keys · ]] leader</option>
            </select>
          </SettingsRow>
          {keyboardActions.map((a) => (
            <SettingsRow key={a.id} label={a.label} htmlFor={`shortcut-${a.id}`}>
              <input
                id={`shortcut-${a.id}`}
                className="shortcut-input"
                aria-label={a.label}
                spellCheck={false}
                autoComplete="off"
                value={map[a.id]}
                onChange={(e) => {
                  setMap({ ...map, [a.id as Action]: e.target.value });
                  setDirty(true);
                  setStatus("");
                }}
              />
            </SettingsRow>
          ))}
        </SettingsGroup>
        <div className="settings-savebar">
          <p role="status" className={status === "Shortcuts saved." ? "settings-saved" : status ? "settings-inline-error" : "settings-dirty"}>
            {status === "Shortcuts saved." && <Icon name="check" size={14} />}
            {status || (dirty ? "Unsaved changes" : "")}
          </p>
          <button className="primary">Save shortcuts</button>
        </div>
      </form>
      <VimSettings store={store} />
      <LeaderMenuSettings store={store} />
    </section>
  );
}

/** Vim editing is opt-in and applies as soon as it is switched. */
function VimSettings({ store }: { store?: ViewStateStore }) {
  const preferences = useVimPreferences(store);
  const [status, setStatus] = useState("");
  const toggle = (key: keyof VimPreferences, on: boolean, label: string) => {
    try {
      saveVimPreferences({ ...preferences, [key]: on }, store);
      setStatus(`Vim editing ${on ? "on" : "off"} in the ${label}.`);
    } catch (error) {
      setStatus(String(error));
    }
  };
  const row = (key: keyof VimPreferences, label: string, where: string, detail: string) => (
    <label className="settings-row vim-toggle">
      <span className="settings-row-text"><span className="settings-row-label">{label}</span><small>{detail}</small></span>
      <span className="settings-row-control settings-switch">
        <input type="checkbox" role="switch" checked={preferences[key]} onChange={(e) => toggle(key, e.target.checked, where)} />
      </span>
    </label>
  );
  return (
    <section className="vim-settings" aria-labelledby="vim-settings-title">
      <SettingsGroup
        title="Vim editing"
        description={<>Modal editing where you type, applied at once. Esc switches to normal mode; the {readKeymap(store)["navigation.exit"]} leader keeps working in every mode.</>}
      >
        <span id="vim-settings-title" className="sr-only">Vim editing</span>
        {row("composer", "Vim editing in the message box", "message box", "Starts in insert mode. In normal mode Enter sends; i a o, h j k l w b e, d c y with counts, p, u and Ctrl-r edit the draft.")}
        {row("editor", "Vim editing in the file editor", "file editor", "Full Vim keys in the file window, with a status line. :w saves, :q closes (asking first about unsaved changes), :wq saves and closes.")}
      </SettingsGroup>
      <p role="status" className="settings-saved vim-status-line">{status}</p>
    </section>
  );
}
