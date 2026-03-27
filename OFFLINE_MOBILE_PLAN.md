# NoteVault — Offline Mobile Support Plan

## Goal
Allow the mobile app (Capacitor/Android) to work **without internet**:
- Read cached notes offline
- Create/edit notes offline
- Auto-sync when internet returns

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                MOBILE APP                     │
│  ┌──────────┐    ┌──────────┐                │
│  │  UI/JS   │───▶│  Sync    │                │
│  │ (app.js) │    │  Engine  │                │
│  └────┬─────┘    └────┬─────┘                │
│       │               │                      │
│  ┌────▼─────┐    ┌────▼─────┐                │
│  │  SQLite  │◀──▶│  Render  │  ◀── internet  │
│  │ (local)  │    │  API     │                │
│  └──────────┘    └──────────┘                │
└──────────────────────────────────────────────┘
```

**Online:** Read/write → Render API → MongoDB Atlas (+ cache in SQLite)
**Offline:** Read/write → SQLite only (queue changes for sync)

---

## Implementation Steps

### Phase 1: Local SQLite Cache
- [ ] Create `offline.js` — SQLite wrapper using `@capacitor-community/sqlite`
- [ ] Create local tables: `notes`, `sync_queue`
- [ ] On login, download all user's notes from API → store in SQLite
- [ ] Load notes list from SQLite (instant, no network wait)

### Phase 2: Offline Read
- [ ] Check network status using `@capacitor/network`
- [ ] If offline → load notes from SQLite
- [ ] If online → fetch from API + update SQLite cache
- [ ] Show offline indicator banner in UI

### Phase 3: Offline Write
- [ ] Save new/edited notes to SQLite immediately
- [ ] Add entry to `sync_queue` table with action (create/update/delete)
- [ ] When online → process sync queue, push changes to API
- [ ] Clear queue entries after successful sync

### Phase 4: Conflict Resolution
- [ ] Track `updated_at` timestamps in both SQLite and MongoDB
- [ ] On sync: compare timestamps
- [ ] **Last-write-wins** strategy (simpler) or **prompt user** (safer)

---

## SQLite Schema

```sql
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,   -- MongoDB _id
  title       TEXT,
  content     TEXT,
  tags        TEXT,               -- JSON array as string
  updated_at  TEXT,               -- ISO timestamp
  created_at  TEXT,
  is_dirty    INTEGER DEFAULT 0   -- 1 = has unsynced local changes
);

CREATE TABLE sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     TEXT,
  action      TEXT,               -- 'create', 'update', 'delete'
  payload     TEXT,               -- JSON
  created_at  TEXT
);
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `mobile/www/offline.js` | **NEW** | SQLite wrapper + sync engine |
| `mobile/www/app.js` | **MODIFY** | Use offline.js for data layer |
| `mobile/www/index.html` | **MODIFY** | Add offline indicator + load offline.js |
| `mobile/www/style.css` | **MODIFY** | Add offline banner styles |

---

## Estimated Effort
- Phase 1-2 (read offline): **~2 hours**
- Phase 3 (write offline): **~2 hours**
- Phase 4 (conflict resolution): **~1 hour**
- **Total: ~5 hours**

---

## Prerequisites
- `@capacitor-community/sqlite` ✅ (already installed)
- `@capacitor/network` ✅ (already installed)
