import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../config.js';
import { cacheNotes, cacheNote, getOfflineNotes, getOfflineNote, saveNoteOffline, deleteNoteOffline, syncQueue } from '../offline.js';

/* ═══════════════════════════════════════════════════════
   NotesApp – Main page (replaces index.html + app.js)
   ═══════════════════════════════════════════════════════ */
export default function NotesApp() {
  const navigate = useNavigate();
  const noteCacheRef = useRef(new Map());
  const saveTimerRef = useRef(null);
  const editorRef = useRef(null);

  // ─── State ─────────────────────────────────────────
  const [allNotes, setAllNotes] = useState([]);
  const [activeId, setActiveIdState] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [currentTags, setCurrentTags] = useState([]);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDate, setNoteDate] = useState('');
  const [saveStatus, setSaveStatus] = useState('ok');
  const [wordCount, setWordCount] = useState('0 words · 0 chars');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState({ msg: '', show: false });
  const [isLight, setIsLight] = useState(localStorage.getItem('nv_theme') === 'light');
  const [showModal, setShowModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showOfflineBanner, setShowOfflineBanner] = useState(!navigator.onLine);

  const activeIdRef = useRef(null);
  const isDirtyRef = useRef(false);
  const currentTagsRef = useRef([]);
  const titleRef = useRef('');
  const modalResolveRef = useRef(null);

  // Keep refs in sync with state
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { currentTagsRef.current = currentTags; }, [currentTags]);
  useEffect(() => { titleRef.current = noteTitle; }, [noteTitle]);

  // ─── Helpers ───────────────────────────────────────
  function getToken() { return localStorage.getItem('nv_token'); }

  function showToastMsg(msg, duration = 2400) {
    setToast({ msg, show: true });
    setTimeout(() => setToast({ msg: '', show: false }), duration);
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function escHTML(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function stripHTML(h) { const d = document.createElement('div'); d.innerHTML = h; return d.textContent || ''; }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      ...opts,
    });
    if (res.status === 401) {
      showToastMsg('⚠️ Session expired – please sign in again', 3000);
      setTimeout(() => { localStorage.removeItem('nv_token'); localStorage.removeItem('nv_user'); navigate('/login'); }, 2500);
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
    return res.json();
  }

  // ─── Theme ─────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle('light', isLight);
    localStorage.setItem('nv_theme', isLight ? 'light' : 'dark');
  }, [isLight]);

  // ─── Online/Offline detection ──────────────────────
  useEffect(() => {
    const goOnline = () => { setIsOnline(true); setShowOfflineBanner(false); syncQueue(API, getToken()); };
    const goOffline = () => { setIsOnline(false); setShowOfflineBanner(true); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  // ─── Load User Profile ─────────────────────────────
  async function loadUserProfile() {
    try {
      const cached = JSON.parse(localStorage.getItem('nv_user') || '{}');
      if (cached.name) setUser(cached);
    } catch {}
    try {
      const u = await apiFetch('/auth/me');
      localStorage.setItem('nv_user', JSON.stringify(u));
      setUser(u);
    } catch {}
  }

  // ─── Load Notes List ───────────────────────────────
  const loadNotesList = useCallback(async (q = '') => {
    let notes = [];
    try {
      if (navigator.onLine) {
        const url = q ? `/notes?q=${encodeURIComponent(q)}` : '/notes';
        notes = await apiFetch(url);
        cacheNotes(notes).catch(() => {});
      } else {
        notes = await getOfflineNotes();
        if (q) {
          const ql = q.toLowerCase();
          notes = notes.filter(n => (n.title || '').toLowerCase().includes(ql));
        }
      }
    } catch (e) {
      if (!e.message.includes('Unauthorized')) {
        notes = await getOfflineNotes().catch(() => []);
        if (notes.length) showToastMsg('📴 Offline mode — showing cached notes', 3000);
        else showToastMsg('⚠️ Cannot reach server', 4000);
      }
    }
    setAllNotes(notes);
    return notes;
  }, []);

  // ─── Open Note ─────────────────────────────────────
  async function openNote(id) {
    setActiveIdState(id);
    setSidebarOpen(false);
    let note = noteCacheRef.current.get(id);
    if (note) {
      renderNote(note);
    } else {
      setNoteTitle('Loading…');
      if (editorRef.current) editorRef.current.innerHTML = '';
      setSaveStatus('pending');
      try {
        if (navigator.onLine) {
          note = await apiFetch(`/notes/${id}`);
          noteCacheRef.current.set(id, note);
          cacheNote(note).catch(() => {});
        } else {
          note = await getOfflineNote(id);
        }
      } catch {
        note = await getOfflineNote(id).catch(() => null);
      }
      if (!note) { showToastMsg('⚠️ Cannot load note'); return; }
      if (activeIdRef.current !== id) return;
      noteCacheRef.current.set(id, note);
      renderNote(note);
    }
  }

  function renderNote(note) {
    setNoteTitle(note.title || '');
    titleRef.current = note.title || '';
    setCurrentTags([...(note.tags || [])]);
    currentTagsRef.current = [...(note.tags || [])];
    setNoteDate('Last saved: ' + fmtDate(note.modified));
    setSaveStatus('ok');
    requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = note.content || '';
        ensureTrailingParagraph();
        requestAnimationFrame(updateWordCount);
      }
    });
  }

  // ─── Create Note ───────────────────────────────────
  async function createNote() {
    if (isDirtyRef.current && activeIdRef.current) {
      const choice = await showUnsavedModal();
      if (choice === 'save') await saveCurrentNote();
      else if (choice === 'cancel') return;
    }
    setIsDirty(false);
    try {
      if (navigator.onLine) {
        const note = await apiFetch('/notes', { method: 'POST', body: JSON.stringify({ title: 'Untitled Note', content: '', tags: [] }) });
        cacheNote(note).catch(() => {});
        const notes = await loadNotesList();
        await openNote(note.id);
      } else {
        const note = await saveNoteOffline(null, 'Untitled Note', '', []);
        noteCacheRef.current.set(note.id, note);
        const notes = await loadNotesList();
        await openNote(note.id);
        showToastMsg('📴 Note created offline — will sync later');
      }
    } catch {
      const note = await saveNoteOffline(null, 'Untitled Note', '', []);
      noteCacheRef.current.set(note.id, note);
      await loadNotesList();
      await openNote(note.id);
      showToastMsg('📴 Note created offline — will sync later');
    }
  }

  // ─── Delete Note ───────────────────────────────────
  async function deleteNote() {
    if (!activeIdRef.current) return;
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    const id = activeIdRef.current;
    noteCacheRef.current.delete(id);
    try {
      if (navigator.onLine) await apiFetch(`/notes/${id}`, { method: 'DELETE' });
      deleteNoteOffline(id).catch(() => {});
    } catch {
      deleteNoteOffline(id).catch(() => {});
    }
    setActiveIdState(null);
    setIsDirty(false);
    await loadNotesList(search);
    showToastMsg('🗑️ Note deleted');
  }

  // ─── Save Note ─────────────────────────────────────
  const saveCurrentNote = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    const newTitle = (titleRef.current || '').trim() || 'Untitled Note';
    const newTags = [...currentTagsRef.current];
    const newContent = editorRef.current?.innerHTML || '';

    try {
      if (navigator.onLine) {
        const updated = await apiFetch(`/notes/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: newTitle, content: newContent, tags: newTags }),
        });
        noteCacheRef.current.set(id, updated);
        setNoteDate('Last saved: ' + fmtDate(updated.modified));
        cacheNote(updated).catch(() => {});
        setIsDirty(false);
        setSaveStatus('ok');
      } else {
        await saveNoteOffline(id, newTitle, newContent, newTags);
        setIsDirty(false);
        setSaveStatus('ok');
        setNoteDate('Saved offline');
      }
    } catch (e) {
      if (e.message?.includes('Unauthorized')) return;
      try {
        await saveNoteOffline(id, newTitle, newContent, newTags);
        setIsDirty(false);
        setSaveStatus('ok');
        setNoteDate('Saved offline');
      } catch {
        setSaveStatus('err');
        showToastMsg('⚠️ Save failed');
      }
    }
  }, []);

  function scheduleSave() {
    setIsDirty(true);
    setSaveStatus('pending');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await saveCurrentNote();
      // Refresh sidebar if title/tags changed
      loadNotesList(search);
    }, 900);
  }

  // ─── Unsaved Modal ─────────────────────────────────
  function showUnsavedModal() {
    return new Promise(resolve => {
      modalResolveRef.current = resolve;
      setShowModal(true);
    });
  }
  function handleModalChoice(choice) {
    setShowModal(false);
    if (modalResolveRef.current) modalResolveRef.current(choice);
  }

  // ─── Word Count ────────────────────────────────────
  function updateWordCount() {
    if (!editorRef.current) return;
    const text = (editorRef.current.innerText || '').trim();
    const words = text ? text.split(/\s+/).length : 0;
    setWordCount(`${words} word${words !== 1 ? 's' : ''} · ${text.length} chars`);
  }

  // ─── Toolbar ───────────────────────────────────────
  function execCmd(cmd, value = null) {
    editorRef.current?.focus();
    if (['h1', 'h2', 'h3'].includes(cmd)) document.execCommand('formatBlock', false, cmd);
    else if (cmd === 'fontSize') document.execCommand('fontSize', false, value);
    else if (cmd === 'foreColor') document.execCommand('foreColor', false, value);
    else document.execCommand(cmd, false, value);
    scheduleSave();
  }

  // ─── Ensure trailing paragraph after blocks ────────
  function ensureTrailingParagraph() {
    const el = editorRef.current;
    if (!el) return;
    const last = el.lastElementChild;
    const BLOCK_TAGS = new Set(['TABLE','BLOCKQUOTE','PRE','HR','DIV','UL','OL','FIGURE']);
    if (last && BLOCK_TAGS.has(last.tagName)) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      el.appendChild(p);
    }
  }

  // ─── Image Upload ──────────────────────────────────
  async function uploadAndInsertImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    showToastMsg('⏳ Uploading image…');
    const fd = new FormData();
    fd.append('file', file, file.name || 'pasted.png');
    fd.append('note_id', activeIdRef.current || 'unsorted');
    try {
      const res = await fetch(API + '/images', {
        method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: fd,
      });
      const data = await res.json();
      editorRef.current?.focus();
      const img = document.createElement('img');
      img.src = data.url; img.alt = data.name;
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents(); range.insertNode(img);
        range.setStartAfter(img); sel.removeAllRanges(); sel.addRange(range);
      } else {
        editorRef.current?.appendChild(img);
      }
      editorRef.current?.appendChild(document.createElement('br'));
      scheduleSave();
      showToastMsg('🖼️ Image inserted!');
    } catch {
      showToastMsg('⚠️ Image upload failed');
    }
  }

  // ─── Tag Management ────────────────────────────────
  function addTag(val) {
    const t = val.trim().replace(/^#/, '');
    if (t && !currentTagsRef.current.includes(t)) {
      const newTags = [...currentTagsRef.current, t];
      setCurrentTags(newTags);
      currentTagsRef.current = newTags;
      scheduleSave();
    }
  }
  function removeTag(idx) {
    const newTags = currentTags.filter((_, i) => i !== idx);
    setCurrentTags(newTags);
    currentTagsRef.current = newTags;
    scheduleSave();
  }

  // ─── Save As HTML ──────────────────────────────────
  function saveAsFile() {
    if (!activeIdRef.current) return;
    const title = titleRef.current || 'Untitled Note';
    const content = editorRef.current?.innerHTML || '';
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#1a1a2e;line-height:1.7}
h1{border-bottom:2px solid #6c63ff;padding-bottom:8px}img{max-width:100%;border-radius:8px;margin:12px 0}
.meta{color:#888;font-size:0.8em;margin-bottom:20px}</style></head>
<body><h1>${title}</h1><div class="meta">Exported from NoteVault on ${new Date().toLocaleString()}</div>${content}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title.replace(/[^a-zA-Z0-9 _-]/g, '')}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToastMsg('📥 Note downloaded as HTML');
  }

  // ─── Keyboard Shortcuts ────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 's') { e.preventDefault(); saveCurrentNote(); }
      if (ctrl && e.key === 'n') { e.preventDefault(); createNote(); }
      if (ctrl && e.key === 'f') { e.preventDefault(); document.getElementById('searchInput')?.focus(); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [saveCurrentNote]);

  // ─── Beforeunload ──────────────────────────────────
  useEffect(() => {
    function handler(e) { if (isDirtyRef.current) { e.preventDefault(); e.returnValue = ''; } }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // ─── Init ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      await Promise.all([loadUserProfile(), loadNotesList().then(notes => {
        if (notes.length > 0) openNote(notes[0].id);
      })]);
      // Background prefetch
      setTimeout(async () => {
        if (!navigator.onLine) return;
        const notes = noteCacheRef.current;
        for (const n of allNotes.slice(1)) {
          if (!notes.has(n.id)) {
            try {
              const full = await apiFetch(`/notes/${n.id}`);
              notes.set(n.id, full);
              cacheNote(full).catch(() => {});
            } catch {}
          }
        }
      }, 1500);
      showToastMsg(navigator.onLine ? '📓 NoteVault ready!' : '📴 Offline mode');
    })();
  }, []);

  // ─── Debounced search ──────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => loadNotesList(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filePickerRef = useRef(null);

  // ─── RENDER ────────────────────────────────────────
  return (
    <>
      {/* Mobile hamburger */}
      <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Offline banner */}
      {showOfflineBanner && (
        <div className="offline-banner show">📴 You are offline — changes will sync when reconnected</div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="logo">
              <span className="logo-icon">📓</span>
              <span className="logo-text">NoteVault</span>
            </div>
            <button className="btn-theme" onClick={() => setIsLight(!isLight)} title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}>
              {isLight ? '🌙' : '☀️'}
            </button>
          </div>

          {/* User strip */}
          <div className={`user-strip ${menuOpen ? 'menu-open' : ''}`} tabIndex={0}
            onClick={(e) => { if (!e.target.closest('#btnLogout')) setMenuOpen(!menuOpen); }}>
            <div className="user-strip-content">
              <div className="user-avatar">
                {user.avatar && user.avatar.startsWith('http') ? <img src={user.avatar} alt="avatar" /> :
                  ((user.name || user.email || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())}
              </div>
              <div className="user-info">
                <div className="user-name">{user.username ? `@${user.username}` : (user.name || user.email || 'User')}</div>
                <div className="user-role">{user.role || ''}</div>
              </div>
              <span className="user-menu-icon">⋮</span>
            </div>
            <div className="user-dropdown">
              <button className="dropdown-item danger" id="btnLogout"
                onClick={(e) => { e.stopPropagation(); localStorage.removeItem('nv_token'); localStorage.removeItem('nv_user'); navigate('/login'); }}>
                <span className="dropdown-icon">⏏</span> Sign out
              </button>
            </div>
          </div>

          <button className="btn-new" onClick={createNote}>＋ New Note</button>
        </div>

        <div className="search-wrap">
          <span className="search-icon">🔍</span>
          <input type="text" id="searchInput" placeholder="Search notes…" autoComplete="off"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="notes-list-label">Notes</div>
        <ul className="notes-list">
          {allNotes.length === 0 && (
            <li style={{ color: 'var(--muted)', fontSize: '.82rem', padding: 16, textAlign: 'center' }}>
              {search ? 'No notes match your search.' : 'No notes yet.'}
            </li>
          )}
          {allNotes.map(n => (
            <li key={n.id} className={`note-item ${n.id === activeId ? 'active' : ''}`}
              onClick={async () => {
                if (n.id === activeId) return;
                if (isDirtyRef.current) {
                  const choice = await showUnsavedModal();
                  if (choice === 'save') await saveCurrentNote();
                  else if (choice === 'cancel') return;
                }
                setIsDirty(false);
                openNote(n.id);
              }}>
              <div className="note-item-title">{escHTML(n.title || 'Untitled')}</div>
              <div className="note-item-meta"><span>{fmtDate(n.modified || n.updated_at)}</span></div>
              <div className="note-item-preview">{stripHTML(n.content || '').slice(0, 80)}</div>
              {(n.tags || []).length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {n.tags.map((t, i) => <span key={i} className="note-tag">#{t}</span>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </aside>

      {/* Sidebar overlay (mobile) */}
      <div className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)} />

      {/* Main */}
      <main className="main">
        {/* Empty state */}
        {!activeId && (
          <div className="empty-state">
            <div className="empty-icon">📝</div>
            <h2>No note selected</h2>
            <p>Select a note from the sidebar or create a new one.</p>
            <button className="btn-new-lg" onClick={createNote}>＋ Create your first note</button>
          </div>
        )}

        {/* Editor panel */}
        {activeId && (
          <div className="editor-panel" style={{ display: 'flex' }}>
            <div className="editor-topbar">
              <input type="text" className="note-title-input" placeholder="Note title…"
                value={noteTitle} onChange={e => { setNoteTitle(e.target.value); titleRef.current = e.target.value; scheduleSave(); }} />
              <div className="topbar-actions">
                <span className="note-date">{noteDate}</span>
                <button className="btn-icon danger" onClick={deleteNote} title="Delete note">🗑️</button>
              </div>
            </div>

            {/* Toolbar */}
            <div className="toolbar">
              {[
                { cmd: 'bold', label: <b>B</b>, title: 'Bold' },
                { cmd: 'italic', label: <i>I</i>, title: 'Italic' },
                { cmd: 'underline', label: <u>U</u>, title: 'Underline' },
                { cmd: 'strikeThrough', label: <s>S</s>, title: 'Strike' },
              ].map(b => <button key={b.cmd} className="tb-btn" title={b.title} onMouseDown={e => { e.preventDefault(); execCmd(b.cmd); }}>{b.label}</button>)}

              <span className="tb-divider" />

              <button className="tb-btn" title="Bullet list" onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList'); }}>≡ •</button>
              <button className="tb-btn" title="Numbered list" onMouseDown={e => { e.preventDefault(); execCmd('insertOrderedList'); }}>≡ 1</button>

              <span className="tb-divider" />

              {['h1', 'h2', 'h3'].map(h => (
                <button key={h} className="tb-btn" title={`Heading ${h[1]}`} onMouseDown={e => { e.preventDefault(); execCmd(h); }}>{h.toUpperCase()}</button>
              ))}

              <span className="tb-divider" />

              <select className="tb-select" title="Font size" defaultValue="3"
                onChange={e => execCmd('fontSize', e.target.value)}>
                <option value="1">Tiny</option><option value="2">Small</option>
                <option value="3">Normal</option><option value="4">Large</option>
                <option value="5">XL</option><option value="6">XXL</option>
              </select>
              <input type="color" className="tb-color" title="Text color" defaultValue="#e2e8f0"
                onInput={e => execCmd('foreColor', e.target.value)} />

              <span className="tb-divider" />

              <button className="tb-btn" title="Align left" onMouseDown={e => { e.preventDefault(); execCmd('justifyLeft'); }}>⬅</button>
              <button className="tb-btn" title="Align center" onMouseDown={e => { e.preventDefault(); execCmd('justifyCenter'); }}>↔</button>
              <button className="tb-btn" title="Align right" onMouseDown={e => { e.preventDefault(); execCmd('justifyRight'); }}>➡</button>

              <span className="tb-divider" />

              <button className="tb-btn" title="Insert image" onClick={() => filePickerRef.current?.click()}>🖼️ Image</button>
              <button className="tb-btn" title="Insert link" onClick={() => {
                const url = prompt('Enter URL:', 'https://');
                if (url) { execCmd('createLink', url); }
              }}>🔗 Link</button>
              <button className="tb-btn" title="Clear formatting" onMouseDown={e => { e.preventDefault(); execCmd('removeFormat'); }}>✕ Format</button>

              <span className="tb-divider" />

              <button className="tb-btn" onClick={() => { document.execCommand('undo'); scheduleSave(); }}>↩ Undo</button>
              <button className="tb-btn" onClick={() => { document.execCommand('redo'); scheduleSave(); }}>↪ Redo</button>

              <span className="tb-divider" />

              <button className="tb-btn tb-save" onClick={() => { saveCurrentNote(); showToastMsg('💾 Saved!'); }}>💾 Save</button>
              <button className="tb-btn tb-saveas" onClick={saveAsFile}>📥Download</button>
            </div>

            {/* Editor body */}
            <div className="editor-body" ref={editorRef} contentEditable suppressContentEditableWarning
              spellCheck data-placeholder="Start writing… paste text and images freely 🚀"
              onInput={() => { updateWordCount(); ensureTrailingParagraph(); scheduleSave(); }}
              onPaste={e => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const item of items) {
                  if (item.type.startsWith('image/')) { e.preventDefault(); uploadAndInsertImage(item.getAsFile()); return; }
                }
                setTimeout(scheduleSave, 100);
              }}
              onDragOver={e => { e.preventDefault(); editorRef.current.style.outline = '2px dashed var(--accent)'; }}
              onDragLeave={() => { editorRef.current.style.outline = ''; }}
              onDrop={e => {
                e.preventDefault(); editorRef.current.style.outline = '';
                Array.from(e.dataTransfer?.files || []).forEach(uploadAndInsertImage);
              }}
            />

            {/* Tags row */}
            <div className="tags-row">
              <span className="tags-label">Tags:</span>
              <div className="tags-container">
                {currentTags.map((tag, idx) => (
                  <span key={idx} className="tag-chip">
                    #{escHTML(tag)} <button className="tag-remove" onClick={() => removeTag(idx)}>✕</button>
                  </span>
                ))}
                <input type="text" className="tags-input" placeholder="Type a tag & press Enter"
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(e.target.value); e.target.value = ''; }
                    if (e.key === 'Backspace' && e.target.value === '' && currentTags.length > 0) {
                      e.preventDefault(); removeTag(currentTags.length - 1);
                    }
                  }} />
              </div>
            </div>

            {/* Status bar */}
            <div className="statusbar">
              <span>{wordCount}</span>
              <span className={saveStatus === 'ok' ? 'save-ok' : saveStatus === 'pending' ? 'save-pending' : 'save-err'}>
                {saveStatus === 'ok' ? '✔ Saved' : saveStatus === 'pending' ? '⏳ Saving…' : '✖ Error'}
              </span>
            </div>
          </div>
        )}
      </main>

      {/* Hidden file picker */}
      <input type="file" ref={filePickerRef} accept="image/*" multiple style={{ display: 'none' }}
        onChange={e => { Array.from(e.target.files).forEach(uploadAndInsertImage); e.target.value = ''; }} />

      {/* Unsaved Changes Modal */}
      {showModal && (
        <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) handleModalChoice('discard'); }}>
          <div className="modal-box">
            <div className="modal-icon">⚠️</div>
            <h3 className="modal-title">Unsaved Changes</h3>
            <p className="modal-msg">You have unsaved changes. What would you like to do?</p>
            <div className="modal-actions">
              <button className="modal-btn primary" onClick={() => handleModalChoice('save')}>💾 Save & Continue</button>
              <button className="modal-btn danger" onClick={() => handleModalChoice('discard')}>🗑 Don't Save</button>
              <button className="modal-btn secondary" onClick={() => handleModalChoice('cancel')}>✕ Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`toast ${toast.show ? 'show' : ''}`}>{toast.msg}</div>
    </>
  );
}
