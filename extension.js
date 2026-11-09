const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

// Claude Code writes one record per live session here: <pid>.json, with
// { pid, sessionId, cwd, name, status, updatedAt, ... }. The Claude Code
// extension exposes no API, so this file is the only way to learn which
// sessions exist. The record does not say which VS Code window owns the
// session, but every session process is spawned by the extension host — and
// this extension runs inside that same host — so `ppid === process.pid`
// narrows the list to this window.
const SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeSessionId.copy", () =>
      copySession(configuredField())
    ),
    vscode.commands.registerCommand("claudeSessionId.copyName", () =>
      copySession("name")
    ),
    vscode.commands.registerCommand("claudeSessionId.copyUuid", () =>
      copySession("sessionId")
    )
  );
}

function configuredField() {
  const v = vscode.workspace
    .getConfiguration("claudeSessionId")
    .get("copyField", "name");
  return v === "sessionId" ? "sessionId" : "name";
}

async function copySession(field) {
  let sessions;
  try {
    sessions = await findSessionsForThisWindow();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not read Claude Code sessions: ${err.message}`
    );
    return;
  }

  if (!sessions.length) {
    vscode.window.showWarningMessage(
      "No live Claude Code session found for this window."
    );
    return;
  }

  for (const s of sessions) s.title = await sessionTitle(s);

  const session = matchActiveTab(sessions) || (await pickSession(sessions));
  if (!session) return;

  await copyField(session, field);
}

async function copyField(session, field) {
  const value = session[field];
  if (!value) {
    vscode.window.showWarningMessage(
      `Session record has no "${field}" (pid ${session.pid}).`
    );
    return;
  }
  await vscode.env.clipboard.writeText(String(value));

  const other = field === "name" ? "sessionId" : "name";
  const otherLabel = other === "name" ? "Copy name" : "Copy UUID";
  const choice = await vscode.window.showInformationMessage(
    `Copied ${field === "name" ? "session name" : "session UUID"}: ${value}`,
    otherLabel
  );
  if (choice === otherLabel) await copyField(session, other);
}

// The Claude Code tab label is the session title. If exactly one session in
// this window carries the active tab's label, it is the one the user is
// looking at.
function matchActiveTab(sessions) {
  if (sessions.length === 1) return sessions[0];
  const tab =
    vscode.window.tabGroups &&
    vscode.window.tabGroups.activeTabGroup &&
    vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!tab || !tab.label) return undefined;
  const label = normalizeTitle(tab.label);
  const hits = sessions.filter((s) => normalizeTitle(s.title) === label);
  return hits.length === 1 ? hits[0] : undefined;
}

function normalizeTitle(t) {
  return String(t || "")
    .replace(/^[●•*]\s*/, "")
    .trim()
    .toLowerCase();
}

async function pickSession(sessions) {
  const items = sessions.map((s) => ({
    label: s.title || "Untitled",
    description: [s.name, s.sessionId].filter(Boolean).join("  ·  "),
    detail: [s.status, relative(s.updatedAt), s.cwd]
      .filter(Boolean)
      .join("  ·  "),
    session: s,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Claude Code sessions in this window",
    placeHolder: "Several sessions are running here — pick one",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked && picked.session;
}

async function findSessionsForThisWindow() {
  const all = readSessionRecords().filter((s) => isAlive(s.pid));
  if (!all.length) return [];

  const parents = await parentPids(all.map((s) => s.pid));
  let mine = all.filter((s) => parents.get(s.pid) === process.pid);

  // Fallback (e.g. ps unavailable): keep sessions whose cwd is inside one of
  // this window's workspace folders.
  if (!mine.length && parents.size === 0) {
    const roots = (vscode.workspace.workspaceFolders || []).map(
      (f) => f.uri.fsPath
    );
    mine = all.filter((s) =>
      roots.some((r) => s.cwd === r || (s.cwd || "").startsWith(r + path.sep))
    );
  }

  return mine.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Title shown on the session tab: the last "custom-title" record (manual
// rename) wins, else the last "ai-title". Both live in the session transcript
// ~/.claude/projects/<cwd slug>/<sessionId>.jsonl. Titles are near the end of
// the file, so read the tail first and fall back to the whole file.
const TAIL_BYTES = 256 * 1024;

async function sessionTitle(session) {
  if (!session.cwd || !session.sessionId) return "";
  const file = path.join(
    os.homedir(),
    ".claude",
    "projects",
    session.cwd.replace(/[^A-Za-z0-9]/g, "-"),
    `${session.sessionId}.jsonl`
  );
  let fh;
  try {
    fh = await fs.promises.open(file, "r");
    const { size } = await fh.stat();
    const tailStart = Math.max(0, size - TAIL_BYTES);
    const tail = await readRange(fh, tailStart, size);
    const fromTail = titleFromText(tail, tailStart > 0);
    if (fromTail || tailStart === 0) return fromTail;
    return titleFromText(await readRange(fh, 0, size), false);
  } catch {
    return "";
  } finally {
    if (fh) await fh.close();
  }
}

async function readRange(fh, start, end) {
  const buf = Buffer.alloc(end - start);
  await fh.read(buf, 0, buf.length, start);
  return buf.toString("utf8");
}

function titleFromText(text, dropFirstLine) {
  const lines = text.split("\n");
  if (dropFirstLine) lines.shift(); // partial line at a tail cut
  let custom = "";
  let ai = "";
  for (let i = lines.length - 1; i >= 0 && !custom; i--) {
    const line = lines[i];
    if (line.startsWith('{"type":"custom-title"')) {
      custom = field(line, "customTitle");
    } else if (!ai && line.startsWith('{"type":"ai-title"')) {
      ai = field(line, "aiTitle");
    }
  }
  return custom || ai;
}

function field(line, key) {
  try {
    const v = JSON.parse(line)[key];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

function readSessionRecords() {
  let names;
  try {
    names = fs.readdirSync(SESSIONS_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const records = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(
        fs.readFileSync(path.join(SESSIONS_DIR, name), "utf8")
      );
      if (rec && typeof rec.pid === "number") records.push(rec);
    } catch {
      // partially written or stale file — skip it
    }
  }
  return records;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Map<pid, ppid> for the given pids, via one `ps` call. Empty map on failure.
function parentPids(pids) {
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-o", "pid=,ppid=", "-p", pids.join(",")],
      (err, stdout) => {
        const map = new Map();
        if (err) return resolve(map);
        for (const line of stdout.split("\n")) {
          const [pid, ppid] = line.trim().split(/\s+/).map(Number);
          if (pid && ppid) map.set(pid, ppid);
        }
        resolve(map);
      }
    );
  });
}

function relative(ts) {
  if (!ts) return "";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function deactivate() {}

module.exports = { activate, deactivate };
