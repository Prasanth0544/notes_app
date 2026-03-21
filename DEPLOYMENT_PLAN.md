# NoteVault – Deployment & Multi-User Plan

> **Status:** Planning only. Build this when free. Uses MongoDB Atlas as cloud DB.

---

## 🎯 Goal

| What | Detail |
|---|---|
| **Auth** | Email + password login / signup |
| **Users** | Each user sees only their own notes & images |
| **Database** | MongoDB Atlas (replaces local SQLite) |
| **Images** | Cloudinary or Atlas GridFS (replaces local `images/` folder) |
| **Hosting** | Render / Railway / Fly.io (free tier, Python Flask) |

---

## 🗂️ New Database Schema (MongoDB Atlas)

### Collection: `users`
```json
{
  "_id": "ObjectId",
  "email": "user@example.com",
  "password_hash": "bcrypt hash",
  "name": "Display Name",
  "created_at": "ISODate"
}
```

### Collection: `notes`
```json
{
  "_id": "ObjectId",
  "user_id": "ObjectId → users._id",   ← KEY: ties note to a user
  "title": "My Note",
  "content": "<p>HTML content</p>",
  "tags": ["work", "ideas"],
  "images": [
    { "name": "abc.png", "url": "https://cloudinary.com/..." }
  ],
  "created_at": "ISODate",
  "modified_at": "ISODate"
}
```

> Every query filters by `user_id` so users never see each other's data.

---

## 🏗️ Architecture

```
Browser (HTML/CSS/JS)
       │
       │  HTTPS
       ▼
Flask API  (Render / Railway)
       │
       ├── MongoDB Atlas  ← notes, users
       └── Cloudinary     ← image files
```

---

## 📦 New Python Dependencies

```txt
flask
flask-jwt-extended     ← JWT tokens for login sessions
pymongo[srv]           ← MongoDB Atlas driver
bcrypt                 ← password hashing
cloudinary             ← image hosting (optional, can use Atlas GridFS instead)
python-dotenv          ← load .env secrets
```

Install all:
```bash
pip install flask flask-jwt-extended pymongo[srv] bcrypt cloudinary python-dotenv
```

---

## 🔐 Auth Flow

```
1. POST /api/auth/register  { email, password, name }
        → hash password with bcrypt
        → save to users collection
        → return JWT token

2. POST /api/auth/login     { email, password }
        → verify bcrypt hash
        → return JWT token (expires 7 days)

3. All /api/notes/* routes
        → require Authorization: Bearer <token> header
        → decode user_id from token
        → filter all DB queries by user_id
```

---

## 🛣️ API Changes

| Endpoint | Change |
|---|---|
| `POST /api/auth/register` | **NEW** – create account |
| `POST /api/auth/login` | **NEW** – get JWT token |
| `GET /api/notes` | Add `user_id` filter from JWT |
| `POST /api/notes` | Set `user_id` from JWT |
| `PUT /api/notes/:id` | Verify note belongs to user |
| `DELETE /api/notes/:id` | Verify note belongs to user |
| `POST /api/images` | Upload to Cloudinary, return URL |

---

## 🖼️ Image Storage Options

### Option A – Cloudinary ✅ (recommended)
- Free tier: 25 GB storage, 25 GB bandwidth/month
- Images get a CDN URL like `https://res.cloudinary.com/...`
- No disk storage needed on server

### Option B – MongoDB Atlas GridFS
- Store images as binary inside MongoDB
- Simpler setup (no 3rd party), but slower for large images

---

## 🌐 Frontend Changes

- Add **Login / Register page** (`login.html`)
- Store JWT token in `localStorage`
- Add `Authorization: Bearer <token>` header to every API call
- Add **Logout button** in the sidebar
- Redirect to login page if token missing or expired

---

## 🚀 Deployment Steps (when ready)

### 1. Set up MongoDB Atlas
- Create free cluster at [cloud.mongodb.com](https://cloud.mongodb.com)
- Create database: `notevault`
- Create collections: `users`, `notes`
- Get connection string: `mongodb+srv://user:pass@cluster.mongodb.net/notevault`

### 2. Set up Cloudinary (for images)
- Create free account at [cloudinary.com](https://cloudinary.com)
- Get: `CLOUD_NAME`, `API_KEY`, `API_SECRET`

### 3. Set up `.env` file
```env
MONGO_URI=mongodb+srv://...
JWT_SECRET_KEY=some-long-random-secret
CLOUDINARY_CLOUD_NAME=your_cloud
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret
```

### 4. Deploy on Render (free)
- Push code to GitHub
- Create new Web Service on [render.com](https://render.com)
- Set environment variables from `.env`
- Build command: `pip install -r requirements.txt`
- Start command: `python server.py`

### 5. Update `app.js`
- Change `const API = 'http://localhost:5000/api'`
- To `const API = 'https://your-app.onrender.com/api'`

---

## 📁 Files to Create/Modify

| File | Action |
|---|---|
| `server.py` | Rewrite – add auth, pymongo, JWT |
| `app.js` | Update API calls + add auth headers |
| `index.html` | Add logout button |
| `login.html` | **NEW** – login & register page |
| `login.css` | **NEW** – login page styles |
| `requirements.txt` | **NEW** – list all pip packages |
| `.env` | **NEW** – secrets (never commit to git!) |
| `.gitignore` | **NEW** – exclude `.env`, `notes.db`, `images/` |

---

## ⏱️ Estimated Build Time

| Phase | Time |
|---|---|
| MongoDB Atlas + schema setup | 30 min |
| Auth API (register/login/JWT) | 1 hr |
| User-scoped notes API | 30 min |
| Frontend login page | 1 hr |
| Cloudinary image upload | 30 min |
| Deploy to Render | 30 min |
| **Total** | **~4 hours** |

---

> 💡 **When ready to build:** Open this file and say *"build the deployment plan"* — I'll implement it step by step.
