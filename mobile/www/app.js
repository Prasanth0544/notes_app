/* ============================================================
   NoteVault Mobile – app.js  (Offline-First + Cloud Sync)
   ============================================================
   Platform detection:
     - Capacitor native → local SQLite + background sync to Atlas
     - Browser fallback → direct API calls (same as web version)
   ============================================================ */

'use strict';

// ─── Config ────────────────────────────────────────────────────
// CHANGE THIS to your deployed server URL when you deploy!
const API_BASE = 'http://192.168.1.180:5000/api'; // Your server IP on local network
const IS_NATIVE = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();

// ─── Capacitor Plugin References ──────────────────────────────
let SqlitePlugin = null;
let NetworkPlugin = null;
let sqliteDb = null;
let isOnline = true;

// ─── Auth Guard ───────────────────────────────────────────────
const token = localStorage.getItem('nv_token');
if (!token) window.location.href = 'login.html';

// ─── DOM refs ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const notesList      = $('notesList');
const searchInput    = $('searchInput');
const emptyState     = $('emptyState');
const editorPanel    = $('editorPanel');
const noteTitleInput = $('noteTitleInput');
const editorBody     = $('editorBody');
const noteDate       = $('noteDate');
const tagsInput      = $('tagsInput');
const tagsContainer  = $('tagsContainer');
const wordCount      = $('wordCount');
const saveStatus     = $('saveStatus');
const imgFilePicker  = $('imgFilePicker');
const toast          = $('toast');

// ─── Toast ────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 2400) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ─── Date helper ──────────────────────────────────────────────
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ─── Auth helpers ─────────────────────────────────────────────
function getToken() { return localStorage.getItem('nv_token'); }
function logout() {
  // If native, wipe local SQLite first
  if (IS_NATIVE && sqliteDb) {
    wipeLocalDb().then(() => {
      localStorage.clear();
      window.location.href = 'login.html';
    });
  } else {
    localStorage.clear();
    window.location.href = 'login.html';
  }
}

