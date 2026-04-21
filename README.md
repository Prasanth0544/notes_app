# 📝 NoteVault — Your Private Notes, Always Secure

A full-stack, offline-first notes application with multi-platform support (Web, Mobile APK), multi-auth login, folder organization, and real-time sync.

> **Live:** [notes-app-hazel-six.vercel.app](https://notes-app-hazel-six.vercel.app)  
> **API:** [notes-app-e06a.onrender.com](https://notes-app-e06a.onrender.com)

---

## 📑 Table of Contents

- [Technology Stack](#-technology-stack)
- [Architecture Overview](#-architecture-overview)
- [Project Structure](#-project-structure)
- [Features](#-features)
- [API Endpoints](#-api-endpoints)
- [Frontend Functions Reference](#-frontend-functions-reference)
- [Offline System (IndexedDB)](#-offline-system-indexeddb)
- [Authentication Flow](#-authentication-flow)
- [Setup & Installation](#-setup--installation)
- [Running Locally](#-running-locally)
- [Building the Mobile APK](#-building-the-mobile-apk)
- [Deployment](#-deployment)
- [Environment Variables](#-environment-variables)
- [Testing](#-testing)

---

## 🛠 Technology Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 19** | UI framework (SPA) |
| **React Router v7** | Client-side routing |
| **Vite 8** | Build tool & dev server |
| **IndexedDB (idb)** | Offline-first data persistence |
| **Vanilla CSS** | Custom design system with CSS variables |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js** | Runtime |
| **Express 4** | HTTP framework |
| **MongoDB Atlas** | Cloud database (native driver, no Mongoose) |
| **JWT (jsonwebtoken)** | Stateless authentication (30-day tokens) |
| **bcryptjs** | Password hashing |
| **sanitize-html** | XSS prevention on all note content |
| **Cloudinary** | Image hosting for uploaded images |
| **Helmet** | HTTP security headers |
| **compression** | Gzip response compression |
| **express-rate-limit** | Rate limiting on auth endpoints |
| **axios** | OAuth HTTP calls (Google/GitHub) |
| **multer** | File upload handling |

### Mobile
| Technology | Purpose |
|---|---|
| **Capacitor 8** | Native wrapper (WebView → APK) |
| **@capacitor/network** | Network status detection |
| **@capacitor-community/sqlite** | Local SQLite (optional) |
| **Android Studio / Gradle** | APK compilation |

### Deployment
| Platform | Role |
|---|---|
| **Vercel** | Frontend hosting (auto-deploys on push) |
| **Render** | Backend API hosting (auto-deploys on push) |
| **MongoDB Atlas** | Cloud database |
| **Cloudinary** | Image CDN |
| **Google Cloud Console** | OAuth credentials |
| **GitHub** | Source control + CI triggers |

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT (React SPA)                   │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐  │
│  │LoginPage │  │ProfileSe.│  │    NotesApp.jsx      │  │
│  │          │  │          │  │  (Main Editor)       │  │
│  └──────────┘  └──────────┘  └─────────────────────┘  │
│                        │                                │
│              ┌─────────┴──────────┐                    │
│              │   config.js        │                    │
│              │ (API URL routing)  │                    │
│              └─────────┬──────────┘                    │
│                        │                                │
│              ┌─────────┴──────────┐                    │
│              │   offline.js       │                    │
│              │ (IndexedDB cache)  │                    │
│              └────────────────────┘                    │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTP (fetch)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                   SERVER (Express)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐│
│  │ auth.js  │  │ notes.js │  │ images.js│  │sync.js ││
│  │ (OAuth,  │  │ (CRUD,   │  │(Cloudina.│  │(bulk   ││
│  │  JWT)    │  │ folders) │  │  upload) │  │ sync)  ││
│  └──────────┘  └──────────┘  └──────────┘  └────────┘│
│                        │                                │
│              ┌─────────┴──────────┐                    │
│              │   middleware/auth  │                    │
│              │  (JWT verify +    │                    │
│              │   blacklist)       │                    │
│              └─────────┬──────────┘                    │
│                        │                                │
│              ┌─────────┴──────────┐                    │
│              │    MongoDB Atlas   │                    │
│              │  ┌──────┐┌──────┐ │                    │
│              │  │users ││notes │ │                    │
│              │  └──────┘└──────┘ │                    │
│              │  ┌──────────────┐ │                    │
│              │  │token_blackli.│ │                    │
│              │  └──────────────┘ │                    │
│              └────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### Data Flow: Try-API-First Pattern

```
User Action → Try API call
  ├── SUCCESS → Update UI + Cache to IndexedDB
  └── FAILURE → Read from IndexedDB cache
                └── Queue change in sync_queue
                    └── When online → Replay queue → Sync
```

---

## 📁 Project Structure

```
notes-app/
├── .env                    # Environment variables (gitignored)
├── .env.example            # Template for .env
├── .gitignore
├── package.json            # Root package (scripts)
├── render.yaml             # Render deployment config
├── vercel.json             # Vercel deployment config
│
├── client/                 # ── FRONTEND ──────────────────
│   ├── package.json        # React + Vite dependencies
│   ├── vite.config.js      # Vite build config
│   ├── index.html          # HTML entry point
│   └── src/
│       ├── main.jsx        # React root + BrowserRouter
│       ├── App.jsx         # Route definitions + ProtectedRoute
│       ├── config.js       # API URL detection (local/mobile/prod)
│       ├── offline.js      # IndexedDB offline persistence layer
│       ├── pages/
│       │   ├── LoginPage.jsx     # Auth UI (Email/Phone/OAuth tabs)
│       │   ├── ProfileSetup.jsx  # First-time profile completion
│       │   └── NotesApp.jsx      # Main app (editor, sidebar, tools)
│       └── styles/
│           ├── style.css         # Main app styles
│           └── login.css         # Auth page styles
│
├── server/                 # ── BACKEND ───────────────────
│   ├── package.json        # Express + MongoDB dependencies
│   ├── server.js           # Entry point, middleware, DB connect
│   ├── middleware/
│   │   └── auth.js         # JWT verify, blacklist, makeToken
│   ├── routes/
│   │   ├── auth.js         # Auth: register, login, OAuth, profile
│   │   ├── notes.js        # Notes: CRUD, folders, trash, pin
│   │   ├── images.js       # Image upload to Cloudinary
│   │   └── sync.js         # Bulk offline sync endpoint
│   └── utils/
│       └── helpers.js      # formatUser, formatNote, nowMs
│
└── mobile/                 # ── MOBILE (Capacitor) ────────
    ├── package.json        # Capacitor dependencies
    ├── capacitor.config.json  # App config (webDir, plugins)
    ├── www/                # Built web assets (copied from client/dist)
    └── android/            # Android Studio project
        ├── app/
        ├── build.gradle
        └── gradlew.bat     # Gradle build tool
```

---

## ✨ Features

### Notes
- Rich text editing (Bold, Italic, Underline, Strikethrough)
- Font family & size selection (with custom input)
- Text/background color picker
- Lists (ordered, unordered), tables, code blocks
- Image insertion (Cloudinary upload or base64)
- Horizontal rules, links, superscript/subscript
- Undo/Redo, Find & Replace
- Print, Download (HTML), Word/character count
- Line spacing control
- Auto-save with debounce (1.5s)

### Organization
- **Folders**: Create, rename, delete folders
- **Pin**: Pin important notes to top
- **Trash**: Soft delete → Restore or Permanent delete
- **Tabs**: Multi-tab editor (open multiple notes)
- **Search**: Full-text search across all notes

### UI
- Dark theme with glassmorphism design
- Collapsible sidebar, toolbar, and title bar
- Context menus (⋮) on notes and folders
- Mobile-responsive layout
- Toast notifications

### Auth
- **Email + Password** (register/login)
- **Phone + Password** (register/login)
- **Google OAuth 2.0** (sign in + account linking)
- **GitHub OAuth** (sign in + account linking)
- **Profile Editor**: Edit name, username, age, role
- **Account Linking**: Link multiple auth providers to one account
- **JWT tokens** (30-day expiry, blacklist on logout)

### Offline
- Full IndexedDB cache (notes, folders, metadata)
- Sync queue for offline edits
- Auto-sync when connection restores
- Quota-safe writes with automatic cleanup
- Server reachability ping (4s timeout)

---

## 🔌 API Endpoints

### Authentication (`/api/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | ❌ | Register with email + password |
| `POST` | `/login` | ❌ | Login with email + password |
| `POST` | `/register/phone` | ❌ | Register with phone + password |
| `POST` | `/login/phone` | ❌ | Login with phone + password |
| `GET` | `/google` | ❌ | Start Google OAuth flow |
| `GET` | `/google/callback` | ❌ | Google OAuth callback |
| `GET` | `/github` | ❌ | Start GitHub OAuth flow |
| `GET` | `/github/callback` | ❌ | GitHub OAuth callback |
| `GET` | `/me` | ✅ | Get current user profile |
| `PUT` | `/profile` | ✅ | Update profile (name, username, age, role) |
| `POST` | `/link/phone` | ✅ | Link phone number to account |
| `POST` | `/logout` | ✅ | Blacklist token (sign out) |

### Notes (`/api/notes`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | ✅ | List notes (query: `?q=`, `?folder=`) |
| `POST` | `/` | ✅ | Create note |
| `GET` | `/:id` | ✅ | Get single note |
| `PUT` | `/:id` | ✅ | Update note (title, content, tags) |
| `DELETE` | `/:id` | ✅ | Soft delete (move to trash) |
| `POST` | `/:id/restore` | ✅ | Restore from trash |
| `DELETE` | `/:id/permanent` | ✅ | Permanently delete |
| `GET` | `/trash/list` | ✅ | List trashed notes |
| `PATCH` | `/:id/pin` | ✅ | Toggle pin status |
| `PATCH` | `/:id/folder` | ✅ | Move note to folder |
| `GET` | `/folders` | ✅ | List all folders |
| `POST` | `/folders` | ✅ | Create folder |
| `DELETE` | `/folders/:name` | ✅ | Delete folder |
| `PUT` | `/folders/:name/rename` | ✅ | Rename folder |

### Images (`/api/images`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/upload` | ✅ | Upload image to Cloudinary |

### Sync (`/api/sync`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/push` | ✅ | Bulk push offline changes |
| `GET` | `/pull` | ✅ | Pull all notes for offline cache |

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | ❌ | Server status check (used by ping) |

---

## ⚛️ Frontend Functions Reference

### `NotesApp.jsx` — Main Application (~1750 lines)

#### State Management
| State Variable | Type | Purpose |
|---|---|---|
| `user` | Object | Current user profile |
| `allNotes` | Array | Notes list in sidebar |
| `activeId` | String | Currently open note ID |
| `noteTitle` | String | Current note's title |
| `noteFolder` | String | Current note's folder |
| `folders` | Array | Folder names list |
| `activeFolder` | String | Selected folder filter |
| `openTabs` | Array | Open editor tabs |
| `sidebarView` | String | `'notes'` or `'trash'` |
| `search` | String | Search query |
| `toolbarCollapsed` | Boolean | Toolbar visibility |
| `titleBarCollapsed` | Boolean | Title bar visibility |
| `showProfileEdit` | Boolean | Profile modal visibility |

#### Core Functions
| Function | Description |
|---|---|
| `apiFetch(url, opts)` | Authenticated HTTP client (auto-adds JWT Bearer token) |
| `loadUserProfile()` | Fetches user from API, caches to localStorage |
| `loadNotesList(q, folder)` | Loads notes list (API → fallback to IndexedDB) |
| `openNote(id)` | Opens a note in the editor, populates contentEditable |
| `createNote()` | Creates new note via API or offline |
| `saveCurrentNote()` | Saves current note (debounced, 1.5s) with auto-title |
| `deleteNote(id)` | Soft delete (trash) via API or offline queue |
| `quickDelete(id)` | Delete from sidebar menu (trash + UI update) |
| `renameNote(id)` | Prompt rename → API update → cache + tabs |
| `renameFolder(name)` | Prompt rename → API update → reload |

#### Folder Operations
| Function | Description |
|---|---|
| `loadFolders()` | Fetches folders (API → fallback to IndexedDB) |
| `createFolder()` | Prompt name → API create → sets active folder |
| `moveNoteToFolder(id, f)` | Move note to folder via API |
| `deleteFolder(name)` | Delete folder + unassign notes |
| `quickMoveToFolder(id, f)` | Move from context menu |

#### Trash Operations
| Function | Description |
|---|---|
| `loadTrash()` | Loads trashed notes |
| `restoreNote(id)` | Restores from trash |
| `permanentDelete(id)` | Permanently deletes from DB |

#### Editor Commands
| Function | Description |
|---|---|
| `exec(cmd, val)` | Wrapper for `document.execCommand()` |
| `togglePin(id)` | Toggle note's pinned status |
| `findAndHighlight(text)` | Find & highlight text in editor |
| `findAndReplace(find, replace, all)` | Find & replace text |
| `insertTable()` | Insert HTML table at cursor |
| `insertCodeBlock()` | Insert styled code block |
| `insertHR()` | Insert horizontal rule |
| `insertLink()` | Prompt for URL, insert anchor tag |
| `handleImageUpload()` | Upload image to Cloudinary, insert `<img>` |
| `downloadNote()` | Download note as `.html` file |
| `printNote()` | Open print dialog for note |

#### Online/Offline System
| Function | Description |
|---|---|
| `checkServerReachable()` | Pings `/api/health` (4s timeout) |
| `syncOfflineChanges()` | Replays sync_queue when back online |
| `scheduleSave()` | Debounced save (1500ms) |

### `LoginPage.jsx` — Authentication UI

| Function | Description |
|---|---|
| `handleAuthSuccess(data)` | Saves token + user to localStorage, routes to app |
| `handleEmailSubmit()` | Email register/login API call |
| `handlePhoneSubmit()` | Phone register/login API call |
| OAuth useEffect | Detects `?token=` param from OAuth, fetches profile, routes |

### `ProfileSetup.jsx` — First-Time Profile

| Function | Description |
|---|---|
| `handleSubmit()` | Saves profile (name, username, age, role, backup password) |

---

## 💾 Offline System (IndexedDB)

### `offline.js` — Database Layer

**Database:** `notevault_offline` (version 2)

#### Object Stores
| Store | Key | Purpose |
|---|---|---|
| `notes` | `id` | Cached note documents |
| `sync_queue` | `qid` (auto) | Pending offline changes |
| `folders` | `name` | Cached folder list |
| `meta` | `key` | Key-value metadata |

#### Exported Functions
| Function | Description |
|---|---|
| `cacheNotes(notes)` | Bulk cache notes array |
| `cacheNote(note)` | Cache single note |
| `getOfflineNotes()` | Get all cached notes |
| `getOfflineNote(id)` | Get single cached note |
| `saveNoteOffline(note)` | Save note + add to sync_queue |
| `deleteNoteOffline(id)` | Remove from cache + queue delete |
| `getSyncQueue()` | Get all pending sync items |
| `clearSyncQueue()` | Clear all pending syncs |
| `removeSyncItem(qid)` | Remove one sync item |
| `cacheFolders(folders)` | Cache folders list |
| `getOfflineFolders()` | Get cached folders |
| `createFolderOffline(name)` | Create folder in cache |
| `deleteFolderOffline(name)` | Delete folder from cache |
| `getToken() / setToken()` | Cache JWT token in IDB |

---

## 🔐 Authentication Flow

### Email/Phone Flow
```
User → POST /auth/register or /login
  → Server validates → bcrypt hash check
  → Returns { token, user }
  → Client saves to localStorage
  → Navigates to / or /profile-setup
```

### Google/GitHub OAuth Flow
```
User → GET /auth/google (or /github)
  → Server redirects to Google/GitHub
  → User authorizes
  → Callback: GET /auth/google/callback?code=xxx
  → Server exchanges code for user info
  → findOrCreateOAuthUser() merges by email
  → Redirect to /login?token=xxx
  → LoginPage saves token, fetches /auth/me
  → Routes to / (profile_done) or /profile-setup
```

### Account Linking Flow
```
User → Profile Modal → "Link Google" button
  → GET /auth/google?link_token=<current_jwt>
  → Google OAuth flow
  → Callback detects link_token in state
  → Adds 'google' to auth_providers
  → Redirect to /login?token=xxx&linked=google
  → Toast: "Google account linked!"
```

### JWT Token Lifecycle
```
makeToken(userId) → jwt.sign({ id }, secret, { expiresIn: '30d' })
  → Stored in localStorage as 'nv_token'
  → Sent as Bearer token in all API requests
  → On logout: token added to blacklist collection
  → MongoDB TTL index auto-cleans expired blacklist entries
```

---

## 🚀 Setup & Installation

### Prerequisites
- **Node.js** ≥ 18
- **MongoDB** (local via MongoDB Compass, or Atlas cloud)
- **Git**
- **Android Studio** (for APK builds only)

### 1. Clone & Install

```bash
git clone https://github.com/Prasanth0544/notes_app.git
cd notes-app

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies
cd client && npm install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Required
MONGO_URI=mongodb://localhost:27017         # or Atlas URI
JWT_SECRET_KEY=<64-char-random-string>

# OAuth (optional - for Google/GitHub login)
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
GITHUB_CLIENT_ID=<from-github-settings>
GITHUB_CLIENT_SECRET=<from-github-settings>

# Image hosting (optional)
CLOUDINARY_CLOUD_NAME=<cloud-name>
CLOUDINARY_API_KEY=<api-key>
CLOUDINARY_API_SECRET=<api-secret>

# URLs
APP_URL=http://localhost:4000               # Change for production
ALLOWED_ORIGINS=http://localhost:4000
```

### 3. Build Frontend

```bash
cd client
npm run build
cd ..
```

---

## 🖥 Running Locally

### Option A: Single Command
```bash
node server/server.js
```
Opens at **http://localhost:4000** (serves both API + frontend).

### Option B: Dev Mode (hot reload)
```bash
# Terminal 1: Backend
cd server && npm run dev

# Terminal 2: Frontend (Vite dev server on port 5173)
cd client && npm run dev
```

### Option C: Batch Script (Windows)
```bash
Start_NoteVault.bat
```

---

## 📱 Building the Mobile APK

### Method 1: Command Line (Gradle)

```bash
# 1. Build the latest frontend
cd client && npm run build && cd ..

# 2. Sync to mobile
Remove-Item -Recurse -Force "mobile\www\assets" -ErrorAction SilentlyContinue
Copy-Item -Recurse "client\dist\*" "mobile\www\" -Force

# 3. Capacitor sync
cd mobile
npx cap sync android

# 4. Build debug APK
cd android
.\gradlew.bat assembleDebug
cd ../..

# 5. APK output location:
# mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

**One-liner (PowerShell):**
```powershell
cd client; npm run build; cd ..; Remove-Item -Recurse -Force "mobile\www\assets" -ErrorAction SilentlyContinue; Copy-Item -Recurse "client\dist\*" "mobile\www\" -Force; cd mobile; npx cap sync android; cd android; .\gradlew.bat assembleDebug; cd ../..
```

### Method 2: Android Studio (GUI)

```bash
# 1. Build and sync (same as above steps 1-3)
cd client && npm run build && cd ..
Copy-Item -Recurse "client\dist\*" "mobile\www\" -Force
cd mobile && npx cap sync android && cd ..

# 2. Open in Android Studio
npx cap open android
# OR manually open: mobile/android/ folder in Android Studio
```

In Android Studio:
1. Wait for Gradle sync to complete
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. Click the **"locate"** link in the notification to find the APK
4. Default location: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

### Signed Release APK (for Play Store)

In Android Studio:
1. **Build → Generate Signed Bundle / APK**
2. Select **APK**
3. Create or select a **keystore** (`.jks` file)
4. Choose **release** build variant
5. APK output: `mobile/android/app/build/outputs/apk/release/app-release.apk`

### Mobile API Configuration

The mobile app auto-detects its environment in `config.js`:

| Environment | Detection | API URL |
|---|---|---|
| **Capacitor (APK)** | `localhost` + no port | `https://notes-app-e06a.onrender.com/api` |
| **Local dev** | `localhost:4000` | `http://localhost:4000/api` |
| **Vercel (prod)** | Any other hostname | `/api` (proxied via vercel.json) |

---

## 🌐 Deployment

### Vercel (Frontend)

Configured via `vercel.json`:
- **Build:** `cd client && npm install && npm run build`
- **Output:** `client/dist`
- **Rewrites:** `/api/*` → proxied to Render backend

Auto-deploys on every `git push` to `main`.

### Render (Backend)

Configured via `render.yaml`:
- **Build:** `cd server && npm install`
- **Start:** `cd server && node server.js`
- **Environment:** Set all env vars in Render Dashboard

Auto-deploys on every `git push` to `main`.

### Required Render Environment Variables

| Variable | Value |
|---|---|
| `MONGO_URI` | `mongodb+srv://...` (Atlas connection string) |
| `JWT_SECRET_KEY` | 64-char random string |
| `APP_URL` | `https://notes-app-hazel-six.vercel.app` |
| `ALLOWED_ORIGINS` | `https://notes-app-hazel-six.vercel.app,https://notes-app-e06a.onrender.com` |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `CLOUDINARY_CLOUD_NAME` | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | From Cloudinary dashboard |

### Google OAuth Setup

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create **OAuth 2.0 Client ID** (Web application)
3. Add **Authorized redirect URIs:**
   - `http://localhost:4000/api/auth/google/callback` (local)
   - `https://notes-app-hazel-six.vercel.app/api/auth/google/callback` (production)
4. Copy Client ID and Secret to `.env`

---

## 🔧 Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | ✅ | — | MongoDB connection string |
| `JWT_SECRET_KEY` | ✅ | `fallback` | JWT signing secret (64+ chars) |
| `PORT` | ❌ | `4000` | Server port |
| `APP_URL` | ❌ | `http://localhost:4000` | Base URL for OAuth redirects |
| `ALLOWED_ORIGINS` | ❌ | `*` | CORS allowed origins (comma-separated) |
| `GOOGLE_CLIENT_ID` | ❌ | — | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | ❌ | — | Google OAuth Client Secret |
| `GITHUB_CLIENT_ID` | ❌ | — | GitHub OAuth Client ID |
| `GITHUB_CLIENT_SECRET` | ❌ | — | GitHub OAuth Client Secret |
| `CLOUDINARY_CLOUD_NAME` | ❌ | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | ❌ | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | ❌ | — | Cloudinary API secret |

---

## 🧪 Testing

### API Test Suite (28 tests)
```bash
node test_features.js
```
Tests: Notes CRUD, Folders, Pin, Trash, HTML Sanitization, Logout + Token Blacklist.

### Full-Stack Test Suite (80 tests)
```bash
node test_fullstack.js
```
Tests: All API endpoints + offline sync + edge cases.

### Manual Testing Checklist
- [ ] Register with email → login → create notes
- [ ] Google OAuth login (requires Console setup)
- [ ] Create folders → move notes → rename → delete
- [ ] Pin/unpin notes → verify sort order
- [ ] Trash → restore → permanent delete
- [ ] Go offline → edit notes → come back online → verify sync
- [ ] Mobile APK: login → CRUD → offline behavior
- [ ] Profile edit → change name/username → verify update
- [ ] Link additional auth providers

---

## 📊 Database Collections

### `users`
```json
{
  "_id": "ObjectId",
  "email": "user@example.com",
  "phone": "+91...",
  "password_hash": "$2a$10...",
  "name": "John Doe",
  "username": "johndoe",
  "age": "25",
  "role": "Developer",
  "avatar": "https://...",
  "auth_providers": ["email", "google"],
  "profile_done": true,
  "created_at": "2026-04-20T..."
}
```

### `notes`
```json
{
  "_id": "ObjectId",
  "user_id": "ObjectId (string)",
  "title": "My Note",
  "content": "<p>HTML content...</p>",
  "tags": [],
  "folder": "Work",
  "pinned": false,
  "deleted_at": null,
  "created": 1713600000000,
  "modified": 1713600000000
}
```

### `token_blacklist`
```json
{
  "token": "eyJhbG...",
  "expiresAt": "2026-05-20T...",
  "blacklistedAt": "2026-04-21T..."
}
```

**Indexes:**
- `users`: `email` (unique, sparse), `phone` (unique, sparse), `oauth_id` (sparse)
- `notes`: `user_id + modified` (compound, descending)
- `token_blacklist`: `expiresAt` (TTL, auto-deletes expired tokens)

---

## 📜 License

Private project by [Prasanth Gannavarapu](https://github.com/Prasanth0544).
