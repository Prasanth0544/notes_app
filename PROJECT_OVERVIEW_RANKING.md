# NoteVault Project Overview and Folder Ranking

## Project Overview

NoteVault is a full-stack private notes application with web, API, offline-first storage, and Android APK support.

## Main Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 19 + Vite | Single-page notes application |
| Backend | Node.js + Express | REST API for auth, notes, folders, sync, images |
| Database | MongoDB | Persistent users, notes, folders, auth metadata |
| Offline storage | IndexedDB via `idb` | Local notes/folders cache and sync queue |
| Mobile | Capacitor Android | APK wrapper around the web app |
| Deployment | Vercel + Render | Frontend hosting and backend API hosting |

## Important Files

| File | Purpose |
|---|---|
| `client/src/pages/NotesApp.jsx` | Main notes UI, editor, folder ranking, prefetch logic |
| `client/src/offline.js` | IndexedDB stores, cache helpers, offline sync queue |
| `client/src/config.js` | API URL selection |
| `server/server.js` | Express startup, MongoDB indexes, middleware |
| `server/routes/auth.js` | Email, phone, Google, GitHub auth, profile, logout |
| `server/routes/notes.js` | Notes CRUD, folders, trash, pin, folder access ranking |
| `server/routes/sync.js` | Offline/mobile sync API |
| `server/routes/images.js` | Cloudinary/base64 image upload |

## Feature Summary

NoteVault supports:

- Rich-text note editing.
- Folder organization.
- Pinned notes.
- Trash, restore, and permanent delete.
- Tags and search.
- Image upload.
- Export options.
- Offline note caching with IndexedDB.
- Offline write queue with replay when online.
- Email/password login.
- Phone/password login.
- Google and GitHub OAuth.
- Android APK builds through Capacitor.

## Folder Ranking Overview

The ranking system is folder-based, not individual-note-based.

It does not store ranks like this:

```txt
note A = rank 1
note B = rank 2
note C = rank 3
```

It stores folder access timestamps like this:

```txt
folder Java  = last_accessed timestamp
folder DBMS  = last_accessed timestamp
folder React = last_accessed timestamp
```

The folder with the newest `last_accessed` timestamp is treated as the highest priority for background note prefetching.

## Where Ranking Is Stored

### 1. Memory

Current-session ranking is stored in `NotesApp.jsx`:

```js
const folderRankingRef = useRef(new Map());
```

Shape:

```js
Map {
  "Java" => 1716540000000,
  "DBMS" => 1716539900000
}
```

This is fast and updates immediately while the app is open.

### 2. MongoDB

Persistent ranking is stored in the `user_folders` collection as `last_accessed`.

When a folder is accessed, the client calls:

```txt
PUT /api/notes/folders/:name/access
```

The backend updates:

```js
{
  user_id: "...",
  name: "Java",
  last_accessed: 1716540000000
}
```

MongoDB is the source of truth across devices, browsers, and the Android APK.

### 3. IndexedDB

Offline ranking is cached in IndexedDB in the `folders` store.

Stored shape:

```js
{
  name: "Java",
  last_accessed: 1716540000000
}
```

This lets the app still use ranking information when offline.

## How Ranking Is Updated

When a folder is opened or a note inside a folder is selected, `updateFolderAccess(folderName)` runs.

It does two things:

1. Updates `folderRankingRef` immediately in memory.
2. Sends a throttled fire-and-forget API request to store the timestamp in MongoDB.

The API call is throttled to reduce repeated writes during fast folder clicks.

## How Ranking Is Used

Ranking is used by `prefetchAllNotes(loadedNotes, currentFolder)`.

The prefetch order is:

```txt
1. Notes in the currently active folder
2. Notes from other folders sorted by last_accessed descending
3. Unfiled notes
```

Example:

```txt
Java  last_accessed = 300
DBMS  last_accessed = 200
React last_accessed = 100

Current active folder = DBMS
```

Prefetch order:

```txt
1. DBMS notes
2. Java notes
3. React notes
4. Unfiled notes
```

The active folder always wins, even if another folder has a newer timestamp.

## Memory vs Database Summary

| Storage | What It Stores | Lifetime | Purpose |
|---|---|---|---|
| `folderRankingRef` | Folder name to timestamp map | Current app session | Fast in-memory ranking |
| MongoDB `user_folders.last_accessed` | Persistent folder timestamp | Permanent | Cross-device source of truth |
| IndexedDB `folders.last_accessed` | Cached folder timestamp | Browser/mobile local cache | Offline ranking |

## Test Coverage Around Ranking and IndexedDB

There are automated checks, static wiring checks, and documented/manual cases.

## Automated Ranking API Checks

There are about 4 direct API-level checks across 2 scripts:

### `test_features.js`

- Checks that folders returned by `GET /notes/folders` contain `last_accessed`.
- Checks that `PUT /notes/folders/:name/access` updates `last_accessed`.

### `test_fullstack.js`

- Checks that folders return `last_accessed`.
- Checks that `last_accessed` changes after folder access.

These tests verify the backend ranking API and MongoDB persistence path.

## Static Wiring Checks

`test_fullstack.js` also checks whether key frontend/offline functions exist:

- `cacheFolders`
- `getNoteIdsWithContent`
- `cleanupStaleNotes`
- `syncQueue`
- `folderRankingRef`
- `updateFolderAccess`
- `prefetchAllNotes`

These are useful smoke checks, but they do not fully simulate browser behavior.

## Documented Manual Edge Cases

`CHANGES_APR30.md` documents 38 ranking/offline edge cases.

They cover:

- Folder lifecycle: create, delete, rename, trash, restore.
- Ranking updates: clicking folders, clicking notes inside folders, rapid clicks.
- Prefetch ordering: active folder first, ranked folders second, unfiled notes last.
- IndexedDB warm-up: first visit, repeat visit, stale cache, cleared cache.
- Network behavior: offline mode, server failure, intermittent errors.
- Progress toasts.
- Cross-platform behavior between web and APK.

## Honest Coverage Summary

```txt
Automated ranking API checks: about 4
Static frontend/offline wiring checks: about 8
Documented/manual ranking edge cases: 38
True browser IndexedDB behavioral tests: 0
```

The main testing gap is the lack of browser-level tests that open the app, click folders, inspect IndexedDB, simulate offline mode, and verify the actual prefetch order.

## What `CHANGES_APR30.md` Is

`CHANGES_APR30.md` is a historical session walkthrough/change log from April 30, 2026.

It documents:

- Ranked offline prefetching.
- Security hardening.
- OAuth code exchange changes.
- Password change feature.
- Deployment configuration.
- The 38 documented ranking/offline edge cases.
- Files changed during that session.

It is not the main project README. It is more like an implementation notes file for a major development session.
