# Claude Session ID

A personal VSCode extension: a **copy button** in the title bar of every Claude
Code tab that puts the session's **name** (or **UUID**) on the clipboard — no
need to ask the model with `/whoami`.

## What it does

- A `$(copy)` button appears in the editor title bar whenever a Claude Code
  session tab is active.
- Clicking it copies the session **name** (e.g. `hermes-monorepo-dd`), the
  address `SendMessage` uses. The notification offers **Copy UUID** as a
  second action.
- Setting `claudeSessionId.copyField` flips the default to the UUID (what
  `claude --resume` takes).
- Command Palette: **Copy Claude Code Session Name** / **… UUID**.

## How it finds the session

Claude Code keeps one record per live session in `~/.claude/sessions/<pid>.json`.
The Claude Code extension exposes no API, so this extension reads those files,
keeps only sessions whose process is alive **and whose parent is this window's
extension host**, and sorts them by last activity.

Each session's tab title comes from its transcript
(`~/.claude/projects/<cwd slug>/<sessionId>.jsonl`): the last `custom-title`
record (manual rename) wins, else the last `ai-title`, else "Untitled".

Which session is the active tab? VSCode does not tell other extensions which
session a webview tab holds, so the extension compares the active tab's label
with the session titles:

- one session in the window → copies it directly;
- exactly one session whose title equals the active tab label → copies it
  directly;
- otherwise (duplicate or "Untitled" titles) → a Quick Pick lists the sessions
  with title, name, UUID, status, last activity and cwd, and you choose.

## Test (dev)

1. Open this folder in VSCode.
2. `F5` → launches an "Extension Development Host" window with the extension active.
3. In that window, open a Claude Code tab and click the copy icon in its title bar.

## Install

1. Build the package (needs Node; uses `@vscode/vsce` via `npx`):

   ```bash
   ./package.sh
   ```

   This produces `claude-session-id-<version>.vsix` in the repo root.

2. In your editor, install from that file:
   - Open the **Extensions** view (`Cmd+Shift+X`)
   - Click the **`...`** menu → **"Install from VSIX..."**
   - Pick the generated `.vsix`
