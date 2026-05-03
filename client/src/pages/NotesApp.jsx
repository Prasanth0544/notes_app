import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../config.js';
import {
  cacheNotes, cacheNote, getOfflineNotes, getOfflineNote, getOfflineTrash,
  saveNoteOffline, deleteNoteOffline, trashNoteOffline, restoreNoteOffline,
  permanentDeleteOffline, pinNoteOffline,
  cacheFolders, getOfflineFolders, createFolderOffline, deleteFolderOffline,
  syncQueue, getLastSync, setLastSync, getStorageEstimate, requestPersistentStorage,
  getNoteIdsWithContent, cleanupStaleNotes,
} from '../offline.js';
import TabBar from './TabBar.jsx';
import ProfileModal from './ProfileModal.jsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

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
  const [toastQueue, setToastQueue] = useState([]);  // [{id, msg}]
  const [isLight, setIsLight] = useState(localStorage.getItem('nv_theme') !== 'dark');
  const [showModal, setShowModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const isOnlineRef = useRef(true);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(window.innerWidth < 768);
  const [titleBarCollapsed, setTitleBarCollapsed] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
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
  // Trash & Folders
  const [sidebarView, setSidebarView] = useState('notes'); // 'notes' | 'trash'
  const [trashNotes, setTrashNotes] = useState([]);
  const [trashFolders, setTrashFolders] = useState([]); // Array of { name, deleted_at, notes: [...] }
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState('');    // '' = all notes
  const [noteFolder, setNoteFolder] = useState('');        // current note's folder
  const [openTabs, setOpenTabs] = useState([]);            // [{id, title}]
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const folderRankingRef = useRef(new Map());
  const folderAccessTimers = useRef(new Map());

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
    let selThrottleTimer = null;
    function handleSelection() {
      if (selThrottleTimer) return; // throttle to ~50ms
      selThrottleTimer = setTimeout(() => { selThrottleTimer = null; }, 50);
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
        savedRangeRef.current = sel.getRangeAt(0);
      }
    }
    document.addEventListener('selectionchange', handleSelection);
    return () => { document.removeEventListener('selectionchange', handleSelection); clearTimeout(selThrottleTimer); };
  }, []);

  // ─── Server Reachability Check ─────────────────────
  async function checkServerReachable() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000); // 4s for mobile networks
      const res = await fetch(API + '/health', { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Helpers ───────────────────────────────────────
  function getToken() { return localStorage.getItem('nv_token'); }

  const toastIdRef = useRef(0);
  function showToastMsg(msg, duration = 2400) {
    const id = ++toastIdRef.current;
    setToastQueue(prev => [...prev.slice(-4), { id, msg }]); // keep max 5
    setTimeout(() => setToastQueue(prev => prev.filter(t => t.id !== id)), duration);
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function escHTML(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // Reuse a single detached element for stripHTML instead of creating one each call
  const stripHTMLDiv = useRef(document.createElement('div'));
  function stripHTML(h) { stripHTMLDiv.current.innerHTML = h; return stripHTMLDiv.current.textContent || ''; }

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
      } catch { }
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

  // ─── Online/Offline detection (adaptive backoff) ───
  useEffect(() => {
    let intervalId;
    let successCount = 0;
    function getInterval() {
      // Exponential backoff: 15s → 30s → 60s after consecutive successes
      if (successCount >= 8) return 60000;
      if (successCount >= 4) return 30000;
      return 15000;
    }
    function scheduleNext() {
      clearInterval(intervalId);
      intervalId = setTimeout(async () => { await pingServer(); scheduleNext(); }, getInterval());
    }
    async function pingServer() {
      // Skip polling when the tab is hidden to save bandwidth
      if (document.hidden) return;
      const reachable = await checkServerReachable();
      if (reachable && !isOnlineRef.current) {
        // Was offline, now back online
        isOnlineRef.current = true;
        setIsOnline(true); setShowOfflineBanner(false);
        successCount = 0;
        await syncQueue(API, getToken());
        // Refresh UI after sync
        loadNotesList('', '').catch(() => { });
        loadFolders();
      } else if (!reachable && isOnlineRef.current) {
        // Was online, server went away
        isOnlineRef.current = false;
        setIsOnline(false); setShowOfflineBanner(true);
        successCount = 0;
      } else if (reachable) {
        successCount++;
      } else {
        successCount = 0;
      }
    }
    // Check immediately on mount
    pingServer().then(scheduleNext);
    // Re-check immediately when tab becomes visible again
    const onVisibility = () => { if (!document.hidden) { pingServer(); scheduleNext(); } };
    document.addEventListener('visibilitychange', onVisibility);
    // Also listen for browser online/offline as a hint to re-check immediately
    const goOnline = () => { pingServer(); scheduleNext(); };
    const goOffline = () => { pingServer(); scheduleNext(); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearTimeout(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // ─── Load User Profile ─────────────────────────────
  async function loadUserProfile() {
    try {
      const cached = JSON.parse(localStorage.getItem('nv_user') || '{}');
      if (cached.name) setUser(cached);
    } catch { }
    try {
      const u = await apiFetch('/auth/me');
      localStorage.setItem('nv_user', JSON.stringify(u));
      setUser(u);
    } catch { }
  }

  // ─── Load Notes List ───────────────────────────────
  const loadNotesList = useCallback(async (q = '', folder = '') => {
    let notes = [];
    try {
      // Always try API first (works for both local server + deployed)
      let url = '/notes?';
      if (q) url += `q=${encodeURIComponent(q)}&`;
      if (folder) url += `folder=${encodeURIComponent(folder)}&`;
      notes = await apiFetch(url);
      cacheNotes(notes).catch(() => { });
      setLastSync().catch(() => { }); // track last successful sync timestamp
    } catch (e) {
      if (!e.message.includes('Unauthorized')) {
        // API failed — fall back to offline cache
        notes = await getOfflineNotes().catch(() => []);
        if (q) {
          const ql = q.toLowerCase();
          notes = notes.filter(n => (n.title || '').toLowerCase().includes(ql));
        }
        if (folder) {
          notes = notes.filter(n => (n.folder || '') === folder);
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
    // Add to open tabs if not already there
    setOpenTabs(prev => {
      if (prev.find(t => t.id === id)) return prev;
      const note = noteCacheRef.current.get(id);
      return [...prev, { id, title: note?.title || 'Loading…' }];
    });
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
        cacheNote(note).catch(() => { });
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
    setNoteFolder(note.folder || '');
    setNoteDate('Last saved: ' + fmtDate(note.modified));
    setSaveStatus('ok');
    // Sync tab title
    setOpenTabs(prev => prev.map(t => t.id === note.id ? { ...t, title: note.title || 'Untitled' } : t));
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
    setSidebarView('notes'); // switch to notes view if in trash
    // Use activeFolder (sidebar selection) or fall back to the current note's folder
    const targetFolder = activeFolder || noteFolder;
    if (targetFolder) updateFolderAccess(targetFolder);
    try {
      // Create note in the target folder
      const note = await apiFetch('/notes', { method: 'POST', body: JSON.stringify({ title: 'Untitled Note', content: '', tags: [], folder: targetFolder }) });
      cacheNote(note).catch(() => { });
      await loadNotesList('');
      loadFolders();
      await openNote(note.id);
    } catch {
      // API failed — create offline (also respects folder context)
      const note = await saveNoteOffline(null, 'Untitled Note', '', [], targetFolder);
      noteCacheRef.current.set(note.id, note);
      await loadNotesList('');
      await openNote(note.id);
      showToastMsg('📴 Note created offline — will sync later');
    }
  }

  // ─── Delete Note (soft-delete → trash) ────────────
  async function deleteNote() {
    if (!activeIdRef.current) return;
    if (!window.confirm('Move this note to Trash?')) return;
    const id = activeIdRef.current;
    noteCacheRef.current.delete(id);
    try {
      await apiFetch(`/notes/${id}`, { method: 'DELETE' });
      // API did the trash — just update local IDB cache (no sync_queue)
      const cached = await getOfflineNote(id);
      if (cached) { cached.deleted_at = Date.now(); cached.is_dirty = false; cacheNote(cached).catch(() => { }); }
    } catch {
      // API unreachable — queue for sync
      await trashNoteOffline(id).catch(() => { });
    }
    setActiveIdState(null);
    setIsDirty(false);
    await loadNotesList(search);
    showToastMsg('🗑️ Moved to Trash (auto-deletes in 7 days)');
  }

  // ─── Trash Operations ─────────────────────────────
  async function loadTrash() {
    try {
      const items = await apiFetch('/notes/trash');
      setTrashNotes(items);
      const trashFols = await apiFetch('/notes/trash/folders');
      setTrashFolders(trashFols);
    } catch {
      // Offline fallback — show cached trashed notes
      const items = await getOfflineTrash().catch(() => []);
      setTrashNotes(items);
      setTrashFolders([]); // Offline trash folders not supported yet
    }
  }

  async function restoreNote(id) {
    try {
      await apiFetch(`/notes/${id}/restore`, { method: 'POST' });
      showToastMsg('♻️ Note restored');
    } catch {
      // Offline fallback
      await restoreNoteOffline(id).catch(() => { });
      showToastMsg('♻️ Restored offline — will sync later');
    }
    await loadTrash();
    await loadNotesList(search);
    loadFolders();
  }

  async function permanentDelete(id) {
    if (!window.confirm('Permanently delete this note? This cannot be undone.')) return;
    try {
      await apiFetch(`/notes/${id}/permanent`, { method: 'DELETE' });
      showToastMsg('🗑️ Permanently deleted');
    } catch {
      // Offline fallback
      await permanentDeleteOffline(id).catch(() => { });
      showToastMsg('🗑️ Deleted offline — will sync later');
    }
    await loadTrash();
  }

  async function restoreFolder(folderName) {
    try {
      await apiFetch(`/notes/trash/folders/${encodeURIComponent(folderName)}/restore`, { method: 'POST' });
      showToastMsg(`♻️ Folder "${folderName}" restored`);
    } catch {
      showToastMsg('⚠️ Failed to restore folder (offline not supported yet)');
    }
    await loadTrash();
    await loadNotesList(search);
    loadFolders();
  }

  async function permanentDeleteFolder(folderName) {
    if (!window.confirm(`Permanently delete folder "${folderName}" and all its notes? This cannot be undone.`)) return;
    try {
      await apiFetch(`/notes/trash/folders/${encodeURIComponent(folderName)}/permanent`, { method: 'DELETE' });
      showToastMsg(`🗑️ Folder "${folderName}" permanently deleted`);
    } catch {
      showToastMsg('⚠️ Failed to delete folder (offline not supported yet)');
    }
    await loadTrash();
  }

  async function emptyTrash() {
    if (!window.confirm('⚠️ Permanently delete ALL items in Trash?\n\nThis will delete all trashed notes and folders. This action cannot be undone.')) return;
    try {
      const res = await apiFetch('/notes/trash/empty', { method: 'DELETE' });
      showToastMsg(`🗑️ Trash emptied — ${res.deleted} item(s) permanently deleted`);
    } catch {
      showToastMsg('⚠️ Failed to empty trash');
    }
    await loadTrash();
    loadFolders();
  }

  // ─── Folder Operations ────────────────────────────
  async function loadFolders() {
    try {
      const data = await apiFetch('/notes/folders');
      // data is [{name, last_accessed}, ...]
      setFolders(data.map(f => f.name));
      folderRankingRef.current = new Map(data.map(f => [f.name, f.last_accessed || 0]));
      cacheFolders(data).catch(() => { });
      return data;
    } catch {
      // Offline fallback
      const data = await getOfflineFolders().catch(() => []);
      const isOldFormat = data.length > 0 && typeof data[0] === 'string';
      if (isOldFormat) {
        setFolders(data);
        folderRankingRef.current = new Map();
      } else {
        setFolders(data.map(f => f.name));
        folderRankingRef.current = new Map(data.map(f => [f.name, f.last_accessed || 0]));
      }
      return data;
    }
  }

  function updateFolderAccess(folderName) {
    if (!folderName) return;
    // Always update local ranking instantly
    folderRankingRef.current.set(folderName, Date.now());
    // Throttle server calls: max 1 per folder every 2 seconds
    if (folderAccessTimers.current.has(folderName)) return;
    folderAccessTimers.current.set(folderName, true);
    setTimeout(() => folderAccessTimers.current.delete(folderName), 2000);
    // Fire-and-forget API call
    apiFetch(`/notes/folders/${encodeURIComponent(folderName)}/access`,
      { method: 'PUT' }).catch(() => { });
  }

  async function createFolder() {
    const name = prompt('Enter folder name:');
    if (!name || !name.trim()) return;
    try {
      await apiFetch('/notes/folders', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      showToastMsg(`📁 Folder "${name.trim()}" created`);
    } catch (e) {
      if (e.message?.includes('already exists')) { showToastMsg('⚠️ Folder already exists'); return; }
      // Offline fallback
      await createFolderOffline(name.trim()).catch(() => { });
      showToastMsg(`📁 Folder created offline — will sync later`);
    }
    await loadFolders();
    setActiveFolder(name.trim());
  }

  async function moveNoteToFolder(noteId, folder) {
    try {
      await apiFetch(`/notes/${noteId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: titleRef.current, content: editorRef.current?.innerHTML || '', tags: currentTagsRef.current, folder }),
      });
      setNoteFolder(folder);
      await loadNotesList(search);
      loadFolders();
      showToastMsg(folder ? `📁 Moved to "${folder}"` : '📄 Moved to All Notes');
    } catch {
      showToastMsg('⚠️ Failed to move note');
    }
  }

  async function deleteFolder(folderName) {
    if (!window.confirm(`Delete folder "${folderName}"? All notes inside will be moved to Trash.`)) return;
    try {
      await apiFetch(`/notes/folders/${encodeURIComponent(folderName)}`, { method: 'DELETE' });
      showToastMsg(`🗑️ Folder "${folderName}" deleted`);
    } catch {
      // Offline fallback
      await deleteFolderOffline(folderName).catch(() => { });
      showToastMsg(`🗑️ Folder deleted offline — will sync later`);
    }
    if (activeFolder === folderName) setActiveFolder('');
    if (noteFolder === folderName) setNoteFolder('');
    await loadFolders();
    await loadNotesList(search, '');
  }

  // ─── Pin / Unpin Note ─────────────────────────────
  const [noteMenu, setNoteMenu] = useState(null); // id of note whose menu is open
  const [folderMenu, setFolderMenu] = useState(null); // name of folder whose menu is open

  async function togglePin(noteId) {
    try {
      const res = await apiFetch(`/notes/${noteId}/pin`, { method: 'POST' });
      showToastMsg(res.pinned ? '📌 Note pinned' : '📌 Note unpinned');
    } catch {
      // Offline fallback
      const note = await pinNoteOffline(noteId).catch(() => null);
      showToastMsg(note?.pinned ? '📌 Pinned offline' : '📌 Unpinned offline');
    }
    await loadNotesList(search);
    setNoteMenu(null);
  }

  async function quickMoveToFolder(noteId, folder) {
    try {
      // Get current note data
      const note = noteCacheRef.current.get(noteId) || await apiFetch(`/notes/${noteId}`);
      await apiFetch(`/notes/${noteId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: note.title, content: note.content || '', tags: note.tags || [], folder }),
      });
      await loadNotesList(search);
      loadFolders();
      showToastMsg(folder ? `📁 Moved to "${folder}"` : '📄 Moved to All');
    } catch {
      showToastMsg('⚠️ Failed to move');
    }
    setNoteMenu(null);
  }

  async function quickDelete(noteId) {
    try {
      await apiFetch(`/notes/${noteId}`, { method: 'DELETE' });
      // API handled it — just update IDB cache (no sync_queue)
      const cached = await getOfflineNote(noteId);
      if (cached) { cached.deleted_at = Date.now(); cached.is_dirty = false; cacheNote(cached).catch(() => { }); }
      showToastMsg('🗑️ Moved to Trash');
    } catch {
      // Offline fallback — queue for sync
      await trashNoteOffline(noteId).catch(() => { });
      showToastMsg('🗑️ Trashed offline — will sync later');
    }
    if (activeIdRef.current === noteId) setActiveIdState(null);
    noteCacheRef.current.delete(noteId);
    await loadNotesList(search);
    setNoteMenu(null);
  }

  async function renameNote(noteId) {
    const note = noteCacheRef.current.get(noteId) || await getOfflineNote(noteId);
    const oldTitle = note?.title || 'Untitled Note';
    const newTitle = prompt('Rename note:', oldTitle);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === oldTitle) { setNoteMenu(null); return; }
    try {
      const updated = await apiFetch(`/notes/${noteId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle.trim(), content: note?.content || '', tags: note?.tags || [] }),
      });
      noteCacheRef.current.set(noteId, updated);
      cacheNote(updated).catch(() => { });
      if (activeIdRef.current === noteId) { setNoteTitle(newTitle.trim()); titleRef.current = newTitle.trim(); }
      showToastMsg('✏️ Note renamed');
    } catch {
      showToastMsg('⚠️ Failed to rename');
    }
    await loadNotesList(search);
    setOpenTabs(prev => prev.map(t => t.id === noteId ? { ...t, title: newTitle.trim() } : t));
    setNoteMenu(null);
  }

  async function renameFolder(oldName) {
    const newName = prompt('Rename folder:', oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) { setFolderMenu(null); return; }
    try {
      await apiFetch(`/notes/folders/${encodeURIComponent(oldName)}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ newName: newName.trim() }),
      });
      if (activeFolder === oldName) setActiveFolder(newName.trim());
      if (noteFolder === oldName) setNoteFolder(newName.trim());
      showToastMsg('✏️ Folder renamed');
    } catch (e) {
      if (e.message?.includes('already exists')) showToastMsg('⚠️ ' + e.message);
      else showToastMsg('⚠️ Failed to rename folder');
    }
    await loadFolders();
    await loadNotesList(search);
    setFolderMenu(null);
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
      cacheNote(updated).catch(() => { });
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

  const lastSavedTitleRef = useRef('');
  function scheduleSave() {
    setIsDirty(true);
    setSaveStatus('pending');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await saveCurrentNote();
      // Only refresh sidebar if the title actually changed (skip on content-only saves)
      if (titleRef.current !== lastSavedTitleRef.current) {
        lastSavedTitleRef.current = titleRef.current;
        loadNotesList(search);
      }
    }, 900);
  }

  // ─── Ctrl+S to Save ───────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        clearTimeout(saveTimerRef.current);
        saveCurrentNote();
        showToastMsg('💾 Note saved');
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [saveCurrentNote]);

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
  const wordCountTimerRef = useRef(null);
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
  function debouncedUpdateWordCount() {
    clearTimeout(wordCountTimerRef.current);
    wordCountTimerRef.current = setTimeout(updateWordCount, 500);
  }

  // Debounced font-size DOM query for custom sizes
  const fontQueryTimerRef = useRef(null);
  function debouncedFontQuery() {
    clearTimeout(fontQueryTimerRef.current);
    fontQueryTimerRef.current = setTimeout(() => {
      document.querySelectorAll('font[size="7"]:not([data-old="1"])').forEach(f => {
        if (directFontSizeRef.current) f.style.fontSize = directFontSizeRef.current + 'pt';
      });
    }, 200);
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
    const c = color || '#3dd6c8';
    editorRef.current?.focus({ preventScroll: true });
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    document.execCommand('backColor', false, c);
    scheduleSave();
  }

  // ─── Google Featured-Snippet Highlight ────────────
  function applyGoogleSnippetHighlight() {
    editorRef.current?.focus({ preventScroll: true });
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { showToastMsg('⚠️ Select text first'); return; }
    if (!sel.toString()) return;
    const range = sel.getRangeAt(0);
    // Extract selected content (preserves bold, italic, colors, etc.)
    const contents = range.extractContents();
    // Wrap in snippet span
    const wrapper = document.createElement('span');
    wrapper.className = 'nv-google-snippet';
    wrapper.appendChild(contents);
    // Insert wrapper + zero-width space to escape cursor
    range.insertNode(wrapper);
    const zwsp = document.createTextNode('\u200B');
    wrapper.after(zwsp);
    // Move cursor after the snippet
    const newRange = document.createRange();
    newRange.setStartAfter(zwsp);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
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

  function insertTextBox() {
    const el = editorRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });

    // Default position near center of editor view
    const scrollTop = el.scrollTop || 0;
    const top = scrollTop + 50;
    const left = 50;

    const html = `
      <div class="nv-shape" contenteditable="false" style="left: ${left}px; top: ${top}px; width: 250px; height: 100px;">
        <div class="nv-shape-content" contenteditable="true" data-placeholder="Type here…"></div>
        <div class="nv-shape-handle nw" data-handle="nw"></div>
        <div class="nv-shape-handle n" data-handle="n"></div>
        <div class="nv-shape-handle ne" data-handle="ne"></div>
        <div class="nv-shape-handle w" data-handle="w"></div>
        <div class="nv-shape-handle e" data-handle="e"></div>
        <div class="nv-shape-handle sw" data-handle="sw"></div>
        <div class="nv-shape-handle s" data-handle="s"></div>
        <div class="nv-shape-handle se" data-handle="se"></div>
      </div><p><br></p>`;

    document.execCommand('insertHTML', false, html);

    // Make the new shape active and focus it
    const shapes = el.querySelectorAll('.nv-shape');
    if (shapes.length > 0) {
      const last = shapes[shapes.length - 1];
      el.querySelectorAll('.nv-shape.active').forEach(s => s.classList.remove('active'));
      last.classList.add('active');
      const content = last.querySelector('.nv-shape-content');
      if (content) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    scheduleSave();
  }

  // ─── Clear ALL Formatting ─────────────────────────
  function clearAllFormatting() {
    editorRef.current?.focus({ preventScroll: true });

    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const selectedText = sel.toString();
    const hasSelection = !range.collapsed && selectedText.length > 0;

    if (hasSelection) {
      // Step 1: Use removeFormat for standard inline (bold, italic, underline, font)
      document.execCommand('removeFormat');
      document.execCommand('unlink');

      // Step 2: Replace the remaining selection with plain text
      // This catches anything removeFormat missed (span colors, marks, custom styles)
      const sel2 = window.getSelection();
      if (sel2.rangeCount > 0) {
        const r = sel2.getRangeAt(0);
        r.deleteContents();
        r.insertNode(document.createTextNode(selectedText));
        // Collapse cursor to end of inserted text
        sel2.collapseToEnd();
      }
    } else {
      // No selection — cursor in a block: reset heading → paragraph
      document.execCommand('removeFormat');
      document.execCommand('formatBlock', false, 'p');
    }

    // Reset toolbar toggle states
    setSizeMode('normal');
    setDirectFontSize('16');
    setMarkMode('normal');
    setCustomMarkColor('#ffff00');
    setTextColorMode('normal');
    setCustomTextColor('#e2e8f0');
    setLineSpaceMode('normal');
    setLineSpacing('1.75');
    setWordSpaceMode('normal');
    setWordSpacing('normal');

    scheduleSave();
    showToastMsg('✨ Formatting cleared');
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
    if (['h1', 'h2', 'h3'].includes(cmd)) {
      // Toggle: if the current block is already this heading, switch back to <p>
      const currentBlock = document.queryCommandValue('formatBlock');
      if (currentBlock.toLowerCase() === cmd) {
        document.execCommand('formatBlock', false, 'p');
      } else {
        document.execCommand('formatBlock', false, cmd);
      }
    }
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
    const BLOCK_TAGS = new Set(['TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'DIV', 'UL', 'OL', 'FIGURE']);
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

  // ─── Export Helpers ────────────────────────────────
  function htmlToPlainText(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    // Convert <br> and block elements to newlines
    div.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    div.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li').forEach(el => {
      el.prepend('\n');
    });
    return div.textContent.trim();
  }

  function htmlToMarkdown(html) {
    let md = html || '';
    // Headings
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
    // Bold, italic, strikethrough
    md = md.replace(/<(b|strong)[^>]*>(.*?)<\/(b|strong)>/gi, '**$2**');
    md = md.replace(/<(i|em)[^>]*>(.*?)<\/(i|em)>/gi, '*$2*');
    md = md.replace(/<(s|strike|del)[^>]*>(.*?)<\/(s|strike|del)>/gi, '~~$2~~');
    // Links
    md = md.replace(/<a[^>]*href="([^"]*?)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    // Images
    md = md.replace(/<img[^>]*src="([^"]*?)"[^>]*>/gi, '![image]($1)');
    // Lists
    md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
    // Line breaks and paragraphs
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<\/p>/gi, '\n\n');
    md = md.replace(/<\/?[^>]+(>|$)/g, ''); // strip remaining tags
    md = md.replace(/&nbsp;/g, ' ');
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    return md.trim();
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    saveAs(blob, filename);
  }

  function exportCurrentNote(format) {
    setShowExportMenu(false);
    const cache = noteCacheRef.current;
    const note = cache.get(activeId);
    if (!note) { showToastMsg('⚠️ Note not loaded yet'); return; }
    const title = (note.title || 'Untitled').replace(/[^a-zA-Z0-9 _-]/g, '');
    const content = note.content || '';

    if (format === 'txt') {
      downloadFile(htmlToPlainText(content), `${title}.txt`, 'text/plain;charset=utf-8');
    } else if (format === 'md') {
      const md = `# ${note.title || 'Untitled'}\n\n${htmlToMarkdown(content)}`;
      downloadFile(md, `${title}.md`, 'text/markdown;charset=utf-8');
    } else if (format === 'html') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${note.title || 'Untitled'}</title><style>body{font-family:system-ui;max-width:800px;margin:40px auto;padding:0 20px;color:#333;line-height:1.6}h1{border-bottom:2px solid #eee;padding-bottom:8px}</style></head><body><h1>${note.title || 'Untitled'}</h1>${content}</body></html>`;
      downloadFile(html, `${title}.html`, 'text/html;charset=utf-8');
    }
    showToastMsg(`📥 Exported as ${format.toUpperCase()}`);
  }

  async function exportAllNotes() {
    setShowExportMenu(false);
    showToastMsg('📦 Preparing ZIP export...');
    const cache = noteCacheRef.current;
    const zip = new JSZip();
    let count = 0;

    for (const n of allNotes) {
      let note = cache.get(n.id);
      if (!note) {
        try { note = await apiFetch(`/notes/${n.id}`); } catch { continue; }
      }
      const title = (note.title || 'Untitled').replace(/[^a-zA-Z0-9 _-]/g, '') || 'Untitled';
      const folder = note.folder || 'Unfiled';
      const md = `# ${note.title || 'Untitled'}\n\n${htmlToMarkdown(note.content || '')}`;
      zip.file(`${folder}/${title}.md`, md);
      count++;
    }

    if (count === 0) { showToastMsg('⚠️ No notes to export'); return; }
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `NoteVault_Backup_${new Date().toISOString().slice(0, 10)}.zip`);
    showToastMsg(`✅ Exported ${count} notes as ZIP`);
  }

  async function exportFolder(folderName) {
    showToastMsg(`📦 Exporting ${folderName}...`);
    const cache = noteCacheRef.current;
    const zip = new JSZip();
    let count = 0;
    const folderNotes = allNotes.filter(n => n.folder === folderName);

    for (const n of folderNotes) {
      let note = cache.get(n.id);
      if (!note) {
        try { note = await apiFetch(`/notes/${n.id}`); } catch { continue; }
      }
      const title = (note.title || 'Untitled').replace(/[^a-zA-Z0-9 _-]/g, '') || 'Untitled';
      const md = `# ${note.title || 'Untitled'}\n\n${htmlToMarkdown(note.content || '')}`;
      zip.file(`${title}.md`, md);
      count++;
    }

    if (count === 0) { showToastMsg('⚠️ No notes in this folder'); return; }
    const safeName = folderName.replace(/[^a-zA-Z0-9 _-]/g, '');
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `NoteVault_${safeName}_${new Date().toISOString().slice(0, 10)}.zip`);
    showToastMsg(`✅ Exported ${count} notes from ${folderName}`);
  }

  // ─── Ranked Prefetch with Progress Toasts ──────────
  async function prefetchAllNotes(loadedNotes, currentFolder) {
    const cache = noteCacheRef.current;

    // Step 1: IDB warm-up — load notes already cached with content from previous sessions
    let cachedIds = new Set();
    try { cachedIds = await getNoteIdsWithContent(); } catch { }

    for (const n of loadedNotes) {
      if (!cache.has(n.id) && cachedIds.has(n.id)) {
        try {
          const fromIdb = await getOfflineNote(n.id);
          if (fromIdb && (fromIdb.content || fromIdb.content_compressed)) {
            cache.set(n.id, fromIdb);
          }
        } catch { }
      }
    }

    // Step 1b: Clean up IDB ghost notes (deleted on server but still in IDB)
    try {
      const serverIds = loadedNotes.map(n => n.id);
      const removed = await cleanupStaleNotes(serverIds);
      if (removed > 0) console.log(`🧹 Cleaned ${removed} stale notes from IDB`);
    } catch { }

    // Step 2: Build ranked queue of notes NOT yet in memory cache
    const uncached = loadedNotes.filter(n => !cache.has(n.id));
    if (uncached.length === 0) {
      showToastMsg('✅ All notes cached for offline!', 3000);
      return;
    }

    // Separate into ranked groups
    const activeFolderNotes = [];
    const folderBuckets = new Map();
    const unfiledNotes = [];

    for (const n of uncached) {
      if (n.folder === currentFolder && currentFolder) {
        activeFolderNotes.push(n);
      } else if (n.folder) {
        if (!folderBuckets.has(n.folder)) folderBuckets.set(n.folder, []);
        folderBuckets.get(n.folder).push(n);
      } else {
        unfiledNotes.push(n);
      }
    }

    // Sort folder buckets by ranking (last_accessed DESC)
    const ranking = folderRankingRef.current;
    const sortedFolderNotes = [...folderBuckets.entries()]
      .sort((a, b) => (ranking.get(b[0]) || 0) - (ranking.get(a[0]) || 0))
      .flatMap(([, notes]) => notes);

    // Final queue: active folder → ranked folders → unfiled
    const fetchQueue = [...activeFolderNotes, ...sortedFolderNotes, ...unfiledNotes];
    const total = fetchQueue.length;
    if (total === 0) return;

    let fetched = 0;
    let consecutiveFailures = 0;
    const milestones = new Set([
      Math.max(1, Math.floor(total * 0.25)),
      Math.max(1, Math.floor(total * 0.50)),
      Math.max(1, Math.floor(total * 0.75)),
      total
    ]);

    // Step 3: Fetch one by one with progress toasts
    for (const n of fetchQueue) {
      if (consecutiveFailures >= 3) {
        showToastMsg('⚠️ Server unreachable — cached notes available offline', 3000);
        break;
      }
      try {
        const full = await apiFetch(`/notes/${n.id}`);
        cache.set(n.id, full);
        cacheNote(full).catch(() => { });
        consecutiveFailures = 0;
      } catch {
        consecutiveFailures++;
      }
      fetched++;

      if (milestones.has(fetched)) {
        const pct = Math.round((fetched / total) * 100);
        if (pct < 100) showToastMsg(`📥 Caching notes… ${pct}%`);
        else showToastMsg('✅ All notes cached for offline!', 3000);
      }
    }
  }

  // ─── Init ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Handle OAuth link callback
      const urlParams = new URLSearchParams(window.location.search);
      const linked = urlParams.get('linked');
      if (linked) {
        showToastMsg(`✅ ${linked.charAt(0).toUpperCase() + linked.slice(1)} account linked!`);
        window.history.replaceState({}, '', window.location.pathname);
      }
      let loadedNotes = [];
      await Promise.all([loadUserProfile(), loadFolders(), loadNotesList().then(notes => {
        loadedNotes = notes;
        if (notes.length > 0) openNote(notes[0].id);
      })]);
      // Request persistent storage to prevent browser eviction
      requestPersistentStorage().catch(() => { });
      // Log storage usage for diagnostics
      getStorageEstimate().then(est => {
        if (est && est.percentUsed > 80) {
          console.warn(`⚠️ IndexedDB storage: ${est.usedMB}MB / ${est.totalMB}MB (${est.percentUsed}%)`);
        }
      }).catch(() => { });
      // Background prefetch with folder ranking + progress toasts
      setTimeout(() => prefetchAllNotes(loadedNotes, activeFolder), 1500);
      // Show ready toast based on actual server reachability
      const serverUp = await checkServerReachable();
      showToastMsg(serverUp ? '📓 NoteVault ready!' : '📴 Offline mode');
    })();
  }, []);

  // ─── Debounced search ──────────────────────────────
  useEffect(() => {
    if (sidebarView === 'trash') return;
    const t = setTimeout(() => loadNotesList(search), 300);
    return () => clearTimeout(t);
  }, [search, sidebarView]);

  const filePickerRef = useRef(null);

  // ─── Close library menus on click outside ─────────
  useEffect(() => {
    function closeLibMenus(e) {
      ['bulletLibMenu', 'numberLibMenu'].forEach(id => {
        const menu = document.getElementById(id);
        if (menu && menu.style.display === 'block' && !menu.parentElement.contains(e.target)) {
          menu.style.display = 'none';
        }
      });
    }
    document.addEventListener('mousedown', closeLibMenus);
    return () => document.removeEventListener('mousedown', closeLibMenus);
  }, []);

  // ─── Free-Floating TextBox Drag/Resize Engine ──────
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    let isDragging = false;
    let isResizing = false;
    let currentShape = null;
    let currentHandle = null;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let startW = 0, startH = 0;

    function onMouseDown(e) {
      const shape = e.target.closest('.nv-shape');
      if (!shape) {
        // Clicked outside any shape, deactivate all
        editor.querySelectorAll('.nv-shape.active').forEach(s => s.classList.remove('active'));
        return;
      }

      // Activate clicked shape
      editor.querySelectorAll('.nv-shape.active').forEach(s => {
        if (s !== shape) s.classList.remove('active');
      });
      shape.classList.add('active');

      if (e.target.classList.contains('nv-shape-handle')) {
        // Start resizing
        isResizing = true;
        currentShape = shape;
        currentHandle = e.target.dataset.handle;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseFloat(shape.style.left) || 0;
        startTop = parseFloat(shape.style.top) || 0;
        startW = shape.offsetWidth;
        startH = shape.offsetHeight;
        e.preventDefault(); // Prevent text selection
      } else if (e.target === shape || e.target.classList.contains('nv-shape')) {
        // Start dragging
        isDragging = true;
        currentShape = shape;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseFloat(shape.style.left) || 0;
        startTop = parseFloat(shape.style.top) || 0;
        e.preventDefault();
      }
    }

    function onMouseMove(e) {
      if (!currentShape) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (isDragging) {
        currentShape.style.left = `${startLeft + dx}px`;
        currentShape.style.top = `${startTop + dy}px`;
      } else if (isResizing) {
        let newW = startW, newH = startH, newL = startLeft, newT = startTop;

        if (currentHandle.includes('e')) newW = startW + dx;
        if (currentHandle.includes('s')) newH = startH + dy;
        if (currentHandle.includes('w')) {
          newW = startW - dx;
          newL = startLeft + dx;
        }
        if (currentHandle.includes('n')) {
          newH = startH - dy;
          newT = startTop + dy;
        }

        // Enforce minimum size
        if (newW > 50) {
          currentShape.style.width = `${newW}px`;
          currentShape.style.left = `${newL}px`;
        }
        if (newH > 40) {
          currentShape.style.height = `${newH}px`;
          currentShape.style.top = `${newT}px`;
        }
      }
    }

    function onMouseUp(e) {
      if (isDragging || isResizing) {
        isDragging = false;
        isResizing = false;
        currentShape = null;
        currentHandle = null;
        scheduleSave();
      }
    }

    editor.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      editor.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [activeId]); // Re-attach when switching notes

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
              <button className="dropdown-item" style={{ color: 'var(--fg)' }}
                onClick={(e) => { e.stopPropagation(); setShowProfileEdit(true); }}>
                <span className="dropdown-icon">✏️</span> Edit Details
              </button>
              <button className="dropdown-item" style={{ color: 'var(--fg)' }}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); exportAllNotes(); }}>
                <span className="dropdown-icon">📤</span> Export All Notes
              </button>
              <button className="dropdown-item danger" id="btnLogout"
                onClick={(e) => { e.stopPropagation(); localStorage.removeItem('nv_token'); localStorage.removeItem('nv_user'); navigate('/login'); }}>
                <span className="dropdown-icon">⏏</span> Sign out
              </button>
            </div>
          </div>
        </div>

        <div className="search-wrap">
          <span className="search-icon">🔍</span>
          <input type="text" id="searchInput" placeholder="Search notes…" autoComplete="off"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* ── Sidebar Navigation Tabs ── */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
          <button
            style={{ flex: 1, padding: '8px 0', background: sidebarView === 'notes' ? 'var(--card)' : 'transparent', border: 'none', borderBottom: sidebarView === 'notes' ? '2px solid var(--accent)' : '2px solid transparent', color: sidebarView === 'notes' ? 'var(--accent2)' : 'var(--muted)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
            onClick={() => { setSidebarView('notes'); loadNotesList(search); }}
          >📝 Notes</button>
          <button
            style={{ flex: 1, padding: '8px 0', background: sidebarView === 'trash' ? 'var(--card)' : 'transparent', border: 'none', borderBottom: sidebarView === 'trash' ? '2px solid var(--danger)' : '2px solid transparent', color: sidebarView === 'trash' ? 'var(--danger)' : 'var(--muted)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
            onClick={() => { setSidebarView('trash'); loadTrash(); setActiveIdState(null); }}
          >🗑️ Trash</button>
        </div>

        {/* ── Notes View — VS Code-like Tree ── */}
        {sidebarView === 'notes' && (<div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {/* New note + folder buttons */}
          <div style={{ padding: '6px 12px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              style={{ padding: '2px 8px', borderRadius: 4, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: '.7rem', cursor: 'pointer', fontFamily: 'var(--font)' }}
              onClick={createNote}
              title="New note"
            >＋ Note</button>
            <button
              style={{ padding: '2px 8px', borderRadius: 4, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: '.7rem', cursor: 'pointer', fontFamily: 'var(--font)' }}
              onClick={createFolder}
              title="New folder"
            >＋ Folder</button>
          </div>

          {/* Folder Tree */}
          {folders.map(f => {
            const folderNotes = allNotes.filter(n => n.folder === f);
            const isCollapsed = collapsedFolders.has(f);
            return (
              <div key={f}>
                <div
                  style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--font)', borderBottom: '1px solid rgba(255,255,255,.04)', userSelect: 'none', position: 'relative' }}
                  onClick={() => {
                    setCollapsedFolders(prev => {
                      const next = new Set(prev);
                      next.has(f) ? next.delete(f) : next.add(f);
                      return next;
                    });
                    setActiveFolder(f);
                    updateFolderAccess(f);
                  }}
                >
                  <span style={{ marginRight: 4, fontSize: '.65rem', opacity: .5 }}>{isCollapsed ? '▶' : '▼'}</span>
                  <span style={{ marginRight: 4 }}>📁</span>
                  <span style={{ flex: 1 }}>{f}</span>
                  <span style={{ fontSize: '.6rem', color: 'var(--muted)', marginRight: 6 }}>{folderNotes.length}</span>
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '.85rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1, flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); setFolderMenu(folderMenu === f ? null : f); }}
                    title="Folder options"
                  >⋮</button>
                  {folderMenu === f && (
                    <div style={{ position: 'absolute', right: 8, top: 28, zIndex: 100, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.3)', padding: '4px 0', minWidth: 140, fontFamily: 'var(--font)' }} onClick={e => e.stopPropagation()}>
                      <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => renameFolder(f)}>✏️ Rename</button>
                      <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => { setFolderMenu(null); exportFolder(f); }}>📤 Export folder</button>
                      <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                      <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--danger)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(248,113,113,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => { setFolderMenu(null); deleteFolder(f); }}>🗑️ Delete folder</button>
                    </div>
                  )}
                </div>
                {!isCollapsed && folderNotes.map(n => (
                  <div key={n.id}
                    style={{ display: 'flex', alignItems: 'center', padding: '5px 12px 5px 28px', cursor: 'pointer', fontSize: '.76rem', color: n.id === activeId ? 'var(--accent2)' : 'var(--fg)', background: n.id === activeId ? 'rgba(108,99,255,.1)' : 'transparent', fontFamily: 'var(--font)', borderLeft: n.id === activeId ? '2px solid var(--accent)' : '2px solid transparent', position: 'relative' }}
                    onClick={async () => {
                      if (noteMenu) { setNoteMenu(null); return; }
                      if (n.id === activeId) return;
                      if (isDirtyRef.current) { const c = await showUnsavedModal(); if (c === 'save') await saveCurrentNote(); else if (c === 'cancel') return; }
                      setIsDirty(false); setActiveFolder(f); updateFolderAccess(f); openNote(n.id);
                    }}
                  >
                    {n.pinned && <span style={{ marginRight: 3, fontSize: '.6rem' }}>📌</span>}
                    <span style={{ marginRight: 4, fontSize: '.65rem' }}>📄</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{escHTML(n.title || 'Untitled')}</span>
                    <button
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '.85rem', cursor: 'pointer', padding: '0 4px', flexShrink: 0, lineHeight: 1 }}
                      onClick={(e) => { e.stopPropagation(); setNoteMenu(noteMenu === n.id ? null : n.id); }}
                    >⋮</button>
                    {noteMenu === n.id && (
                      <div style={{ position: 'absolute', right: 4, top: 22, zIndex: 100, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.3)', padding: '4px 0', minWidth: 150, fontFamily: 'var(--font)' }} onClick={e => e.stopPropagation()}>
                        <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => renameNote(n.id)}>✏️ Rename</button>
                        <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => togglePin(n.id)}>{n.pinned ? '📌 Unpin' : '📌 Pin'}</button>
                        <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                        <div style={{ padding: '3px 12px', fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600 }}>Move to</div>
                        <button style={{ width: '100%', textAlign: 'left', padding: '5px 12px 5px 18px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.72rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => quickMoveToFolder(n.id, '')}>📄 Unfiled</button>
                        {folders.filter(ff => ff !== f).map(ff => (
                          <button key={ff} style={{ width: '100%', textAlign: 'left', padding: '5px 12px 5px 18px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.72rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => quickMoveToFolder(n.id, ff)}>📁 {ff}</button>
                        ))}
                        <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                        <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--danger)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(248,113,113,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => quickDelete(n.id)}>🗑️ Delete</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Unfiled Notes */}
          {(() => {
            const unfiled = allNotes.filter(n => !n.folder);
            if (unfiled.length === 0 && folders.length > 0) return null;
            return (
              <div>
                {folders.length > 0 && (
                  <div style={{ padding: '6px 12px', fontSize: '.72rem', color: 'var(--muted)', fontWeight: 600, fontFamily: 'var(--font)', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                    📄 Unfiled
                  </div>
                )}
                {unfiled.map(n => (
                  <div key={n.id}
                    style={{ display: 'flex', alignItems: 'center', padding: '5px 12px 5px ' + (folders.length > 0 ? '28px' : '12px'), cursor: 'pointer', fontSize: '.76rem', color: n.id === activeId ? 'var(--accent2)' : 'var(--fg)', background: n.id === activeId ? 'rgba(108,99,255,.1)' : 'transparent', fontFamily: 'var(--font)', borderLeft: n.id === activeId ? '2px solid var(--accent)' : '2px solid transparent', position: 'relative' }}
                    onClick={async () => {
                      if (noteMenu) { setNoteMenu(null); return; }
                      if (n.id === activeId) return;
                      if (isDirtyRef.current) { const c = await showUnsavedModal(); if (c === 'save') await saveCurrentNote(); else if (c === 'cancel') return; }
                      setIsDirty(false); setActiveFolder(''); openNote(n.id);
                    }}
                  >
                    {n.pinned && <span style={{ marginRight: 3, fontSize: '.6rem' }}>📌</span>}
                    <span style={{ marginRight: 4, fontSize: '.65rem' }}>📄</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{escHTML(n.title || 'Untitled')}</span>
                    <button
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '.85rem', cursor: 'pointer', padding: '0 4px', flexShrink: 0, lineHeight: 1 }}
                      onClick={(e) => { e.stopPropagation(); setNoteMenu(noteMenu === n.id ? null : n.id); }}
                    >⋮</button>
                    {noteMenu === n.id && (
                      <div style={{ position: 'absolute', right: 4, top: 22, zIndex: 100, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.3)', padding: '4px 0', minWidth: 150, fontFamily: 'var(--font)' }} onClick={e => e.stopPropagation()}>
                        <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => renameNote(n.id)}>✏️ Rename</button>
                        <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => togglePin(n.id)}>{n.pinned ? '📌 Unpin' : '📌 Pin'}</button>
                        {folders.length > 0 && (<>
                          <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                          <div style={{ padding: '3px 12px', fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600 }}>Move to</div>
                          {folders.map(ff => (
                            <button key={ff} style={{ width: '100%', textAlign: 'left', padding: '5px 12px 5px 18px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.72rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => quickMoveToFolder(n.id, ff)}>📁 {ff}</button>
                          ))}
                        </>)}
                        <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                        <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--danger)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(248,113,113,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => quickDelete(n.id)}>🗑️ Delete</button>
                      </div>
                    )}
                  </div>
                ))}
                {allNotes.length === 0 && (
                  <div style={{ color: 'var(--muted)', fontSize: '.8rem', padding: 16, textAlign: 'center' }}>
                    {search ? 'No notes match.' : 'No notes yet.'}
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{ height: 80 }} />
        </div>)}

        {/* ── Trash View ── */}
        {sidebarView === 'trash' && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            {trashNotes.length === 0 && trashFolders.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: '.82rem', padding: 16, textAlign: 'center' }}>
                Trash is empty.
              </div>
            )}

            {/* Empty Trash button */}
            {(trashNotes.length > 0 || trashFolders.length > 0) && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                <button
                  style={{ width: '100%', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--danger)', background: 'rgba(248,113,113,.1)', color: 'var(--danger)', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
                  onClick={emptyTrash}
                >🗑️ Empty Trash</button>
              </div>
            )}

            {/* Render Trashed Folders */}
            {trashFolders.map(tf => {
              const daysLeft = Math.max(0, Math.ceil((7 - (Date.now() - new Date(tf.deleted_at).getTime()) / 86400000)));
              const isCollapsed = collapsedFolders.has(`trash_${tf.name}`);
              return (
                <div key={`trash_folder_${tf.name}`} style={{ marginBottom: 4 }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', fontFamily: 'var(--font)', borderBottom: '1px solid rgba(255,255,255,.04)', userSelect: 'none', position: 'relative', opacity: 0.8 }}
                    onClick={() => {
                      setCollapsedFolders(prev => {
                        const next = new Set(prev);
                        const key = `trash_${tf.name}`;
                        next.has(key) ? next.delete(key) : next.add(key);
                        return next;
                      });
                    }}
                  >
                    <span style={{ marginRight: 6, opacity: 0.6 }}>{isCollapsed ? '▶' : '▼'}</span>
                    <span style={{ textDecoration: 'line-through' }}>📁 {escHTML(tf.name)}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--danger)', fontSize: '.65rem' }}>{daysLeft}d left</span>
                  </div>
                  {!isCollapsed && (
                    <div style={{ padding: '4px 12px', background: 'rgba(0,0,0,0.05)' }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <button
                          style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--success)', background: 'rgba(52,211,153,.1)', color: 'var(--success)', fontSize: '.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
                          onClick={(e) => { e.stopPropagation(); restoreFolder(tf.name); }}
                        >♻️ Restore Folder</button>
                        <button
                          style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--danger)', background: 'rgba(248,113,113,.1)', color: 'var(--danger)', fontSize: '.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
                          onClick={(e) => { e.stopPropagation(); permanentDeleteFolder(tf.name); }}
                        >🗑️ Delete Folder</button>
                      </div>
                      <ul className="notes-list" style={{ marginLeft: 12 }}>
                        {tf.notes.map(n => (
                          <li key={n.id} className="note-item" style={{ opacity: 0.7, padding: '8px', borderLeft: '2px solid var(--border)', borderRadius: 0 }}>
                            <div className="note-item-title" style={{ textDecoration: 'line-through', fontSize: '.8rem' }}>{escHTML(n.title || 'Untitled')}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Render Standalone Trashed Notes (notes whose folder is NOT in trashFolders) */}
            <ul className="notes-list">
              {trashNotes.filter(n => !trashFolders.some(tf => tf.name === n.folder)).map(n => {
                const daysLeft = Math.max(0, Math.ceil((7 - (Date.now() - new Date(n.deleted_at).getTime()) / 86400000)));
                return (
                  <li key={n.id} className="note-item" style={{ opacity: 0.8 }}>
                    <div className="note-item-title" style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{escHTML(n.title || 'Untitled')}</div>
                    {n.folder && <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: 2 }}>Folder: {escHTML(n.folder)}</div>}
                    <div className="note-item-meta">
                      <span style={{ color: 'var(--danger)', fontSize: '.7rem' }}>{daysLeft}d left</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button
                        style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--success)', background: 'rgba(52,211,153,.1)', color: 'var(--success)', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
                        onClick={(e) => { e.stopPropagation(); restoreNote(n.id); }}
                      >♻️ Restore</button>
                      <button
                        style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--danger)', background: 'rgba(248,113,113,.1)', color: 'var(--danger)', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
                        onClick={(e) => { e.stopPropagation(); permanentDelete(n.id); }}
                      >🗑️ Delete</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </aside>

      {/* Sidebar overlay (mobile) */}
      <div className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)} />

      {/* Main */}
      <main className="main">
        {/* File Tabs Bar */}
        <TabBar
          openTabs={openTabs}
          activeId={activeId}
          onSwitchTab={async (tabId) => {
            if (tabId === activeId) return;
            if (isDirtyRef.current) { const c = await showUnsavedModal(); if (c === 'save') await saveCurrentNote(); else if (c === 'cancel') return; }
            setIsDirty(false); openNote(tabId);
          }}
          onCloseTab={(tabId) => {
            setOpenTabs(prev => prev.filter(t => t.id !== tabId));
            if (tabId === activeId) {
              const remaining = openTabs.filter(t => t.id !== tabId);
              if (remaining.length > 0) openNote(remaining[remaining.length - 1].id);
              else setActiveIdState(null);
            }
          }}
        />

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
            {/* Title Bar Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)', padding: '2px 0', cursor: 'pointer', background: 'var(--card)', userSelect: 'none' }}
              onClick={() => setTitleBarCollapsed(!titleBarCollapsed)}>
              <span style={{ fontSize: '.65rem', color: 'var(--muted)', fontFamily: 'var(--font)' }}>
                {titleBarCollapsed ? '▼ Show Title Bar' : '▲ Hide Title Bar'}
              </span>
            </div>

            {/* Title Bar */}
            {!titleBarCollapsed && (
              <div className="editor-topbar" style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <input type="text" className="note-title-input" placeholder="Note title…" style={{ flex: 1 }}
                  value={noteTitle} onChange={e => { setNoteTitle(e.target.value); titleRef.current = e.target.value; setOpenTabs(prev => prev.map(t => t.id === activeId ? { ...t, title: e.target.value } : t)); scheduleSave(); }} />
                <div className="titlebar-actions" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10, flexShrink: 0 }}>
                  <button className="tb-btn tb-save" onClick={() => { saveCurrentNote(); showToastMsg('💾 Saved!'); }} title="Save (Ctrl+S)">💾 Save</button>
                  <button className="tb-btn tb-saveas" onClick={saveAsFile} title="Download as file">📥 Download</button>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <button className="tb-btn" onClick={() => setShowExportMenu(!showExportMenu)} title="Export note">📤 Export</button>
                    {showExportMenu && (
                      <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.3)', padding: '4px 0', minWidth: 180, zIndex: 200, fontFamily: 'var(--font)' }}>
                        <div style={{ padding: '4px 12px', fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600 }}>Current Note</div>
                        {[{ f: 'txt', icon: '📄', label: 'Plain Text (.txt)' }, { f: 'md', icon: '📝', label: 'Markdown (.md)' }, { f: 'html', icon: '🌐', label: 'HTML (.html)' }].map(o => (
                          <button key={o.f} style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => exportCurrentNote(o.f)}>{o.icon} {o.label}</button>
                        ))}
                        <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                        <div style={{ padding: '4px 12px', fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600 }}>All Notes</div>
                        <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={exportAllNotes}>📦 Export All as ZIP</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Toolbar Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)', padding: '2px 0', cursor: 'pointer', background: 'var(--card)', userSelect: 'none' }}
              onClick={() => setToolbarCollapsed(!toolbarCollapsed)}>
              <span style={{ fontSize: '.65rem', color: 'var(--muted)', fontFamily: 'var(--font)' }}>
                {toolbarCollapsed ? '▼ Show Toolbar' : '▲ Hide Toolbar'}
              </span>
            </div>

            {/* Toolbar */}
            <div className="toolbar" style={{ display: toolbarCollapsed ? 'none' : 'flex' }}>
              {[
                { cmd: 'bold', label: <b>B</b>, title: 'Bold' },
                { cmd: 'italic', label: <i>I</i>, title: 'Italic' },
                { cmd: 'underline', label: <u>U</u>, title: 'Underline' },
                { cmd: 'strikeThrough', label: <s>S</s>, title: 'Strike' },
              ].map(b => <button key={b.cmd} className="tb-btn" title={b.title} onMouseDown={e => { e.preventDefault(); execCmd(b.cmd); }}>{b.label}</button>)}

              <span className="tb-divider" />

              {/* ── Font Family ── */}
              <select className="tb-select" title="Font family" style={{ width: '110px' }}
                onChange={e => { if (e.target.value) { execCmd('fontName', e.target.value); } }}
                defaultValue="">
                <option value="" disabled>Font ▾</option>
                <option value="Times New Roman" style={{ fontFamily: 'Times New Roman' }}>Times New Roman</option>
                <option value="Arial" style={{ fontFamily: 'Arial' }}>Arial</option>
                <option value="Georgia" style={{ fontFamily: 'Georgia' }}>Georgia</option>
                <option value="Courier New" style={{ fontFamily: 'Courier New' }}>Courier New</option>
                <option value="Verdana" style={{ fontFamily: 'Verdana' }}>Verdana</option>
                <option value="Trebuchet MS" style={{ fontFamily: 'Trebuchet MS' }}>Trebuchet MS</option>
                <option value="Comic Sans MS" style={{ fontFamily: 'Comic Sans MS' }}>Comic Sans MS</option>
                <option value="Impact" style={{ fontFamily: 'Impact' }}>Impact</option>
              </select>

              <span className="tb-divider" />

              <button className="tb-btn" title="Superscript" onMouseDown={e => { e.preventDefault(); applySuperscript(); }}>x<sup>²</sup></button>
              <button className="tb-btn" title="Subscript" onMouseDown={e => { e.preventDefault(); applySubscript(); }}>x<sub>₂</sub></button>

              {/* ── Mark (Highlight) : Mint / Google Snippet / Custom ── */}
              <select className="tb-select" title="Highlight mode" value={markMode}
                style={{ width: '80px' }}
                onChange={e => {
                  const v = e.target.value;
                  setMarkMode(v);
                  if (v === 'normal') { toggleHighlight('#09ed10ff'); setTimeout(() => setMarkMode('normal'), 0); }
                  else if (v === 'google') { applyGoogleSnippetHighlight(); setTimeout(() => setMarkMode('normal'), 0); }
                }}>
                <option value="normal">🖍️ Mark</option>
                <option value="google">🔵 Google</option>
                <option value="custom">Custom</option>
              </select>
              {markMode === 'custom' && (
                <input type="color" className="tb-color" title="Pick highlight color" value={customMarkColor}
                  onInput={e => { setCustomMarkColor(e.target.value); toggleHighlight(e.target.value); }} />
              )}

              <span className="tb-divider" />

              {/* ── Bullet Library Dropdown ── */}
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button className="tb-btn" title="Bullet list" style={{ fontSize: '.75rem' }}
                  onMouseDown={e => { e.preventDefault(); document.getElementById('bulletLibMenu').style.display = document.getElementById('bulletLibMenu').style.display === 'block' ? 'none' : 'block'; }}
                >≡ • ▾</button>
                <div id="bulletLibMenu" style={{ display: 'none', position: 'absolute', top: '100%', left: 0, zIndex: 9999, background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                  <div style={{ fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600, marginBottom: 6, padding: '0 4px' }}>Bullet Library</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                    {[
                      { style: 'disc', icon: '●', label: 'Filled circle' },
                      { style: 'circle', icon: '○', label: 'Hollow circle' },
                      { style: 'square', icon: '■', label: 'Square' },
                      { style: '"◆ "', icon: '◆', label: 'Diamond' },
                      { style: '"✓ "', icon: '✓', label: 'Checkmark' },
                      { style: '"➤ "', icon: '➤', label: 'Arrow' },
                      { style: '"✦ "', icon: '✦', label: 'Star' },
                      { style: '"– "', icon: '–', label: 'Dash' },
                    ].map(b => (
                      <button key={b.icon} title={b.label}
                        style={{ width: 48, height: 40, border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--fg)', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onMouseDown={e => {
                          e.preventDefault();
                          document.getElementById('bulletLibMenu').style.display = 'none';
                          editorRef.current?.focus({ preventScroll: true });
                          if (savedRangeRef.current) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRangeRef.current); }
                          document.execCommand('insertUnorderedList', false);
                          // Apply bullet style to the closest UL
                          const sel = window.getSelection();
                          let node = sel.anchorNode;
                          while (node && node.tagName !== 'UL') node = node.parentElement;
                          if (node) node.style.listStyleType = b.style;
                          scheduleSave();
                        }}>{b.icon}</button>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
                    <button style={{ width: '100%', padding: '4px 8px', border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: '.7rem', cursor: 'pointer', textAlign: 'left' }}
                      onMouseDown={e => { e.preventDefault(); document.getElementById('bulletLibMenu').style.display = 'none'; editorRef.current?.focus({ preventScroll: true }); if (savedRangeRef.current) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRangeRef.current); } document.execCommand('insertUnorderedList', false); document.execCommand('insertUnorderedList', false); scheduleSave(); }}>
                      None (remove bullets)
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Numbering Library Dropdown ── */}
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button className="tb-btn" title="Numbered list" style={{ fontSize: '.75rem' }}
                  onMouseDown={e => { e.preventDefault(); document.getElementById('numberLibMenu').style.display = document.getElementById('numberLibMenu').style.display === 'block' ? 'none' : 'block'; }}
                >≡ 1 ▾</button>
                <div id="numberLibMenu" style={{ display: 'none', position: 'absolute', top: '100%', left: 0, zIndex: 9999, background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, minWidth: 280, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                  <div style={{ fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600, marginBottom: 6, padding: '0 4px' }}>Numbering Library</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                    {[
                      { style: 'decimal', lines: ['1.', '2.', '3.'], label: '1. 2. 3.' },
                      { style: 'upper-roman', lines: ['I.', 'II.', 'III.'], label: 'I. II. III.' },
                      { style: 'lower-roman', lines: ['i.', 'ii.', 'iii.'], label: 'i. ii. iii.' },
                      { style: 'upper-alpha', lines: ['A.', 'B.', 'C.'], label: 'A. B. C.' },
                      { style: 'lower-alpha', lines: ['a.', 'b.', 'c.'], label: 'a. b. c.' },
                      { style: 'decimal', lines: ['1)', '2)', '3)'], label: '1) 2) 3)', paren: true },
                    ].map((n, i) => (
                      <button key={i} title={n.label}
                        style={{ padding: '6px 4px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--fg)', fontSize: '.65rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minHeight: 50 }}
                        onMouseDown={e => {
                          e.preventDefault();
                          document.getElementById('numberLibMenu').style.display = 'none';
                          editorRef.current?.focus({ preventScroll: true });
                          if (savedRangeRef.current) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRangeRef.current); }
                          document.execCommand('insertOrderedList', false);
                          const sel = window.getSelection();
                          let node = sel.anchorNode;
                          while (node && node.tagName !== 'OL') node = node.parentElement;
                          if (node) {
                            node.style.listStyleType = n.style;
                            if (n.paren) {
                              node.classList.add('nv-paren-list');
                            } else {
                              node.classList.remove('nv-paren-list');
                            }
                          }
                          scheduleSave();
                        }}>
                        {n.lines.map((l, j) => <span key={j} style={{ lineHeight: 1.3 }}>{l} ────</span>)}
                      </button>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
                    <button style={{ width: '100%', padding: '4px 8px', border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: '.7rem', cursor: 'pointer', textAlign: 'left' }}
                      onMouseDown={e => { e.preventDefault(); document.getElementById('numberLibMenu').style.display = 'none'; editorRef.current?.focus({ preventScroll: true }); if (savedRangeRef.current) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRangeRef.current); } document.execCommand('insertOrderedList', false); document.execCommand('insertOrderedList', false); scheduleSave(); }}>
                      None (remove numbering)
                    </button>
                  </div>
                </div>
              </div>

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
                  if (e.target.value === 'normal') execCmd('foreColor', '#19eb6aff');
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
              <button className="tb-btn" title="Insert text box" onClick={insertTextBox}>📦 TextBox</button>
              <button className="tb-btn" title="Horizontal rule" onMouseDown={e => { e.preventDefault(); insertHorizontalRule(); }}>─ Line</button>
              <button className="tb-btn" title="Clear ALL formatting" onMouseDown={e => { e.preventDefault(); clearAllFormatting(); }}>✕ Format</button>

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
                debouncedFontQuery();
                debouncedUpdateWordCount(); ensureTrailingParagraph(); scheduleSave();
              }}
              onKeyDown={e => {
                // Ctrl+Up/Down: same as toolbar 📏↑ / 📏↓ buttons
                if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); increaseSelectedTextSize(); }
                if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); decreaseSelectedTextSize(); }
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
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '.72rem', fontWeight: 600, fontFamily: 'var(--font)', padding: '2px 8px' }}
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  title="Export this note"
                >📥 Export</button>
                {showExportMenu && (
                  <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.3)', padding: '4px 0', minWidth: 160, zIndex: 200, fontFamily: 'var(--font)' }}>
                    <div style={{ padding: '4px 12px', fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600 }}>Current Note</div>
                    {[{ f: 'txt', icon: '📄', label: 'Plain Text (.txt)' }, { f: 'md', icon: '📝', label: 'Markdown (.md)' }, { f: 'html', icon: '🌐', label: 'HTML (.html)' }].map(o => (
                      <button key={o.f} style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={() => exportCurrentNote(o.f)}>{o.icon} {o.label}</button>
                    ))}
                    <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                    <div style={{ padding: '4px 12px', fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600 }}>All Notes</div>
                    <button style={{ width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--font)' }} onMouseEnter={e => e.target.style.background = 'rgba(108,99,255,.1)'} onMouseLeave={e => e.target.style.background = 'none'} onClick={exportAllNotes}>📦 Export All as ZIP</button>
                  </div>
                )}
              </div>
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

      {/* Toast Queue */}
      <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
        {toastQueue.map(t => (
          <div key={t.id} className="toast show">{t.msg}</div>
        ))}
      </div>

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

      {/* ── Profile Edit Modal ── */}
      {showProfileEdit && (
        <ProfileModal
          user={user}
          API={API}
          getToken={getToken}
          onClose={() => setShowProfileEdit(false)}
          onChangePassword={async (old_password, new_password) => {
            try {
              const res = await fetch(API + '/auth/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
                body: JSON.stringify({ old_password, new_password })
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Failed to update password');
              showToastMsg('✅ Password updated successfully');
            } catch (err) {
              showToastMsg('❌ ' + err.message);
            }
          }}
          onSave={async (formData) => {
            try {
              const updated = await apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify(formData) });
              setUser(updated);
              localStorage.setItem('nv_user', JSON.stringify(updated));
              showToastMsg('✅ Profile updated');
              setShowProfileEdit(false);
            } catch { showToastMsg('⚠️ Failed to update profile'); }
          }}
          onLinkPhone={async (phone) => {
            try {
              const updated = await apiFetch('/auth/link/phone', { method: 'POST', body: JSON.stringify({ phone }) });
              setUser(updated); localStorage.setItem('nv_user', JSON.stringify(updated));
              showToastMsg('📱 Phone linked!');
            } catch (e) { showToastMsg('⚠️ ' + (e.message || 'Failed to link phone')); }
          }}
        />
      )}
    </>
  );
}
