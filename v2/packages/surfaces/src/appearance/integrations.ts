/**
 * Themes for the components that draw their own colours: the terminal
 * (xterm), the editor (Monaco) and diagrams (Mermaid). Each is derived from
 * the window's tokens, so they change with the theme like everything else.
 */
import { mix } from './color';
import { SYSTEM_CODE_FONT } from './preferences';
import type { AppearanceState } from './apply';

export function terminalTheme({ theme: { tokens: t } }: AppearanceState) {
  return {
    background: t['code-bg'], foreground: t['code-text'], cursor: t.accent, cursorAccent: t['code-bg'], selectionBackground: t.selection,
    black: t['ansi-0'], red: t['ansi-1'], green: t['ansi-2'], yellow: t['ansi-3'], blue: t['ansi-4'], magenta: t['ansi-5'], cyan: t['ansi-6'], white: t['ansi-7'],
    brightBlack: t['ansi-8'], brightRed: t['ansi-9'], brightGreen: t['ansi-10'], brightYellow: t['ansi-11'], brightBlue: t['ansi-12'], brightMagenta: t['ansi-13'], brightCyan: t['ansi-14'], brightWhite: t['ansi-15'],
  };
}
export function codeFont({ typography }: AppearanceState): { family: string; size: number; ligatures: boolean } {
  return { family: typography.codeFont || SYSTEM_CODE_FONT, size: typography.codeFontSize, ligatures: typography.ligatures };
}

const bare = (hex: string) => hex.replace(/^#/, '').slice(0, 6);
/** A Monaco theme: syntax rules and editor chrome from the tokens. */
export function monacoTheme({ theme }: AppearanceState) {
  const t = theme.tokens;
  return {
    base: (theme.scheme === 'dark' ? 'vs-dark' : 'vs') as 'vs-dark' | 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: bare(t['code-text']) },
      { token: 'comment', foreground: bare(t['syntax-comment']), fontStyle: 'italic' },
      { token: 'keyword', foreground: bare(t['syntax-keyword']) },
      { token: 'string', foreground: bare(t['syntax-string']) },
      { token: 'number', foreground: bare(t['syntax-number']) },
      { token: 'type', foreground: bare(t['syntax-type']) },
      { token: 'type.identifier', foreground: bare(t['syntax-type']) },
      { token: 'attribute.name', foreground: bare(t['syntax-attr']) },
      { token: 'tag', foreground: bare(t['syntax-keyword']) },
      { token: 'function', foreground: bare(t['syntax-function']) },
      { token: 'variable', foreground: bare(t['code-text']) },
    ],
    colors: {
      'editor.background': t['code-bg'],
      'editor.foreground': t['code-text'],
      'editorLineNumber.foreground': t['text-faint'],
      'editorLineNumber.activeForeground': t['text-secondary'],
      'editor.lineHighlightBackground': t['surface-hover'],
      'editor.selectionBackground': t.selection,
      'editor.inactiveSelectionBackground': mix(t.selection, t['code-bg'], 0.4),
      'editorCursor.foreground': t.accent,
      'editorIndentGuide.background1': t['line-subtle'],
      'editorWidget.background': t['surface-raised'],
      'editorWidget.border': t['line-strong'],
      'input.background': t['surface-sunken'],
      'diffEditor.insertedLineBackground': t['diff-add-bg'],
      'diffEditor.removedLineBackground': t['diff-del-bg'],
      // Monaco keeps its own context menu: it reads like Lazybox's.
      'menu.background': t['surface-hover'], 'menu.foreground': t.text, 'menu.border': t['line-strong'],
      'menu.selectionBackground': t['surface-strong'], 'menu.selectionForeground': t['text-strong'], 'menu.separatorBackground': t.line,
    },
  };
}

/** Mermaid's base theme, coloured from the tokens. */
export function mermaidTheme({ theme, typography }: AppearanceState) {
  const t = theme.tokens;
  return {
    darkMode: theme.scheme === 'dark',
    background: t['code-bg'],
    // The diagram is drawn as an image: it gets a font name itself, not a CSS
    // variable. Mermaid's own default unless the person chose an interface font.
    ...(typography.uiFont ? { fontFamily: typography.uiFont } : {}),
    primaryColor: t['accent-bg-strong'], primaryTextColor: t.text, primaryBorderColor: t['accent-line'],
    secondaryColor: t['info-bg-strong'], secondaryTextColor: t.text, secondaryBorderColor: t['info-line'],
    tertiaryColor: t['surface-raised'], tertiaryTextColor: t.text, tertiaryBorderColor: t['line-strong'],
    lineColor: t['text-muted'], textColor: t.text, mainBkg: t['accent-bg-strong'], nodeBorder: t['accent-line'],
    clusterBkg: t['surface-raised'], clusterBorder: t['line-strong'], titleColor: t['text-strong'], edgeLabelBackground: t['surface-raised'],
    noteBkgColor: t['warn-bg'], noteTextColor: t['warn-strong'], noteBorderColor: t['warn-line'],
    actorBkg: t['accent-bg-strong'], actorBorder: t['accent-line'], actorTextColor: t.text, signalColor: t['text-secondary'], signalTextColor: t.text,
    errorBkgColor: t['danger-bg'], errorTextColor: t['danger-strong'],
  };
}
