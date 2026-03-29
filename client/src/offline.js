import { openDB } from 'idb';

const DB_NAME = 'notevault_offline';
const DB_VERSION = 1;

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        const store = db.createObjectStore('sync_queue', { keyPath: 'qid', autoIncrement: true });
        store.createIndex('note_id', 'note_id');
      }
    },
  });
}

// ─── Cache: save all notes from API ───────────────────
export async function cacheNotes(notesArray) {
  const db = await getDb();
  const tx = db.transaction('notes', 'readwrite');
  for (const n of notesArray) {
    const existing = await tx.store.get(n.id);
    if (existing && existing.is_dirty) continue;
    await tx.store.put({ ...n, tags: n.tags || [], is_dirty: false });
  }
  await tx.done;
}

// ─── Cache: save single note ──────────────────────────
export async function cacheNote(note) {
  const db = await getDb();
  await db.put('notes', { ...note, tags: note.tags || [], is_dirty: false });
}

// ─── Read: all notes ──────────────────────────────────
export async function getOfflineNotes() {
  const db = await getDb();
  const all = await db.getAll('notes');
  return all.sort((a, b) => (b.modified || 0) - (a.modified || 0));
}

// ─── Read: single note ───────────────────────────────
export async function getOfflineNote(id) {
  const db = await getDb();
  return (await db.get('notes', id)) || null;
}

// ─── Write: save note offline (mark dirty) ────────────
export async function saveNoteOffline(noteId, title, content, tags) {
  const db = await getDb();
  const now = Date.now();
  const isNew = !noteId || noteId === 'new';
  const id = isNew ? 'local_' + now : noteId;

  await db.put('notes', {
    id, title: title || '', content: content || '',
    tags: tags || [], modified: now, created: now, is_dirty: true,
  });

  await db.add('sync_queue', {
    note_id: id,
    action: isNew ? 'create' : 'update',
    payload: JSON.stringify({ title, content, tags }),
    created_at: new Date().toISOString(),
  });

  return { id, title, content, tags, modified: now, created: now };
}

// ─── Delete: remove note offline ──────────────────────
export async function deleteNoteOffline(noteId) {
  const db = await getDb();
  await db.delete('notes', noteId);
  if (!noteId.startsWith('local_')) {
    await db.add('sync_queue', {
      note_id: noteId, action: 'delete',
      payload: '{}', created_at: new Date().toISOString(),
    });
  }
}

// ─── Sync queue processing ────────────────────────────
export async function syncQueue(apiBase, token) {
  if (!navigator.onLine) return;
  const db = await getDb();
  const items = await db.getAll('sync_queue');
  if (!items.length) return;

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

  for (const item of items) {
    try {
      if (item.action === 'create') {
        const payload = JSON.parse(item.payload);
        const res = await fetch(apiBase + '/notes', { method: 'POST', headers, body: JSON.stringify(payload) });
        if (res.ok) {
          const newNote = await res.json();
          const tx = db.transaction('notes', 'readwrite');
          await tx.store.delete(item.note_id);
          await tx.store.put({ ...newNote, is_dirty: false });
          await tx.done;
        }
      } else if (item.action === 'update') {
        const payload = JSON.parse(item.payload);
        await fetch(apiBase + '/notes/' + item.note_id, { method: 'PUT', headers, body: JSON.stringify(payload) });
        const tx = db.transaction('notes', 'readwrite');
        const note = await tx.store.get(item.note_id);
        if (note) { note.is_dirty = false; await tx.store.put(note); }
        await tx.done;
      } else if (item.action === 'delete') {
        await fetch(apiBase + '/notes/' + item.note_id, { method: 'DELETE', headers });
      }
      await db.delete('sync_queue', item.qid);
    } catch (err) {
      console.warn('Sync item failed:', err);
      break;
    }
  }
  console.log('✅ Sync complete');
}
