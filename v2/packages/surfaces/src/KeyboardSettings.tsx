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
export function KeyboardSettings({ store }: { store?: ViewStateStore }) {
  const [map, setMap] = useState(() => readKeymap(store)),
    [status, setStatus] = useState("");
  return (
    <section className="keyboard-settings">
      <h2>Keyboard navigation</h2>
      <p>
        Sequences are separated by spaces. Ctrl+b is a chord; ] ] s is a
        hierarchy. Navigation keys only apply outside the composer.
      </p>
      <label>
        Preset
        <select
          defaultValue="custom"
          onChange={(e) => {
            setMap(keyboardPreset(e.target.value));
            setStatus("Save to apply this preset.");
          }}
        >
          <option value="custom" disabled>
            Custom / current
          </option>
          <option value="vim">Vim · ]] and h j k l</option>
          <option value="tmux">Ctrl+b prefix · arrow keys</option>
          <option value="arrows">Arrow keys · ]] leader</option>
        </select>
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            saveKeymap(map, store);
            setStatus("Shortcuts saved.");
          } catch (error) {
            setStatus(String(error));
          }
        }}
      >
        {keyboardActions.map((a) => (
          <label key={a.id}>
            {a.label}
            <input
              aria-label={a.label}
              value={map[a.id]}
              onChange={(e) =>
                setMap({ ...map, [a.id as Action]: e.target.value })
              }
            />
          </label>
        ))}
        <button className="primary">Save shortcuts</button>
      </form>
      <p role="status">{status}</p>
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
  return (
    <section className="vim-settings" aria-labelledby="vim-settings-title">
      <h3 id="vim-settings-title">Vim editing</h3>
      <p>
        Modal editing where you type. Esc switches to normal mode; the{" "}
        {readKeymap(store)["navigation.exit"]} leader keeps working in every mode.
      </p>
      <label className="vim-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={preferences.composer}
          onChange={(e) => toggle("composer", e.target.checked, "message box")}
        />
        <span>Vim editing in the message box</span>
        <small>
          Starts in insert mode. In normal mode Enter sends; i a o, h j k l w b e, d c y with counts, p, u and Ctrl-r edit the draft.
        </small>
      </label>
      <label className="vim-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={preferences.editor}
          onChange={(e) => toggle("editor", e.target.checked, "file editor")}
        />
        <span>Vim editing in the file editor</span>
        <small>
          Full Vim keys in the file window, with a status line. Esc stays in the editor; :w saves, :q closes (asking first about unsaved changes), :wq saves and closes.
        </small>
      </label>
      <p role="status">{status}</p>
    </section>
  );
}
