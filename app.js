/* ============================================================
   NoteVault – app.js  (MongoDB Atlas + JWT Auth edition)
   All storage goes through http://localhost:5000/api
   Auth token stored in localStorage as 'nv_token'
   ============================================================ */

'use strict';

const API = 'http://localhost:5000/api';

// ─── Auth Guard ───────────────────────────────────────────────
const token = localStorage.getItem('nv_token');
if (!token) {
  window.location.href = '/login.html';
}

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
  localStorage.removeItem('nv_token');
  localStorage.removeItem('nv_user');
  window.location.href = '/login.html';
}

// ─── API helpers ──────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
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

// ─── User Profile ─────────────────────────────────────────────
async function loadUserProfile() {
  // Try localStorage first for instant display
  try {
    const cached = JSON.parse(localStorage.getItem('nv_user') || '{}');
    if (cached.name) applyUserUI(cached);
  } catch {}

  // Always refresh from server
  try {
    const user = await apiFetch('/auth/me');
    localStorage.setItem('nv_user', JSON.stringify(user));
    applyUserUI(user);
  } catch {}
}

function applyUserUI(user) {
  const nameEl   = $('userName');
  const roleEl   = $('userRole');
  const avatarEl = $('userAvatar');
  if (!nameEl) return;

  nameEl.textContent = user.username
    ? `@${user.username}`
    : (user.name || user.email || 'User');
  roleEl.textContent = user.role || '';

  if (user.avatar && user.avatar.startsWith('http')) {
    avatarEl.innerHTML = `<img src="${user.avatar}" alt="avatar" />`;
  } else {
    const initials = (user.name || user.email || 'U')
      .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    avatarEl.textContent = initials;
  }
}

// Logout menu toggle
const userStrip = $('userStrip');
const btnLogout = $('btnLogout');

if (userStrip) {
  // Toggle the dropdown when clicking the user strip
  userStrip.addEventListener('click', (e) => {
    // Ignore clicks directly on the logout button (handled below)
    if (e.target.closest('#btnLogout')) return;
    userStrip.classList.toggle('menu-open');
  });

  // Close the dropdown when clicking anywhere else on the page
  document.addEventListener('click', (e) => {
    if (!userStrip.contains(e.target)) {
      userStrip.classList.remove('menu-open');
    }
  });
}

// Logout action
if (btnLogout) {
  btnLogout.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    userStrip.classList.remove('menu-open');
    logout(); // Instant logout for better UX
  });
}

// ─── State ────────────────────────────────────────────────────
let activeId = null, saveTimer = null, allNotes = [], isDirty = false, currentTags = [];

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
  if (!isDirty || !activeId) return true;
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

// ─── Render Notes List ────────────────────────────────────────
async function loadNotesList(q = '') {
  try {
    const url = q ? `/notes?q=${encodeURIComponent(q)}` : '/notes';
    allNotes = await apiFetch(url);
  } catch(e) {
    if (!e.message.includes('Unauthorized')) {
      showToast('⚠️ Cannot reach server – is server.py running?', 4000);
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
    li.className = 'note-item' + (n.id === activeId ? ' active' : '');
    li.dataset.id = n.id;

    const tags = (n.tags || []).map(t => `<span class="note-tag">#${t}</span>`).join('');
    li.innerHTML = `
      <div class="note-item-title">${escHTML(n.title || 'Untitled')}</div>
      <div class="note-item-meta"><span>${fmtDate(n.modified)}</span></div>
      <div class="note-item-preview">${stripHTML(n.content || '').slice(0, 80)}</div>
      ${tags ? `<div style="margin-top:4px">${tags}</div>` : ''}
    `;
    li.addEventListener('click', async () => {
      if (n.id === activeId) return;
      if (!await checkUnsaved()) return;
      openNote(n.id);
    });
    notesList.appendChild(li);
  });
}

function escHTML(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function stripHTML(h) { const d = document.createElement('div'); d.innerHTML = h; return d.textContent || ''; }

// ─── Open Note ────────────────────────────────────────────────
async function openNote(id) {
  const note = await apiFetch(`/notes/${id}`);
  activeId = id;
  emptyState.style.display  = 'none';
  editorPanel.style.display = 'flex';
  noteTitleInput.value = note.title || '';
  editorBody.innerHTML = note.content || '';
  currentTags = [...(note.tags || [])];
  renderTags();
  noteDate.textContent = 'Last saved: ' + fmtDate(note.modified);
  updateWordCount();
  setSaveStatus('ok');
  await loadNotesList(searchInput.value);
}

// ─── Create Note ──────────────────────────────────────────────
async function createNote() {
  if (!await checkUnsaved()) return;
  const note = await apiFetch('/notes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Untitled Note', content: '', tags: [] }),
  });
  await openNote(note.id);
  noteTitleInput.focus();
  noteTitleInput.select();
}

// ─── Delete Note ──────────────────────────────────────────────
async function deleteNote() {
  if (!activeId) return;
  if (!confirm('Delete this note? This cannot be undone.')) return;
  await apiFetch(`/notes/${activeId}`, { method: 'DELETE' });
  activeId = null;
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
  if (!activeId) return;
  try {
    const updated = await apiFetch(`/notes/${activeId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title:   noteTitleInput.value.trim() || 'Untitled Note',
        content: editorBody.innerHTML,
        tags:    currentTags,
      }),
    });
    noteDate.textContent = 'Last saved: ' + fmtDate(updated.modified);
    isDirty = false;
    setSaveStatus('ok');
    await loadNotesList(searchInput.value);
  } catch(e) {
    if (!e.message.includes('Unauthorized')) {
      setSaveStatus('err');
      showToast('⚠️ Save failed – is server.py running?');
    }
  }
}

function setSaveStatus(s) {
  saveStatus.className = '';
  if (s === 'ok')       { saveStatus.className = 'save-ok';      saveStatus.textContent = '✔ Saved'; }
  else if (s==='pending'){ saveStatus.className = 'save-pending'; saveStatus.textContent = '⏳ Saving…'; }
  else                  { saveStatus.className = 'save-err';     saveStatus.textContent = '✖ Error'; }
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
  showToast('⏳ Uploading image…');
  const fd = new FormData();
  fd.append('file', file, file.name || 'pasted.png');
  fd.append('note_id', activeId || 'unsorted');
  try {
    const res  = await fetch(`${API}/images`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: fd,
    });
    const data = await res.json();
    editorBody.focus();
    const img = document.createElement('img');
    img.src = data.url;  // data URI
    img.alt = data.name;
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
  } catch(e) {
    showToast('⚠️ Image upload failed');
  }
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

// ─── Image click (select) ─────────────────────────────────────
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

// ─── Save As (download) ───────────────────────────────────────
function saveAsFile() {
  if (!activeId) return;
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

// ─── Init ─────────────────────────────────────────────────────
(async () => {
  const saved = localStorage.getItem('nv_theme');
  applyTheme(saved === 'light');

  // Load user profile and notes in parallel
  await Promise.all([loadUserProfile(), loadNotesList()]);
  if (allNotes.length > 0) await openNote(allNotes[0].id);

  showToast('📓 NoteVault ready!');
})();