// ─── API helpers (cloud) ──────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken(),
    },
    ...opts,
  });
  if (res.status === 401) {
    showToast('⚠️ Session expired – please sign in again', 3000);
    setTimeout(logout, 2500);
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
//  LOCAL SQLITE DATABASE (Mobile Only)
// ═══════════════════════════════════════════════════════════════

const DB_NAME = 'notevault_local';

async function initLocalDb() {
  if (!IS_NATIVE) return;
  SqlitePlugin = Capacitor.Plugins.CapacitorSQLite;
  NetworkPlugin = Capacitor.Plugins.Network;

  // Open database
  await SqlitePlugin.createConnection({ database: DB_NAME, version: 1, encrypted: false, mode: 'no-encryption' });
  await SqlitePlugin.open({ database: DB_NAME });
  sqliteDb = DB_NAME;

  // Create tables
  await SqlitePlugin.execute({ database: DB_NAME, statements: `
    CREATE TABLE IF NOT EXISTS notes (
      local_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      cloud_id   TEXT DEFAULT '',
      title      TEXT DEFAULT 'Untitled Note',
      content    TEXT DEFAULT '',
      tags       TEXT DEFAULT '[]',
      created    INTEGER DEFAULT 0,
      modified   INTEGER DEFAULT 0,
      synced     INTEGER DEFAULT 0,
      deleted    INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `});

  // Network listener
  NetworkPlugin.addListener('networkStatusChange', (status) => {
    isOnline = status.connected;
    updateSyncBanner();
    if (isOnline) {
      showToast('🌐 Online – syncing…');
      syncWithCloud();
    } else {
      showToast('📴 Offline – changes saved locally');
    }
  });

  // Check initial status
  const status = await NetworkPlugin.getStatus();
  isOnline = status.connected;
  updateSyncBanner();
}

// ─── Local DB: CRUD ───────────────────────────────────────────
async function localGetAllNotes(q = '') {
  let sql = `SELECT * FROM notes WHERE deleted = 0`;
  const params = [];
  if (q) {
    sql += ` AND (title LIKE ? OR content LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY modified DESC`;
  const res = await SqlitePlugin.query({ database: DB_NAME, statement: sql, values: params });
  return (res.values || []).map(row => ({
    local_id: row.local_id,
    cloud_id: row.cloud_id,
    id:       row.cloud_id || `local_${row.local_id}`,
    title:    row.title,
    content:  row.content,
    tags:     JSON.parse(row.tags || '[]'),
    created:  row.created,
    modified: row.modified,
    synced:   row.synced,
  }));
}

async function localGetNote(localId) {
  const res = await SqlitePlugin.query({
    database: DB_NAME,
    statement: 'SELECT * FROM notes WHERE local_id = ?',
    values: [localId],
  });
  if (!res.values || !res.values.length) return null;
  const row = res.values[0];
  return {
    local_id: row.local_id,
    cloud_id: row.cloud_id,
    id:       row.cloud_id || `local_${row.local_id}`,
    title:    row.title,
    content:  row.content,
    tags:     JSON.parse(row.tags || '[]'),
    created:  row.created,
    modified: row.modified,
    synced:   row.synced,
  };
}

async function localCreateNote() {
  const now = Date.now();
  await SqlitePlugin.run({
    database: DB_NAME,
    statement: `INSERT INTO notes (title, content, tags, created, modified, synced) VALUES (?, ?, ?, ?, ?, ?)`,
    values: ['Untitled Note', '', '[]', now, now, 0],
  });
  const res = await SqlitePlugin.query({
    database: DB_NAME,
    statement: 'SELECT last_insert_rowid() as id',
    values: [],
  });
  return res.values[0].id;
}

async function localUpdateNote(localId, title, content, tags) {
  const now = Date.now();
  await SqlitePlugin.run({
    database: DB_NAME,
    statement: `UPDATE notes SET title = ?, content = ?, tags = ?, modified = ?, synced = 0 WHERE local_id = ?`,
    values: [title, content, JSON.stringify(tags), now, localId],
  });
  return now;
}

async function localDeleteNote(localId) {
  // Soft delete – mark for sync
  const row = await localGetNote(localId);
  if (row && row.cloud_id) {
    // Has cloud copy – mark as deleted for sync
    await SqlitePlugin.run({
      database: DB_NAME,
      statement: `UPDATE notes SET deleted = 1, synced = 0, modified = ? WHERE local_id = ?`,
      values: [Date.now(), localId],
    });
  } else {
    // Never synced – just remove
    await SqlitePlugin.run({
      database: DB_NAME,
      statement: `DELETE FROM notes WHERE local_id = ?`,
      values: [localId],
    });
  }
}

async function wipeLocalDb() {
  if (!SqlitePlugin) return;
  try {
    await SqlitePlugin.execute({
      database: DB_NAME,
      statements: 'DELETE FROM notes; DELETE FROM sync_meta;',
    });
  } catch (e) { console.error('Wipe failed', e); }
}

// ═══════════════════════════════════════════════════════════════
//  SYNC ENGINE
// ═══════════════════════════════════════════════════════════════

let syncing = false;

async function syncWithCloud() {
  if (!IS_NATIVE || !isOnline || syncing) return;
  syncing = true;
  updateSyncBanner();

  try {
    // 1) Push locally-deleted notes to cloud
    const deletedRows = await SqlitePlugin.query({
      database: DB_NAME,
      statement: `SELECT * FROM notes WHERE deleted = 1 AND cloud_id != ''`,
      values: [],
    });
    if (deletedRows.values && deletedRows.values.length > 0) {
      const ids = deletedRows.values.map(r => r.cloud_id);
      await apiFetch('/sync/delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      // Remove from local db
      await SqlitePlugin.run({
        database: DB_NAME,
        statement: `DELETE FROM notes WHERE deleted = 1`,
        values: [],
      });
    }

    // 2) Push unsynced notes to cloud
    const unsyncedRows = await SqlitePlugin.query({
      database: DB_NAME,
      statement: `SELECT * FROM notes WHERE synced = 0 AND deleted = 0`,
      values: [],
    });
    if (unsyncedRows.values && unsyncedRows.values.length > 0) {
      const notesToPush = unsyncedRows.values.map(r => ({
        local_id:  r.local_id,
        cloud_id:  r.cloud_id || '',
        title:     r.title,
        content:   r.content,
        tags:      JSON.parse(r.tags || '[]'),
        created:   r.created,
        modified:  r.modified,
      }));
      const pushResult = await apiFetch('/sync/push', {
        method: 'POST',
        body: JSON.stringify({ notes: notesToPush }),
      });
      // Update local records with cloud_id and mark synced
      for (const r of pushResult.results) {
        await SqlitePlugin.run({
          database: DB_NAME,
          statement: `UPDATE notes SET cloud_id = ?, synced = 1 WHERE local_id = ?`,
          values: [r.cloud_id, r.local_id],
        });
      }
    }

    // 3) Pull new/updated notes from cloud
    const lastSync = await getLastSyncTimestamp();
    const cloudNotes = await apiFetch('/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ since: lastSync }),
    });
    for (const cn of cloudNotes) {
      // Check if we already have this note locally
      const existing = await SqlitePlugin.query({
        database: DB_NAME,
        statement: 'SELECT * FROM notes WHERE cloud_id = ?',
        values: [cn.id],
      });
      if (existing.values && existing.values.length > 0) {
        const local = existing.values[0];
        // Only update if cloud is newer AND local is already synced
        if (cn.modified > local.modified && local.synced === 1) {
          await SqlitePlugin.run({
            database: DB_NAME,
            statement: `UPDATE notes SET title = ?, content = ?, tags = ?, modified = ?, synced = 1 WHERE cloud_id = ?`,
            values: [cn.title, cn.content, JSON.stringify(cn.tags), cn.modified, cn.id],
          });
        }
      } else {
        // New note from cloud
        await SqlitePlugin.run({
          database: DB_NAME,
          statement: `INSERT INTO notes (cloud_id, title, content, tags, created, modified, synced) VALUES (?, ?, ?, ?, ?, ?, 1)`,
          values: [cn.id, cn.title, cn.content, JSON.stringify(cn.tags), cn.created, cn.modified],
        });
      }
    }

    // Update last sync timestamp
    await setLastSyncTimestamp(Date.now());

    showToast('☁️ Synced to cloud ✅');
  } catch (e) {
    console.error('Sync error:', e);
    if (!e.message.includes('Unauthorized')) {
      showToast('⚠️ Sync failed – will retry later');
    }
  } finally {
    syncing = false;
    updateSyncBanner();
    // Refresh list to update sync indicators
    await loadNotesList(searchInput.value);
  }
}

async function getLastSyncTimestamp() {
  try {
    const res = await SqlitePlugin.query({
      database: DB_NAME,
      statement: `SELECT value FROM sync_meta WHERE key = 'last_sync'`,
      values: [],
    });
    return (res.values && res.values.length) ? parseInt(res.values[0].value) : 0;
  } catch { return 0; }
}

async function setLastSyncTimestamp(ts) {
  await SqlitePlugin.run({
    database: DB_NAME,
    statement: `INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_sync', ?)`,
    values: [String(ts)],
  });
}

// ─── Sync Banner ──────────────────────────────────────────────
function updateSyncBanner() {
  const banner = $('syncBanner');
  if (!banner) return;
  if (!IS_NATIVE) { banner.style.display = 'none'; return; }

  if (syncing) {
    banner.className = 'sync-banner syncing';
    banner.innerHTML = '🔄 Syncing with cloud…';
  } else if (!isOnline) {
    banner.className = 'sync-banner offline';
    banner.innerHTML = '📴 Offline – changes saved locally';
  } else {
    banner.className = 'sync-banner online';
    banner.innerHTML = '☁️ Connected';
    setTimeout(() => { banner.className = 'sync-banner online hidden'; }, 2000);
  }
}

// ═══════════════════════════════════════════════════════════════
//  USER PROFILE
// ═══════════════════════════════════════════════════════════════

async function loadUserProfile() {
  try {
    const cached = JSON.parse(localStorage.getItem('nv_user') || '{}');
    if (cached.name) applyUserUI(cached);
  } catch {}
  if (isOnline) {
    try {
      const user = await apiFetch('/auth/me');
      localStorage.setItem('nv_user', JSON.stringify(user));
      applyUserUI(user);
    } catch {}
  }
}

function applyUserUI(user) {
  const nameEl = $('userName'), roleEl = $('userRole'), avatarEl = $('userAvatar');
  if (!nameEl) return;
  nameEl.textContent = user.username ? `@${user.username}` : (user.name || user.email || 'User');
  roleEl.textContent = user.role || '';
  if (user.avatar && user.avatar.startsWith('http')) {
    avatarEl.innerHTML = `<img src="${user.avatar}" alt="avatar" />`;
  } else {
    const initials = (user.name || user.email || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    avatarEl.textContent = initials;
  }
}

// Logout menu toggle
const userStrip = $('userStrip');
const btnLogout = $('btnLogout');
if (userStrip) {
  userStrip.addEventListener('click', (e) => {
    if (e.target.closest('#btnLogout')) return;
    userStrip.classList.toggle('menu-open');
  });
  document.addEventListener('click', (e) => {
    if (!userStrip.contains(e.target)) userStrip.classList.remove('menu-open');
  });
}
if (btnLogout) {
  btnLogout.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    userStrip.classList.remove('menu-open');
    logout();
  });
}

// ═══════════════════════════════════════════════════════════════
//  UNIFIED NOTES INTERFACE
//  Automatically uses SQLite (mobile) or API (web)
// ═══════════════════════════════════════════════════════════════

let activeId = null, activeLocalId = null, saveTimer = null, allNotes = [], isDirty = false, currentTags = [];

// ─── Unsaved Changes Modal ────────────────────────────────────
const modalOverlay = $('modalOverlay');
const modalSave    = $('modalSave');
const modalDiscard = $('modalDiscard');
const modalCancel  = $('modalCancel');

function showUnsavedModal() {
  return new Promise(resolve => {
    modalOverlay.classList.add('show');
    function cleanup(result) {
      modalOverlay.classList.remove('show');
      modalSave.removeEventListener('click', onSave);
      modalDiscard.removeEventListener('click', onDiscard);
      modalCancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onSave    = () => cleanup('save');
    const onDiscard = () => cleanup('discard');
    const onCancel  = () => cleanup('cancel');
    modalSave.addEventListener('click', onSave);
    modalDiscard.addEventListener('click', onDiscard);
    modalCancel.addEventListener('click', onCancel);
  });
}

async function checkUnsaved() {
  if (!isDirty || (!activeId && !activeLocalId)) return true;
  const choice = await showUnsavedModal();
  if (choice === 'save')    { await saveCurrentNote(); return true; }
  if (choice === 'discard') { isDirty = false; return true; }
  return false;
}

modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) modalDiscard.click();
});

