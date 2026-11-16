import { ActionMenu } from './ActionMenu';
import { ActionMenuItems } from './ActionMenuItems';
import { contextMenu } from './ContextMenu';
import type { MenuItem } from './context-menu-model';
import { useRef, useState } from "react";
import type { Collection, Session } from "@lazybox/protocol";
import { conversationDetails } from "./conversation-model";
import { sessionStatus } from "./agent-status";
import { Icon } from "./Icons";
import { useRunner } from "./RunnerContext";
import { useUnread } from "./useAttention";
import { LiveStatusLabel, SessionMark } from "./LiveIndicator";
import { generatedName, repositoryGroups, suggestWorkspaceName } from "./repository-model";
import "./inbox.css";

/**
 * A workspace's repositories on one line, whatever their number: the owner
 * once, then short names, "+N" for the rest ("codefly-dev · authority, cli,
 * core +2"). The full list is the tooltip, and the workspace's repository
 * dialog. Screen readers (and copy) get every "owner/name".
 */
export function RepositorySummary({ names, limit = 3 }: { names: readonly string[]; limit?: number }) {
  if (!names.length) return <small className="workspace-repo-names empty">No repositories</small>;
  const { owner, repositories } = repositoryGroups(names);
  const shown = repositories.length <= limit + 1 ? repositories : repositories.slice(0, limit);
  const hidden = repositories.length - shown.length;
  return <small className="workspace-repo-names" title={repositories.map(repo => repo.full).join("\n")}>
    <span className="sr-only">Repositories: {repositories.map(repo => repo.full).join(", ")}</span>
    <span aria-hidden="true">{owner && <span className="workspace-repo-owner">{owner} · </span>}{shown.map(repo => repo.short).join(", ")}{hidden > 0 && <span className="workspace-repo-more"> +{hidden}</span>}</span>
  </small>;
}

/** Row actions retain their original workspace identity, independently of navigation. */
export function WorkspaceRow({
  workspace,
  repositoryNames,
  selected,
  onSelect,
  onDelete,
  onManage,
  onAdd,
  onSaved,
  conversation,
  conversationCount,
  onNewConversation,
  onDeleteConversation,
}: {
  conversation?: Session;
  conversationCount: number;
  onNewConversation(): void;
  onDeleteConversation(): void;
  workspace: Collection;
  repositoryNames: string[];
  selected: boolean;
  onSelect(): void;
  onDelete(): void;
  onManage(): void;
  onAdd(): void;
  onSaved(): void;
}) {
  const { api, info } = useRunner();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const action = useRef<HTMLDetailsElement>(null);
  const unread = useUnread();
  const marker = conversation ? unread(conversation) : "";
  const rename = () => { setName(workspace.name); setError(""); setEditing(true); };
  // The ⋯ menu and the row's context menu: one list.
  const items: MenuItem[] = [
    { label: "New conversation", icon: "plus", disabled: (workspace.state !== "ready" || workspace.ownershipUncertain) && "The workspace is not ready", run: onNewConversation },
    "separator",
    { label: "Add repositories…", icon: "repository", run: onAdd },
    { label: "Manage repositories…", icon: "sliders", run: onManage },
    { label: "Rename workspace", icon: "pencil", shortcut: "F2", run: rename },
    "separator",
    conversation && { label: "Delete conversation…", danger: true, run: onDeleteConversation },
    { label: "Delete workspace…", danger: true, run: onDelete },
  ];
  return (
    <div className="workspace-row" data-unread={marker || undefined} onContextMenu={editing ? undefined : contextMenu("workspace", () => items, { workspaceId: workspace.id })} onKeyDown={event => {
      if (event.key === 'F2' && !editing) { event.preventDefault(); setName(workspace.name); setError(''); setEditing(true); }
    }}>
      {editing ? (
        <form
          className="workspace-inline-rename"
          aria-label={`Rename ${workspace.name}`}
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current || !name.trim()) return;
            pending.current = true;
            setSaving(true);
            setError("");
            try {
              await api.renameCollection({
                collectionId: workspace.id,
                name: name.trim(),
              });
              setEditing(false);
              onSaved();
            } catch (error) {
              setError(String(error));
            } finally {
              pending.current = false;
              setSaving(false);
            }
          }}
        >
          <label>
            <span className="sr-only">Workspace name</span>
            <input
              autoFocus
              aria-label="Workspace name"
              value={name}
              maxLength={128}
              disabled={saving}
              onFocus={(event) => event.target.select()}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !saving) {
                  event.preventDefault();
                  setEditing(false);
                }
              }}
            />
          </label>
          <div className="inline-editor-actions">
            <button
              className="rename-save"
              aria-label="Save name"
              disabled={saving || !name.trim()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </form>
      ) : (
        <button
          className="workspace-link"
          data-navigation-item
          aria-current={selected ? "page" : undefined}
          onClick={onSelect}
        >
          <Icon name="folder" size={16} />
          <span className="workspace-label">
            <strong>{workspace.name}</strong>
            <RepositorySummary names={repositoryNames} />
            {conversation ? (
              <small
                className="workspace-agent"
                title={
                  conversationDetails(conversation, info?.profiles || []) +
                  " · " +
                  sessionStatus(conversation)
                }
              >
                <SessionMark session={conversation} unread={marker} />
                {marker && <span className="sr-only">{marker === "failed" ? "Failed, unread" : "Ready for review, unread"}</span>}
                <span className="workspace-agent-label">{conversation.provider === "codex" ? "Codex" : "Claude"}
                {conversation.model ? ` · ${conversation.model}` : ""}</span>
                <LiveStatusLabel session={conversation} className="workspace-agent-status" />
              </small>
            ) : (
              // Every card has the same three lines, so the list reads as a grid.
              <small className="workspace-agent workspace-conversation-count">
                <span className="session-mark" aria-hidden="true"><Icon name="chat" size={11} /></span>
                <span className="workspace-agent-label">{conversationCount ? `${conversationCount} ${conversationCount === 1 ? "conversation" : "conversations"}` : "No conversation yet"}</span>
              </small>
            )}
          </span>
          {workspace.ownershipUncertain && (
            <span title="Owner uncertain">!</span>
          )}
        </button>
      )}
      {!editing && generatedName(workspace.name) && (
        // A generated name says nothing about the work: one click names it, never a prompt.
        <button
          className="workspace-name-it"
          aria-label={`Name ${workspace.name}`}
          title="Give this workspace a name that says what the work is"
          onClick={() => { setName(suggestWorkspaceName(repositoryNames)); setError(""); setEditing(true); }}
        >
          <Icon name="pencil" size={11} />
          <span>Name it</span>
        </button>
      )}
      {!editing && (
        <button
          className="workspace-new-conversation icon-button"
          aria-label={`New conversation in ${workspace.name}`}
          title="New conversation"
          disabled={workspace.state !== "ready" || workspace.ownershipUncertain}
          onClick={onNewConversation}
        >
          <Icon name="plus" size={15} />
        </button>
      )}
      {!editing && (
        <ActionMenu ref={action} label={`Actions for ${workspace.name}`}>
          <ActionMenuItems items={items}/>
        </ActionMenu>
      )}
    </div>
  );
}
