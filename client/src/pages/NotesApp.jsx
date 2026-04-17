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
  const [isOnline, setIsOnline] = useState(true);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const isOnlineRef = useRef(true);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [lineSpacing, setLineSpacing] = useState('1.75');
  const [docStats, setDocStats] = useState({ words: 0, chars: 0, sentences: 0, paragraphs: 0, readTime: '0 min' });
  const [directFontSize, setDirectFontSize] = useState('16');
  const [wordSpacing, setWordSpacing] = useState('normal');
  // Normal/Custom toggle states
  const [sizeMode, setSizeMode] = useState('normal');
  const [markMode, setMarkMode] = useState('normal');
  const [textColorMode, setTextColorMode] = useState('normal');
  const [lineSpaceMode, setLineSpaceMode] = useState('normal');
  const [wordSpaceMode, setWordSpaceMode] = useState('normal');
  const [customMarkColor, setCustomMarkColor] = useState('#ffff00');
  const [customTextColor, setCustomTextColor] = useState('#e2e8f0');

  const activeIdRef = useRef(null);
  const isDirtyRef = useRef(false);
  const currentTagsRef = useRef([]);
  const titleRef = useRef('');
  const modalResolveRef = useRef(null);
  const savedRangeRef = useRef(null);
  const directFontSizeRef = useRef('16');

  // Keep refs in sync with state
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { currentTagsRef.current = currentTags; }, [currentTags]);
  useEffect(() => { directFontSizeRef.current = directFontSize; }, [directFontSize]);
  useEffect(() => { titleRef.current = noteTitle; }, [noteTitle]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  useEffect(() => {
    function handleSelection() {
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
        savedRangeRef.current = sel.getRangeAt(0);
      }
    }
    document.addEventListener('selectionchange', handleSelection);
    return () => document.removeEventListener('selectionchange', handleSelection);
  }, []);

  // ─── Server Reachability Check ─────────────────────
  async function checkServerReachable() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(API + '/health', { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

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
    if (!res.ok) {
      let errorMsg = `API ${path} → ${res.status}`;
      try {
        const errorData = await res.json();
        if (errorData.error) errorMsg = errorData.error;
      } catch {}
      const error = new Error(errorMsg);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  // ─── Theme ─────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle('light', isLight);
    localStorage.setItem('nv_theme', isLight ? 'light' : 'dark');
  }, [isLight]);

  // ─── Online/Offline detection (ping-based) ────────
  useEffect(() => {
    let intervalId;
    async function pingServer() {
      const reachable = await checkServerReachable();
      if (reachable && !isOnlineRef.current) {
        // Was offline, now back online
        setIsOnline(true); setShowOfflineBanner(false);
        syncQueue(API, getToken());
      } else if (!reachable && isOnlineRef.current) {
        // Was online, server went away
        setIsOnline(false); setShowOfflineBanner(true);
      }
    }
    // Check immediately on mount
    pingServer();
    // Then poll every 5 seconds
    intervalId = setInterval(pingServer, 5000);
    // Also listen for browser online/offline as a hint to re-check immediately
    const goOnline = () => pingServer();
    const goOffline = () => pingServer();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
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
      // Always try API first (works for both local server + deployed)
      const url = q ? `/notes?q=${encodeURIComponent(q)}` : '/notes';
      notes = await apiFetch(url);
      cacheNotes(notes).catch(() => {});
    } catch (e) {
      if (!e.message.includes('Unauthorized')) {
        // API failed — fall back to offline cache
        notes = await getOfflineNotes().catch(() => []);
        if (q) {
          const ql = q.toLowerCase();
          notes = notes.filter(n => (n.title || '').toLowerCase().includes(ql));
        }
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
        // Always try API first
        note = await apiFetch(`/notes/${id}`);
        noteCacheRef.current.set(id, note);
        cacheNote(note).catch(() => {});
      } catch {
        // API failed — try offline cache
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
      // Try API first
      const note = await apiFetch('/notes', { method: 'POST', body: JSON.stringify({ title: 'Untitled Note', content: '', tags: [] }) });
      cacheNote(note).catch(() => {});
      const notes = await loadNotesList();
      await openNote(note.id);
    } catch {
      // API failed — create offline
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
      // Try API first
      await apiFetch(`/notes/${id}`, { method: 'DELETE' });
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
      // Always try API first
      const updated = await apiFetch(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle, content: newContent, tags: newTags }),
      });
      noteCacheRef.current.set(id, updated);
      setNoteDate('Last saved: ' + fmtDate(updated.modified));
      cacheNote(updated).catch(() => {});
      setIsDirty(false);
      setSaveStatus('ok');
    } catch (e) {
      // Check if it's a duplicate name error (409 Conflict)
      if (e.status === 409 || e.message?.includes('already exists')) {
        showToastMsg('⚠️ ' + e.message);
        setSaveStatus('err');
        return;
      }
      if (e.message?.includes('Unauthorized')) return;
      // API unreachable — save offline
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

  // ─── Word Count & Statistics ───────────────────
  function updateWordCount() {
    if (!editorRef.current) return;
    const text = (editorRef.current.innerText || '').trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.length;
    const sentences = text ? (text.match(/[.!?]+/g) || []).length : 0;
    const paragraphs = text ? (editorRef.current.innerHTML.match(/<p[^>]*><|<div[^>]*></g) || []).length : 0;
    const readTime = Math.max(1, Math.round(words / 200)); // avg 200 words per minute
    setWordCount(`${words} word${words !== 1 ? 's' : ''} · ${chars} chars`);
    setDocStats({ words, chars, sentences: Math.max(0, sentences), paragraphs: Math.max(1, paragraphs), readTime: `${readTime} min` });
  }

  // ─── Find & Replace ───────────────────────────────
  function findAndHighlight(text) {
    if (!text) return;
    const body = editorRef.current;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    let node;
    const matches = [];
    while (node = walker.nextNode()) {
      const idx = node.textContent.toLowerCase().indexOf(text.toLowerCase());
      if (idx !== -1) matches.push({ node, idx });
    }
    matches.forEach(m => {
      const span = document.createElement('mark');
      span.style.backgroundColor = 'rgba(255,193,7,.6)';
      const match = m.node.splitText(m.idx);
      match.splitText(text.length);
      span.appendChild(match.cloneNode(true));
      match.parentNode.replaceChild(span, match);
    });
  }

  function findAndReplace(findStr, replaceStr, all = true) {
    if (!findStr) return;
    const body = editorRef.current;
    const html = body.innerHTML;
    let newHtml;
    if (all) newHtml = html.replaceAll(findStr, replaceStr);
    else newHtml = html.replace(findStr, replaceStr);
    body.innerHTML = newHtml;
    scheduleSave();
    showToastMsg(`✅ Replaced ${all ? 'all' : '1'} occurrence(s)`);
  }

  // ─── Line Spacing ────────────────────────────────
  function setSelectedLineSpacing(spacing) {
    setLineSpacing(spacing);
    if (editorRef.current) editorRef.current.style.lineHeight = spacing;
  }

  // ─── Word Spacing ────────────────────────────────
  function setSelectedWordSpacing(spacing) {
    setWordSpacing(spacing);
    if (editorRef.current) editorRef.current.style.wordSpacing = spacing === 'normal' ? 'normal' : spacing + 'px';
  }

  // ─── Insert Table ──────────────────────────────────
  function insertTable() {
    const rows = prompt('Number of rows:', '3');
    const cols = prompt('Number of columns:', '3');
    if (!rows || !cols) return;
    const r = parseInt(rows); const c = parseInt(cols);
    if (r < 1 || c < 1 || r > 50 || c > 50) { showToastMsg('⚠️ Invalid table size'); return; }
    
    let tableHtml = '<table style="border-collapse:collapse;width:100%;margin:12px 0;"><tbody>';
    for (let i = 0; i < r; i++) {
      tableHtml += '<tr>';
      for (let j = 0; j < c; j++) {
        tableHtml += `<td style="border:1px solid var(--border);padding:8px;text-align:left;">Cell</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table><p><br></p>';
    
    document.execCommand('insertHTML', false, tableHtml);
    scheduleSave();
    showToastMsg('📊 Table inserted');
  }

  // ─── Advanced Text Formatting ─────────────────────
  function toggleHighlight(color) {
    const c = color || '#00ff00';
    document.execCommand('backColor', false, c);
    scheduleSave();
  }

  function applySuperscript() {
    document.execCommand('superscript');
    scheduleSave();
  }

  function applySubscript() {
    document.execCommand('subscript');
    scheduleSave();
  }

  function insertHorizontalRule() {
    document.execCommand('insertHorizontalRule');
    scheduleSave();
  }

  function insertCode() {
    const code = prompt('Enter code:');
    if (code) {
      document.execCommand('insertHTML', false, `<code style="background:var(--pre-bg);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.9em;">${code}</code>`);
      scheduleSave();
    }
  }

  // ─── Print Document ────────────────────────────────
  function printDocument() {
    const title = titleRef.current || 'Untitled Note';
    const content = editorRef.current?.innerHTML || '';
    const printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #1a1a2e; line-height: 1.75; }
          h1 { border-bottom: 2px solid #6c63ff; padding-bottom: 10px; margin-bottom: 20px; }
          table { border-collapse: collapse; width: 100%; margin: 12px 0; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background: #f0f0f0; font-weight: bold; }
          img { max-width: 100%; margin: 12px 0; }
          code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
          .print-date { color: #999; font-size: 0.9em; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        ${content}
        <div class="print-date">Printed from NoteVault on ${new Date().toLocaleString()}</div>
      </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  }

  // ─── Toolbar ───────────────────────────────────────
  function execCmd(cmd, value = null) {
    editorRef.current?.focus({ preventScroll: true });
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
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
      editorRef.current?.focus({ preventScroll: true });
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

  // ─── Zoom Controls ────────────────────────────────
  function increaseZoom() {
    const newZoom = Math.min(zoomLevel + 10, 200);
    setZoomLevel(newZoom);
    if (editorRef.current) editorRef.current.style.fontSize = (newZoom / 100) * 16 + 'px';
  }
  function decreaseZoom() {
    const newZoom = Math.max(zoomLevel - 10, 50);
    setZoomLevel(newZoom);
    if (editorRef.current) editorRef.current.style.fontSize = (newZoom / 100) * 16 + 'px';
  }
  function resetZoom() {
    setZoomLevel(100);
    if (editorRef.current) editorRef.current.style.fontSize = '16px';
  }

  // ─── Selected Text Size Increaser ───────────────
  function increaseSelectedTextSize() {
    const selection = window.getSelection();
    if (!selection.toString()) { showToastMsg('⚠️ Select text first'); return; }
    editorRef.current?.focus({ preventScroll: true });
    const sizes = ['1', '2', '3', '4', '5', '6', '7'];
    const currentSize = document.queryCommandValue('fontSize');
    let currentIdx = sizes.indexOf(currentSize);
    if (currentIdx === -1) currentIdx = 2; // default to Normal if unknown
    const nextIdx = Math.min(currentIdx + 1, sizes.length - 1);
    document.execCommand('fontSize', false, sizes[nextIdx]);
    scheduleSave();
    showToastMsg(`📏 Text size increased`);
  }
  function decreaseSelectedTextSize() {
    const selection = window.getSelection();
    if (!selection.toString()) { showToastMsg('⚠️ Select text first'); return; }
    editorRef.current?.focus({ preventScroll: true });
    const sizes = ['1', '2', '3', '4', '5', '6', '7'];
    const currentSize = document.queryCommandValue('fontSize');
    let currentIdx = sizes.indexOf(currentSize);
    if (currentIdx === -1) currentIdx = 2; // default to Normal if unknown
    const prevIdx = Math.max(currentIdx - 1, 0);
    document.execCommand('fontSize', false, sizes[prevIdx]);
    scheduleSave();
  }

  // ─── Direct Font Size Input ──────────────────────
  function setDirectTextSize(value) {
    const size = parseInt(value);
    if (isNaN(size) || size < 1 || size > 30) {
      showToastMsg('⚠️ Enter number 1-30');
      return;
    }
    
    // Make sure we select the editor
    editorRef.current?.focus({ preventScroll: true });
    
    // Restore the exact caret position/selection we had before clicking the input box
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    // Freeze all PREVIOUSLY set 7 tags so they don't get overwritten
    document.querySelectorAll('font[size="7"]').forEach(f => { f.dataset.old = "1"; });

    // Tell the browser natively to switch to size 7 for the selection OR for the current caret
    // This allows Chrome to completely handle splitting nested DOM elements when you change sizes mid-paragraph!
    document.execCommand('fontSize', false, '7');
    
    // If text was selected, and Chrome wrapped it instantly, update it immediately:
    document.querySelectorAll('font[size="7"]:not([data-old="1"])').forEach(f => {
      f.style.fontSize = size + 'pt';
    });

    setDirectFontSize(String(size));
    scheduleSave();
    showToastMsg(`📏 Text size set to ${size}`);
  }

  // ─── Keyboard Shortcuts ────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 's') { e.preventDefault(); saveCurrentNote(); }
      if (ctrl && e.key === 'n') { e.preventDefault(); createNote(); }
      if (ctrl && e.key === 'f') { e.preventDefault(); setShowFindReplace(true); }
      if (ctrl && e.shiftKey && e.key === 'H') { e.preventDefault(); setShowFindReplace(true); }
      if (ctrl && e.key === '+' || ctrl && e.key === '=') { e.preventDefault(); increaseZoom(); }
      if (ctrl && e.key === '-') { e.preventDefault(); decreaseZoom(); }
      if (ctrl && e.key === '0') { e.preventDefault(); resetZoom(); }
      if (ctrl && e.key === 'p') { e.preventDefault(); printDocument(); }
      if (e.key === 'Escape' && showFindReplace) { setShowFindReplace(false); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [saveCurrentNote, zoomLevel, showFindReplace]);

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
      // Background prefetch (try API, silently skip on failure)
      setTimeout(async () => {
        const notes = noteCacheRef.current;
        for (const n of allNotes.slice(1)) {
          if (!notes.has(n.id)) {
            try {
              const full = await apiFetch(`/notes/${n.id}`);
              notes.set(n.id, full);
              cacheNote(full).catch(() => {});
            } catch { break; } // stop prefetch if server unreachable
          }
        }
      }, 1500);
      // Show ready toast based on actual server reachability
      const serverUp = await checkServerReachable();
      showToastMsg(serverUp ? '📓 NoteVault ready!' : '📴 Offline mode');
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

              <button className="tb-btn" title="Superscript" onMouseDown={e => { e.preventDefault(); applySuperscript(); }}>x<sup>²</sup></button>
              <button className="tb-btn" title="Subscript" onMouseDown={e => { e.preventDefault(); applySubscript(); }}>x<sub>₂</sub></button>

              {/* ── Mark (Highlight) : Normal=Green / Custom=Color Picker ── */}
              <select className="tb-select" title="Highlight mode" value={markMode}
                style={{ width: '80px' }}
                onChange={e => {
                  setMarkMode(e.target.value);
                  if (e.target.value === 'normal') toggleHighlight('#00ff00');
                }}>
                <option value="normal">🖍️ Mark</option>
                <option value="custom">Custom</option>
              </select>
              {markMode === 'custom' && (
                <input type="color" className="tb-color" title="Pick highlight color" value={customMarkColor}
                  onInput={e => { setCustomMarkColor(e.target.value); toggleHighlight(e.target.value); }} />
              )}

              <span className="tb-divider" />

              <button className="tb-btn" title="Bullet list" onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList'); }}>≡ •</button>
              <button className="tb-btn" title="Numbered list" onMouseDown={e => { e.preventDefault(); execCmd('insertOrderedList'); }}>≡ 1</button>

              <span className="tb-divider" />

              {['h1', 'h2', 'h3'].map(h => (
                <button key={h} className="tb-btn" title={`Heading ${h[1]}`} onMouseDown={e => { e.preventDefault(); execCmd(h); }}>{h.toUpperCase()}</button>
              ))}

              {/* ── Text Size : Normal=default / Custom=number input ── */}
              <select className="tb-select" title="Text size mode" value={sizeMode}
                style={{ width: '80px' }}
                onChange={e => {
                  setSizeMode(e.target.value);
                  if (e.target.value === 'normal') { setDirectFontSize('3'); execCmd('fontSize', '3'); }
                }}>
                <option value="normal">Size ⓝ</option>
                <option value="custom">Custom</option>
              </select>
              {sizeMode === 'custom' && (
                <input type="number" className="tb-select" min="1" max="30" 
                  title="Font size (1-30)" placeholder="12" style={{ width: '50px', height: '28px' }}
                  value={directFontSize} 
                  onChange={e => setDirectFontSize(e.target.value)}
                  onKeyDown={e => { 
                    if (e.key === 'Enter') { 
                      e.preventDefault(); 
                      setDirectTextSize(directFontSize); 
                    } 
                  }}
                  onBlur={() => setDirectTextSize(directFontSize)}
                />
              )}

              {/* ── Text Color : Normal=default / Custom=Color Picker ── */}
              <select className="tb-select" title="Text color mode" value={textColorMode}
                style={{ width: '80px' }}
                onChange={e => {
                  setTextColorMode(e.target.value);
                  if (e.target.value === 'normal') execCmd('foreColor', '#e2e8f0');
                }}>
                <option value="normal">Color ⓝ</option>
                <option value="custom">Custom</option>
              </select>
              {textColorMode === 'custom' && (
                <input type="color" className="tb-color" title="Pick text color" value={customTextColor}
                  onInput={e => { setCustomTextColor(e.target.value); execCmd('foreColor', e.target.value); }} />
              )}

              <span className="tb-divider" />

              <button className="tb-btn" title="Align left" onMouseDown={e => { e.preventDefault(); execCmd('justifyLeft'); }}>⬅</button>
              <button className="tb-btn" title="Align center" onMouseDown={e => { e.preventDefault(); execCmd('justifyCenter'); }}>↔</button>
              <button className="tb-btn" title="Align right" onMouseDown={e => { e.preventDefault(); execCmd('justifyRight'); }}>➡</button>
              <button className="tb-btn" title="Align justify" onMouseDown={e => { e.preventDefault(); execCmd('justifyFull'); }}>⇔</button>

              <span className="tb-divider" />

              {/* ── Line Spacing : Normal=1.75 / Custom=input ── */}
              <select className="tb-select" title="Line spacing mode" value={lineSpaceMode}
                style={{ width: '90px' }}
                onChange={e => {
                  setLineSpaceMode(e.target.value);
                  if (e.target.value === 'normal') setSelectedLineSpacing('1.75');
                }}>
                <option value="normal">Line ⓝ</option>
                <option value="custom">Custom</option>
              </select>
              {lineSpaceMode === 'custom' && (
                <input type="number" className="tb-select" min="0.5" max="5" step="0.25"
                  title="Line spacing" placeholder="1.75" style={{ width: '55px', height: '28px' }}
                  value={lineSpacing}
                  onChange={e => setSelectedLineSpacing(e.target.value)}
                />
              )}

              {/* ── Word Spacing : Normal / Custom=input ── */}
              <select className="tb-select" title="Word spacing mode" value={wordSpaceMode}
                style={{ width: '90px' }}
                onChange={e => {
                  setWordSpaceMode(e.target.value);
                  if (e.target.value === 'normal') setSelectedWordSpacing('normal');
                }}>
                <option value="normal">Word ⓝ</option>
                <option value="custom">Custom</option>
              </select>
              {wordSpaceMode === 'custom' && (
                <input type="number" className="tb-select" min="0" max="50" step="1"
                  title="Word spacing (px)" placeholder="0" style={{ width: '50px', height: '28px' }}
                  value={wordSpacing === 'normal' ? '' : wordSpacing}
                  onChange={e => setSelectedWordSpacing(e.target.value || 'normal')}
                />
              )}

              <span className="tb-divider" />

              <button className="tb-btn" title="Insert image" onClick={() => filePickerRef.current?.click()}>🖼️ Image</button>
              <button className="tb-btn" title="Insert link" onClick={() => {
                const url = prompt('Enter URL:', 'https://');
                if (url) { execCmd('createLink', url); }
              }}>🔗 Link</button>
              <button className="tb-btn" title="Insert table" onClick={insertTable}>📊 Table</button>
              <button className="tb-btn" title="Insert code" onClick={insertCode}>{'</>'} Code</button>
              <button className="tb-btn" title="Horizontal rule" onMouseDown={e => { e.preventDefault(); insertHorizontalRule(); }}>─ Line</button>
              <button className="tb-btn" title="Clear formatting" onMouseDown={e => { e.preventDefault(); execCmd('removeFormat'); }}>✕ Format</button>

              <span className="tb-divider" />

              <button className="tb-btn" title="Increase selected text size" onClick={increaseSelectedTextSize}>📏 ↑</button>
              <button className="tb-btn" title="Decrease selected text size" onClick={decreaseSelectedTextSize}>📏 ↓</button>

              <span className="tb-divider" />

              <button className="tb-btn" title="Zoom in (Ctrl++)" onClick={increaseZoom}>🔍 +</button>
              <button className="tb-btn" title="Zoom out (Ctrl+-)" onClick={decreaseZoom}>🔍 -</button>
              <button className="tb-btn" title="Reset zoom (Ctrl+0)" onClick={resetZoom}>🔍 {zoomLevel}%</button>

              <span className="tb-divider" />

              <button className="tb-btn" title="Find & Replace (Ctrl+H)" onClick={() => setShowFindReplace(!showFindReplace)}>🔍 Find</button>
              <button className="tb-btn" title="Print document (Ctrl+P)" onClick={printDocument}>🖨️ Print</button>
              <button className="tb-btn" title="Document stats" onClick={() => showToastMsg(`📊 Words: ${docStats.words} | Chars: ${docStats.chars} | Sentences: ${docStats.sentences} | Paragraphs: ${docStats.paragraphs} | Reading time: ${docStats.readTime}`, 4000)}>📈 Stats</button>

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
              onClick={e => {
                const el = editorRef.current;
                if (!el) return;
                // Get the last child element's bottom position
                const lastChild = el.lastElementChild || el.lastChild;
                const clickY = e.clientY;
                const editorRect = el.getBoundingClientRect();
                const contentBottom = lastChild 
                  ? lastChild.getBoundingClientRect().bottom 
                  : editorRect.top;
                // If clicked below all content, add empty lines to fill to that point
                if (clickY > contentBottom + 5) {
                  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
                  const linesNeeded = Math.max(1, Math.ceil((clickY - contentBottom) / lineHeight));
                  for (let i = 0; i < linesNeeded; i++) {
                    const p = document.createElement('p');
                    p.innerHTML = '<br>';
                    el.appendChild(p);
                  }
                  // Place cursor in the last added paragraph
                  const lastP = el.lastElementChild;
                  const range = document.createRange();
                  range.setStart(lastP, 0);
                  range.collapse(true);
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  sel.addRange(range);
                  scheduleSave();
                }
              }}
              onInput={() => {
                document.querySelectorAll('font[size="7"]:not([data-old="1"])').forEach(f => {
                  if (directFontSizeRef.current) f.style.fontSize = directFontSizeRef.current + 'pt';
                });
                updateWordCount(); ensureTrailingParagraph(); scheduleSave(); 
              }}
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

      {/* Find & Replace Modal */}
      {showFindReplace && (
        <div className="find-replace-panel">
          <div className="find-replace-header">
            <h3>🔍 Find & Replace</h3>
            <button className="close-btn" onClick={() => setShowFindReplace(false)}>✕</button>
          </div>
          <div className="find-replace-body">
            <div className="find-group">
              <label>Find:</label>
              <input type="text" placeholder="Search text…" value={findText} onChange={e => setFindText(e.target.value)} autoFocus />
              <button className="find-btn" onClick={() => findAndHighlight(findText)}>Highlight</button>
            </div>
            <div className="replace-group">
              <label>Replace:</label>
              <input type="text" placeholder="Replace with…" value={replaceText} onChange={e => setReplaceText(e.target.value)} />
              <div className="replace-buttons">
                <button className="replace-btn single" onClick={() => findAndReplace(findText, replaceText, false)}>Replace</button>
                <button className="replace-btn all" onClick={() => findAndReplace(findText, replaceText, true)}>Replace All</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