window.addEventListener('beforeunload', e => {
  if (isDirty) { e.preventDefault(); e.returnValue = ''; }
});

// ─── Load Notes List ──────────────────────────────────────────
async function loadNotesList(q = '') {
  try {
    if (IS_NATIVE) {
      allNotes = await localGetAllNotes(q);
    } else {
      const url = q ? `/notes?q=${encodeURIComponent(q)}` : '/notes';
      allNotes = await apiFetch(url);
    }
  } catch (e) {
    if (!e.message.includes('Unauthorized')) {
      showToast('⚠️ Cannot load notes', 4000);
    }
    return;
  }

  notesList.innerHTML = '';
  if (!allNotes.length) {
    const li = document.createElement('li');
    li.style.cssText = 'color:var(--muted);font-size:.82rem;padding:16px;text-align:center';
    li.textContent = q ? 'No notes match your search.' : 'No notes yet.';
    notesList.appendChild(li);
    return;
  }

  allNotes.forEach(n => {
    const li = document.createElement('li');
    const isUnsynced = IS_NATIVE && n.synced === 0;
    li.className = 'note-item'
      + (n.local_id === activeLocalId ? ' active' : (n.id === activeId ? ' active' : ''))
      + (isUnsynced ? ' unsynced' : '');
    li.dataset.id = n.id;
    if (n.local_id) li.dataset.localId = n.local_id;

    const tags = (n.tags || []).map(t => `<span class="note-tag">#${t}</span>`).join('');
    const syncIcon = isUnsynced ? '<span class="unsynced-dot" title="Not synced to cloud">●</span>' : '';
    li.innerHTML = `
      <div class="note-item-title">${syncIcon}${escHTML(n.title || 'Untitled')}</div>
      <div class="note-item-meta"><span>${fmtDate(n.modified)}</span></div>
      <div class="note-item-preview">${stripHTML(n.content || '').slice(0, 80)}</div>
      ${tags ? `<div style="margin-top:4px">${tags}</div>` : ''}
    `;
    li.addEventListener('click', async () => {
      if (IS_NATIVE && n.local_id === activeLocalId) return;
      if (!IS_NATIVE && n.id === activeId) return;
      if (!await checkUnsaved()) return;
      if (IS_NATIVE) openNoteLocal(n.local_id);
      else openNote(n.id);
    });
    notesList.appendChild(li);
  });
}

