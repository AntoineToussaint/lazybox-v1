# Optional GitHub connection

The Runner owns a private GitHub connection, repository source copies,
read-only issue/PR access and the [PR loop](#the-pr-loop) (push, open, read and
merge a workspace branch's pull request). The desktop submits a credential only
during an explicit connection; responses never return access or refresh tokens.

## Connect without installing an App

1. Open **Settings → Repositories → Connections & folders → Connect with a personal token**.
2. Follow the steps in the form. **Create a token on GitHub** opens a classic
   token already set to the `repo` scope. For SSO organizations, click
   **Configure SSO** on that token and authorize each organization. Paste the
   token; the output of `gh auth token` also works. The Runner validates your
   identity before saving it. The form clears the token after submission.
3. Open **New workspace**, select repositories directly, and create it. Browsing
   discovers metadata; the Runner prepares sources only when creating or extending
   a workspace. There is no separate import or library-selection step.

No GitHub App configuration, installation or GitHub CLI is required for this
path. Discovery uses the authenticated user's repository API, including owner,
collaborator and organization membership, filtered by the token's permissions.
The API adapter uses pinned `google/go-github/v93` behind the provider interface;
Git supplies clone and worktree operations.

GitHub supports [classic and fine-grained personal tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
Classic tokens with `repo` scope support private repositories across
organizations and outside-collaborator access, and the writes the PR loop makes.
Fine-grained tokens can grant Contents, Issues and Pull requests access to
selected repositories (read for discovery; **write** on Contents and Pull
requests, read on Checks and Commit statuses, for the PR loop), but currently
have outside-collaborator and multi-organization limitations. Neither kind
bypasses organization token policies, approval requirements or SSO.

One GitHub identity is supported per Runner. To change from an existing App
connection, explicitly **Disconnect** it in Lazybox first, then connect the
personal token. This preserves imported repositories and sessions; it does not
revoke the App on GitHub. A different account cannot silently replace the saved
identity. Replacing an invalid token for the same account validates and saves
it before replacing the old credential. Personal tokens are not OAuth-refreshed:
revocation or expiry is reported when GitHub rejects a request; supply a new token.
An expiry date is not inferred when GitHub has not supplied one.

The existing GitHub App device sign-in remains available when configured. Its
repository discovery uses the App's accessible installations. **Connect with
GitHub App** completes browser authorization without entering a personal token.

GitHub is optional for coding. [Add an existing repository](WORKSPACES.md) on
the Runner to create workspaces without any GitHub API authorization.

## Optional GitHub App developer setup

Register a GitHub App owned by the Lazybox organization or developer account.
Use separate Dev and Working app registrations when testing different grants.
Use the official [GitHub App registration settings](https://github.com/settings/apps/new):

- Give the App a unique Lazybox name and its actual product homepage.
- Enable **Device Flow** and leave user access token expiration enabled.
- Set repository **Issues** to read-only, **Checks** and **Commit statuses** to
  read-only, and **Contents** and **Pull requests** to read and write (the PR
  loop pushes branches and opens and merges pull requests; with read-only
  grants those actions are refused with an explanation and everything else
  works). Metadata read access is implicit. No organization permissions,
  webhook events, callback server, client secret or private key are needed.
- Disable webhooks for this read-on-request implementation. Choose who can
  install the App according to the intended audience; organization installation
  may require an organization owner.
- Record the public **Client ID** (not the numeric App ID) and App URL slug.
  Install the App on explicitly selected repositories.

Supply those public values in the selected Runner's configuration:

```json
{
  "githubApp": {
    "clientId": "<registered-public-client-id>",
    "slug": "<registered-app-url-slug>"
  }
}
```

Merge this field into the existing config; retain profile, permission and
gateway settings. The [channel launcher](ENVIRONMENTS.md) creates a config
per environment. Restart the selected Runner when it is idle. Configuration
is persisted on that Runner; changing the App while an identity is connected
is rejected, rather than replacing that identity. No real App ID is shipped
in this prototype. An unconfigured Runner still offers personal-token connection.
Users do not see an App-registration form or need to create their own App.

GitHub's [device authorization flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
issues an expiring GitHub App user token. The Runner requests `offline_access`
and [refreshes it](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
without an App secret for this device-flow grant. Access is the intersection
of the user's rights, App permissions and selected installation repositories.
One GitHub identity is supported per Runner in this slice; Claude/Codex
subscription selection is independent of that identity.

## Ownership and recovery

- No response, error, repository URL or browser storage contains a saved token.
  Submitted personal tokens exist transiently in the client and travel over the
  authenticated Runner transport. Private credentials are atomically persisted in an owner-only regular file
  beneath the resolved Runner state. No ambient `GH_TOKEN`, `GITHUB_TOKEN`,
  `gh auth`, Git credential helper or V1 auth store is used for this connection.
- Device polling survives a desktop disconnect; reconnect recovers the pending
  flow. Runner restart requires a new unfinished authorization. Completed
  authorizations survive restart, and refresh is serialized.
- Imports resolve the selected GitHub repository ID again, validate its
  canonical HTTPS identity, and clone a private bare source under
  `<state>/repositories/github-<id>/source.git`. Clone credentials exist only
  in the Git child environment, never in its arguments, origin URL or config.
- Registration persists in the Collection library. A completed owned clone
  can be recovered if registration failed; unknown existing paths are refused.
  Partial batches retain successful imports and retry only the remainder.
- Disconnect removes only this Runner's saved GitHub credentials. It retains
  repository copies, Workspaces and conversations. Remote GitHub authorization
  can be revoked separately in GitHub settings.

## The PR loop

**Changes** shows, above each repository's files, the one next step in bold:
**Commit N…**, **Push N** (or **Publish branch** the first time), **Create
PR…**, then the pull request's card, where **Send failing checks to the agent**
or **Merge** is next. Nothing happens without an explicit click.

- **Commit…** lists the changed files (all selected; untick to leave some
  uncommitted) and drafts the message from the conversation's title, else from
  the files. **Ask the agent to write it** sends the conversation that did the
  work a short request (visible in the conversation) and fills the box with
  its reply's fenced block; the agent is told not to run Git. **Commit &
  push** does both. ⌘↩ / Ctrl+Enter commits.
- **Create PR…** prefills the title (the single commit's subject, else the
  conversation's title) and a description listing the commits, with the
  repository's default branch as base and a draft option. It pushes unpushed
  commits first, and says so; uncommitted files are named as not included.
- The **card** shows state, review decision and every check run and commit
  status of the head, failing first, each with a **Logs** link. It refreshes
  every 30 s while checks run, every 2 minutes otherwise (not while the
  window is hidden), and on demand.
- **Send failing checks to the agent** opens the conversation beside Changes
  and puts the failing checks, their results and log links in its message box,
  after any draft. It is never sent for you.
- **Merge** (squash, merge commit or rebase; the choice is remembered in this
  browser) is offered only when GitHub reports the pull request green and
  mergeable; otherwise the card says why (failing or running checks, a required
  review, conflicts, branch protection). It asks for confirmation, merges only
  the head shown (a later push makes GitHub refuse), and shows GitHub's own
  refusal, such as a branch-protection rule, as it is stated.

The Runner RPCs are `CommitWorkspaceChanges`, `PushWorkspaceBranch`,
`CreatePullRequest`, `GetPullRequest` and `MergePullRequest`. They take a
workspace and member name, never a path; they are the owner's alone (an agent's
scoped credential is denied, like every RPC off its allowlist).

- Commit runs `git add --all` and `git commit` in that member's worktree only
  (selected paths commit with `--only`, leaving other staged changes as they
  were), refuses an empty commit or a detached HEAD, and runs the repository's
  hooks with the person's Git identity. A missing identity, a held
  `index.lock` or a failing hook is explained.
- Push sends `HEAD` to `origin` under the branch's own name with
  `--set-upstream`, never forced; a diverged remote branch is refused and
  explained. It records `origin/<branch>` so the push state survives without a
  fetch (bare GitHub sources have no fetch refspec).
- An HTTPS GitHub origin is pushed with the connection's credential as an HTTP
  `Authorization` header in the git child's environment only
  (`GIT_CONFIG_COUNT`), exactly as clone does: never in arguments, the remote
  URL, Git config, a credential helper or an error (stderr is redacted). The
  person's global and system Git config are left out of that push so a
  credential helper or URL rewrite cannot capture or redirect it. An SSH or
  non-GitHub origin is pushed with the person's own Git setup (SSH agent,
  `BatchMode`, no prompts) and never receives the GitHub credential. The
  repository's own config (hooks, `insteadOf`) still applies: whoever can edit
  it, including an agent working in the worktree, can already read the Runner's
  state as the same OS user, so this does not widen an agent's reach.
- Pull requests use the same connection through go-github. A branch's pull
  request is found by `owner:branch` (an open one first); the review decision
  is each reviewer's latest approving or blocking review, else
  `review_required` while a request is outstanding.

A repository whose origin is not on GitHub can commit and push; its card says
pull requests need GitHub. Without a GitHub connection, a GitHub origin says to
connect one.

## Scope and evidence

Implemented: personal-token and App connection lifecycles, App-token refresh,
user-repository and installation/repository pagination,
selected imports, durable library registration, Workspace membership, and
read-only issue/PR RPCs for imported repos, and the PR loop (tested against a
local bare remote and a fake GitHub API; not yet exercised against github.com).
The repository browser does not expose a second issue/PR browsing workflow. See [runtime evidence](RUNTIME_EVIDENCE.md).

Not yet implemented: background inbox synchronization, durable task/event
reconciliation, opening a tracker record directly into a session, incremental
fetching of imported source copies, review comments, auto-merge, or
remote Hub coordination. Re-importing an existing repository is idempotent; it
does not fetch a newer base. Live App identity and repository listing have been verified. Live personal-token
authorization, organization-policy behavior and private cloning remain unverified;
no personal credential was borrowed from local CLI stores for tests. These limitations must stay explicit before claiming full GitHub
dogfooding readiness.

### Repository picker discovery and removal

The shared repository picker groups GitHub entries alphabetically by owner/org,
then repository, with local repositories last. The Runner catalog refresh walks
all pages using the Runner's existing Lazybox credential: personal-token discovery
includes owner, collaborator and organization-member repositories; GitHub App
connections remain limited to accessible installations. It lists metadata first
and clones only selected repositories. Token permissions and organization/SSO
policy still bound the result; it does not borrow or change local CLI login.

**Remove** removes an entry from saved discovery and the visible repository
library. Git checkouts, remotes, branches and workspace worktrees are untouched.
Internal source references needed to manage existing worktrees are retained.
Explicit folder scans may rediscover a removed entry, and it can be re-added.

Repository discovery explicitly labels GitHub App connections as installation-scoped. It does not imply these results include every repository the user can access personally. Connections & folders provides “Use personal token…” through the existing explicit disconnect/connect flow; it never changes system GitHub credentials.

The catalog stores complete GitHub results on the Runner, scoped by account and
connection method. All repository pickers consume it. Pagination and credential
access live behind the Runner source interface, not React component state.
See [catalog configuration and workflow](WORKSPACES.md#catalog-boundaries-and-configuration).
