# Distributed Versioned Knowledge Notebook

> A cross-device notebook platform with version history, offline sync, and analytics — built on the Apache Hadoop ecosystem.

---

## 1. Overview

A notebook application where users can create, edit, and organize notes containing text, images, hyperlinks, and file attachments. Every edit is stored as an immutable version (append-only), enabling full history, rollback, and diff comparisons. Data is stored in a distributed pipeline using HDFS and HBase, with Spark-powered analytics.

---

## 2. Features

| Feature | Description |
|---|---|
| **Notes CRUD** | Create, read, update, delete notes with rich content (text, markdown, images, links, attachments) |
| **Version Control** | Every save creates a new immutable version; view history, compare, restore |
| **Multi-Device Access** | Login from any device, notes stay in sync |
| **Offline Mode** | Write notes offline → auto-sync when connection returns |
| **Search** | Full-text, keyword, and tag-based search across all notes |
| **Analytics** | Batch analytics on editing patterns, popular tags, user activity |

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Web) / React Native (Mobile) |
| Backend API | Python Flask (REST + WebSocket) |
| Authentication | JWT tokens with refresh rotation |
| Metadata DB | Apache HBase |
| File Storage | Hadoop HDFS |
| Analytics | Apache Spark (batch), Apache Hive (SQL queries) |
| Local Offline DB | IndexedDB (browser) / SQLite (mobile) |
| Containerization | Docker + Docker Compose |

---

## 4. Architecture

```
┌─────────────────────┐
│   Frontend Client    │
│  (React / Mobile)    │
└─────────┬───────────┘
          │ REST / WebSocket
┌─────────▼───────────┐
│    API Gateway       │
│  (Auth + Rate Limit) │
└─────────┬───────────┘
          │
┌─────────▼───────────┐
│   Backend Service    │
│   (Flask + Python)   │
└──┬──────────────┬───┘
   │              │
   ▼              ▼
┌──────┐    ┌──────────┐
│HBase │    │   HDFS   │
│(meta)│    │ (files)  │
└──────┘    └──────────┘
                │
          ┌─────▼─────┐
          │   Spark    │
          │(analytics) │
          └───────────┘
```

---

## 5. Data Model

### `notes_metadata` (HBase)

| Column | Type | Description |
|---|---|---|
| `note_id` | UUID (PK) | Unique note identifier |
| `user_id` | UUID (FK) | Owner of the note |
| `title` | String | Note title |
| `tags` | String[] | Searchable tags |
| `created_at` | Timestamp | Creation time |
| `updated_at` | Timestamp | Last modification time |
| `latest_version` | Integer | Current version number |
| `is_deleted` | Boolean | Soft delete flag |

### `note_versions` (HBase)

| Column | Type | Description |
|---|---|---|
| `note_id` | UUID (PK) | Reference to parent note |
| `version` | Integer (PK) | Version number |
| `content_path` | String | HDFS path to content file |
| `timestamp` | Timestamp | When this version was saved |
| `editor_id` | UUID | Who made this edit |
| `change_summary` | String | Optional edit description |

### `users` (HBase)

| Column | Type | Description |
|---|---|---|
| `user_id` | UUID (PK) | Unique user identifier |
| `email` | String (Unique) | Login email |
| `password_hash` | String | Bcrypt-hashed password |
| `created_at` | Timestamp | Account creation time |

### HDFS File Structure

```
/notevault/
  /notes/
    /<note_id>/
      v1.json
      v2.json
      /attachments/
        image1.png
        report.pdf
```

---

## 6. API Endpoints

### Auth

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login → returns JWT |
| POST | `/api/auth/refresh` | Refresh expired token |

### Notes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/notes` | List all notes for user |
| POST | `/api/notes` | Create new note |
| GET | `/api/notes/:id` | Get latest version of note |
| PUT | `/api/notes/:id` | Edit note → creates new version |
| DELETE | `/api/notes/:id` | Soft-delete note |

### Versions

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/notes/:id/versions` | List all versions |
| GET | `/api/notes/:id/versions/:v` | Get specific version |
| POST | `/api/notes/:id/restore/:v` | Restore to a previous version |

### Files

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/notes/:id/upload` | Upload attachment/image |
| GET | `/api/files/:path` | Serve file from HDFS |

### Search

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/search?q=` | Full-text search across notes |

---

## 7. Editing & Versioning Flow

```
User edits note
      ↓
Backend receives PUT /api/notes/:id
      ↓
New version number = latest_version + 1
      ↓
Content written to HDFS: /notes/<note_id>/v<N>.json
      ↓
Metadata updated in HBase (updated_at, latest_version)
      ↓
Response: updated note with new version info
```

> **Key principle:** No data is ever overwritten. Every edit is an append. This aligns with Hadoop's immutable storage model.

---

## 8. Offline Sync Strategy

```
User goes offline
      ↓
Edits saved to local DB (IndexedDB / SQLite)
with local timestamps and pending flag
      ↓
Connection restored
      ↓
Client sends all pending edits to server
      ↓
Server applies each edit as a new version
```

### Conflict Resolution: Last-Write-Wins (LWW)

- Each edit carries a client-side timestamp.
- If two devices edit the same note offline, the server accepts both as separate versions (v4, v5).
- The version with the latest timestamp becomes the `latest_version`.
- No data is lost — both edits exist in version history and can be manually merged by the user.

---

## 9. Analytics Pipeline (Spark)

Batch jobs running on a schedule (daily/weekly):

| Job | Output |
|---|---|
| **Most Edited Notes** | Top N notes by version count |
| **Active Users** | Users ranked by edit frequency |
| **Writing Patterns** | Edits by hour-of-day / day-of-week |
| **Popular Tags** | Tag frequency distribution |
| **Storage Usage** | HDFS space consumed per user |

Results stored in Hive tables, queryable via dashboard or API.

---

## 10. Build Stages

| Stage | Scope | Deliverable |
|---|---|---|
| **Stage 1** | User auth + Notes CRUD (Flask + SQLite) | Working REST API with login |
| **Stage 2** | Version control (append-only edits, history, restore) | Version endpoints functional |
| **Stage 3** | Migrate storage to HDFS + HBase | Notes stored in Hadoop cluster |
| **Stage 4** | Spark analytics pipeline | Dashboard with usage stats |
| **Stage 5** | Offline sync (IndexedDB + sync endpoint) | Works without internet |

---

## 11. Future Scope (Optional)

- **Note Recommendations** — "Users who read Hadoop notes also read Spark notes"
- **Knowledge Graph** — Visual links between related notes (Hadoop → HDFS → MapReduce)
- **Real-time Collaboration** — WebSocket-based concurrent editing
- **Export** — PDF / Markdown export of note history