function escHTML(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function stripHTML(h) { const d = document.createElement('div'); d.innerHTML = h; return d.textContent || ''; }

// ─── Open Note ────────────────────────────────────────────────
async function openNote(id) {
  const note = await apiFetch(`/notes/${id}`);
  activeId = id; activeLocalId = null;
  showEditor(note);
  await loadNotesList(searchInput.value);
}

async function openNoteLocal(localId) {
  const note = await localGetNote(localId);
  if (!note) return;
  activeLocalId = localId; activeId = note.cloud_id || null;
  showEditor(note);
  await loadNotesList(searchInput.value);
}

function showEditor(note) {
  emptyState.style.display  = 'none';
  editorPanel.style.display = 'flex';
  noteTitleInput.value  = note.title || '';
  editorBody.innerHTML  = note.content || '';
  currentTags = [...(note.tags || [])];
  renderTags();
  noteDate.textContent = 'Last saved: ' + fmtDate(note.modified);
  updateWordCount();
  setSaveStatus('ok');
}

// ─── Create Note ──────────────────────────────────────────────
async function createNote() {
  if (!await checkUnsaved()) return;
  if (IS_NATIVE) {
    const localId = await localCreateNote();
    await openNoteLocal(localId);
  } else {
    const note = await apiFetch('/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Untitled Note', content: '', tags: [] }),
    });
    await openNote(note.id);
  }
  noteTitleInput.focus();
  noteTitleInput.select();
}

// ─── Delete Note ──────────────────────────────────────────────
async function deleteNote() {
  if (!activeId && !activeLocalId) return;
  if (IS_NATIVE) {
    await localDeleteNote(activeLocalId);
    // Trigger sync to delete from cloud too
    if (isOnline) syncWithCloud();
  } else {
    await apiFetch(`/notes/${activeId}`, { method: 'DELETE' });
  }
  activeId = null; activeLocalId = null;
  editorPanel.style.display = 'none';
  emptyState.style.display  = 'flex';
  await loadNotesList();
  showToast('🗑️ Note deleted');
}

// ─── Autosave ─────────────────────────────────────────────────
function scheduleSave() {
  isDirty = true;
  setSaveStatus('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentNote, 900);
}

async function saveCurrentNote() {
  if (!activeId && !activeLocalId) return;
  const title   = noteTitleInput.value.trim() || 'Untitled Note';
  const content = editorBody.innerHTML;

  try {
    if (IS_NATIVE) {
      const ts = await localUpdateNote(activeLocalId, title, content, currentTags);
      noteDate.textContent = 'Last saved: ' + fmtDate(ts);
      isDirty = false;
      setSaveStatus('ok');
      // Background sync if online
      if (isOnline) syncWithCloud();
    } else {
      const updated = await apiFetch(`/notes/${activeId}`, {
        method: 'PUT',
        body: JSON.stringify({ title, content, tags: currentTags }),
      });
      noteDate.textContent = 'Last saved: ' + fmtDate(updated.modified);
      isDirty = false;
      setSaveStatus('ok');
    }
    await loadNotesList(searchInput.value);
  } catch (e) {
    if (!e.message.includes('Unauthorized')) {
      setSaveStatus('err');
      showToast('⚠️ Save failed');
    }
  }
}

function setSaveStatus(s) {
  saveStatus.className = '';
  if (s === 'ok')        { saveStatus.className = 'save-ok';      saveStatus.textContent = '✔ Saved'; }
  else if (s === 'pending') { saveStatus.className = 'save-pending'; saveStatus.textContent = '⏳ Saving…'; }
  else                   { saveStatus.className = 'save-err';     saveStatus.textContent = '✖ Error'; }
}

// ─── Word Count ───────────────────────────────────────────────
function updateWordCount() {
  const text = stripHTML(editorBody.innerHTML).trim();
  const words = text ? text.split(/\s+/).length : 0;
  wordCount.textContent = `${words} word${words!==1?'s':''} · ${text.length} chars`;
}

// ─── Image Upload ─────────────────────────────────────────────
async function uploadAndInsertImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  showToast('⏳ Processing image…');

  // Convert to base64 inline (works offline too)
  const reader = new FileReader();
  reader.onload = function(e) {
    editorBody.focus();
    const img = document.createElement('img');
    img.src = e.target.result; // data URI
    img.alt = file.name || 'image';
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editorBody.appendChild(img);
    }
    editorBody.appendChild(document.createElement('br'));
    scheduleSave();
    showToast('🖼️ Image inserted!');
  };
  reader.readAsDataURL(file);
}

$('btnInsertImg').addEventListener('click', () => imgFilePicker.click());
imgFilePicker.addEventListener('change', e => {
  Array.from(e.target.files).forEach(uploadAndInsertImage);
  e.target.value = '';
});

// ─── Paste Handler ────────────────────────────────────────────
editorBody.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  let hasImage = false;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault(); hasImage = true;
      uploadAndInsertImage(item.getAsFile());
    }
  }
  if (!hasImage) setTimeout(scheduleSave, 100);
});

// ─── Drag & Drop ──────────────────────────────────────────────
editorBody.addEventListener('dragover', e => { e.preventDefault(); editorBody.style.outline = '2px dashed var(--accent)'; });
editorBody.addEventListener('dragleave', () => { editorBody.style.outline = ''; });
editorBody.addEventListener('drop', e => {
  e.preventDefault(); editorBody.style.outline = '';
  Array.from(e.dataTransfer?.files || []).forEach(uploadAndInsertImage);
});

// ─── Image click ──────────────────────────────────────────────
editorBody.addEventListener('click', e => {
  if (e.target.tagName === 'IMG') {
    document.querySelectorAll('.editor-body img').forEach(i => i.classList.remove('img-selected'));
    e.target.classList.add('img-selected');
    const sel = window.getSelection(), range = document.createRange();
    range.selectNode(e.target); sel.removeAllRanges(); sel.addRange(range);
  } else {
    document.querySelectorAll('.editor-body img').forEach(i => i.classList.remove('img-selected'));
  }
});

editorBody.addEventListener('keydown', e => {
  const sel = document.querySelector('.editor-body img.img-selected');
  if (sel && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault(); sel.remove(); scheduleSave();
  }
});

// ─── Toolbar ──────────────────────────────────────────────────
function execCmd(cmd, value = null) {
  editorBody.focus();
  if (['h1','h2','h3'].includes(cmd)) document.execCommand('formatBlock', false, cmd);
  else if (cmd === 'fontSize')        document.execCommand('fontSize', false, value);
  else if (cmd === 'foreColor')       document.execCommand('foreColor', false, value);
  else                                document.execCommand(cmd, false, value);
}
document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', e => { e.preventDefault(); execCmd(btn.dataset.cmd); scheduleSave(); });
});
$('fontSizeSel').addEventListener('change', e => { execCmd('fontSize', e.target.value); scheduleSave(); });
$('fontColor').addEventListener('input',    e => { execCmd('foreColor', e.target.value); scheduleSave(); });
$('btnUndo').addEventListener('click', () => { document.execCommand('undo'); scheduleSave(); });
$('btnRedo').addEventListener('click', () => { document.execCommand('redo'); scheduleSave(); });
$('btnInsertLink').addEventListener('click', () => {
  const url = prompt('Enter URL:', 'https://');
  if (url) { execCmd('createLink', url); scheduleSave(); }
});

// ─── Editor events ────────────────────────────────────────────
editorBody.addEventListener('input',  () => { updateWordCount(); scheduleSave(); });
noteTitleInput.addEventListener('input', scheduleSave);
searchInput.addEventListener('input', () => loadNotesList(searchInput.value));

// ─── Tag Management ───────────────────────────────────────────
function renderTags() {
  tagsContainer.querySelectorAll('.tag-chip').forEach(el => el.remove());
  currentTags.forEach((tag, idx) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `#${escHTML(tag)} <button class="tag-remove" data-idx="${idx}">✕</button>`;
    tagsContainer.insertBefore(chip, tagsInput);
  });
  tagsContainer.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      currentTags.splice(e.target.dataset.idx, 1);
      renderTags(); scheduleSave();
    });
  });
}

function addTag(val) {
  const t = val.trim().replace(/^#/, '');
  if (t && !currentTags.includes(t)) { currentTags.push(t); renderTags(); scheduleSave(); }
}

tagsInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault(); addTag(tagsInput.value); tagsInput.value = '';
  } else if (e.key === 'Backspace' && tagsInput.value === '') {
    e.preventDefault();
    if (currentTags.length > 0) { currentTags.pop(); renderTags(); scheduleSave(); }
  }
});

// ─── Save As ──────────────────────────────────────────────────
function saveAsFile() {
  if (!activeId && !activeLocalId) return;
  const title   = noteTitleInput.value.trim() || 'Untitled Note';
  const content = editorBody.innerHTML;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#1a1a2e;line-height:1.7}
h1{border-bottom:2px solid #6c63ff;padding-bottom:8px}img{max-width:100%;border-radius:8px;margin:12px 0}
.meta{color:#888;font-size:0.8em;margin-bottom:20px}</style></head>
<body><h1>${title}</h1><div class="meta">Exported from NoteVault on ${new Date().toLocaleString()}</div>${content}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${title.replace(/[^a-zA-Z0-9 _-]/g, '')}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📥 Note downloaded as HTML');
}

// ─── Buttons ──────────────────────────────────────────────────
$('btnNewNote').addEventListener('click',   createNote);
$('btnNewNoteLg').addEventListener('click', createNote);
$('btnDeleteNote').addEventListener('click', deleteNote);
$('btnSave').addEventListener('click', () => { saveCurrentNote(); showToast('💾 Saved!'); });
$('btnSaveAs').addEventListener('click', saveAsFile);

// ─── Theme Toggle ─────────────────────────────────────────────
const btnTheme = $('btnTheme');
function applyTheme(isLight) {
  document.body.classList.toggle('light', isLight);
  btnTheme.textContent = isLight ? '🌙' : '☀️';
  btnTheme.title = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
  localStorage.setItem('nv_theme', isLight ? 'light' : 'dark');
}
btnTheme.addEventListener('click', () => applyTheme(!document.body.classList.contains('light')));

// ─── Keyboard Shortcuts ───────────────────────────────────────
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 's') { e.preventDefault(); saveCurrentNote(); }
  if (ctrl && e.key === 'n') { e.preventDefault(); createNote(); }
  if (ctrl && e.key === 'f') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  if (ctrl && e.shiftKey && e.key === 'L') { e.preventDefault(); applyTheme(!document.body.classList.contains('light')); }
});

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════

(async () => {
  const saved = localStorage.getItem('nv_theme');
  applyTheme(saved === 'light');

  // Init local DB for mobile
  if (IS_NATIVE) {
    await initLocalDb();
    showToast(isOnline ? '📱 NoteVault Mobile (online)' : '📱 NoteVault Mobile (offline)');
  } else {
    showToast('📓 NoteVault ready!');
  }

  // Load user profile and notes
  await Promise.all([loadUserProfile(), loadNotesList()]);

  // Open first note if any
  if (allNotes.length > 0) {
    if (IS_NATIVE) await openNoteLocal(allNotes[0].local_id);
    else await openNote(allNotes[0].id);
  }

  // Initial sync if online
  if (IS_NATIVE && isOnline) {
    setTimeout(syncWithCloud, 1000);
  }

  // Periodic sync every 30 seconds
  if (IS_NATIVE) {
    setInterval(() => {
      if (isOnline && !syncing) syncWithCloud();
    }, 30000);
  }
})();
