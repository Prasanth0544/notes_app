# 📓 NoteVault

A full-featured private notes application built with the **MERN stack** (MongoDB, Express, React, Node.js). Features rich text editing, image uploads, offline support, and multi-platform access including a mobile app.

**Live Demo:** [notes-app-hazel-six.vercel.app](https://notes-app-hazel-six.vercel.app)

---

## ✨ Features

- **Rich Text Editor** — Bold, italic, headings, lists, tables, code blocks, images, custom font sizes, colors, and more
- **Multi-Auth** — Email/password, phone/password, Google OAuth, and GitHub OAuth
- **Image Uploads** — Drag-and-drop / paste images, stored on Cloudinary (base64 fallback)
- **Offline Support** — IndexedDB-backed offline cache with automatic sync when reconnected
- **Mobile App** — Android APK via Capacitor (in `mobile/` directory)
- **Dark / Light Theme** — Toggle with one click, persisted to localStorage
- **Tags & Search** — Organize notes with tags, search by title or tag
- **Export** — Download notes as standalone HTML files
- **Find & Replace** — In-document text search with highlight and replace
- **Print** — Print-friendly document formatting
- **Document Stats** — Word count, character count, reading time
- **Auto-Save** — Notes save automatically 900ms after you stop typing
- **Zoom Controls** — Zoom in/out on the editor for accessibility

---

## 🏗️ Tech Stack

| Layer      | Technology                              |
|------------|-----------------------------------------|
| Frontend   | React 18, Vite, Vanilla CSS             |
| Backend    | Node.js, Express 4                      |
| Database   | MongoDB (Atlas or local Compass)        |
| Auth       | JWT, bcryptjs, Google/GitHub OAuth      |
| Images     | Cloudinary (with base64 fallback)       |
| Offline    | IndexedDB via `idb`                     |
| Mobile     | Capacitor (Android)                     |
| Hosting    | Vercel (frontend) + Render (backend)    |
| Security   | Helmet, CORS, express-rate-limit        |

---

## 🚀 Quick Start (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [MongoDB](https://www.mongodb.com/try/download/community) (local) or [MongoDB Atlas](https://www.mongodb.com/atlas) (cloud)

### 1. Clone & Install

```bash
git clone https://github.com/Prasanth0544/notes_app.git
cd notes_app
npm run install:all
```

### 2. Configure Environment

Copy the example env and fill in your values:

```bash
cp .env.example .env
```

**Minimum required:**
```env
MONGO_URI=mongodb://localhost:27017
JWT_SECRET_KEY=your-long-random-secret-here-64-chars-minimum
```

**Optional (for full features):**
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_secret
```

### 3. Run the App

```bash
# Start the backend (serves API on port 4000)
npm run dev

# In a separate terminal, start the frontend dev server
cd client && npm run dev
```

Or build and serve everything from one server:

```bash
npm run build     # Builds the React frontend
npm start         # Serves both API + frontend on port 4000
```

Then open [http://localhost:4000](http://localhost:4000).

---

## 📁 Project Structure

```
notes-app/
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── pages/          # LoginPage, ProfileSetup, NotesApp
│   │   ├── styles/         # style.css, login.css
│   │   ├── App.jsx         # Router setup
│   │   ├── config.js       # API URL detection
│   │   ├── offline.js      # IndexedDB offline cache
│   │   └── main.jsx        # Entry point
│   └── dist/               # Production build output
├── server/                 # Express backend
│   ├── routes/
│   │   ├── auth.js         # Email, phone, Google, GitHub auth
│   │   ├── notes.js        # CRUD operations
│   │   ├── images.js       # Cloudinary / base64 upload
│   │   └── sync.js         # Mobile sync (pull/push/delete)
│   ├── middleware/
│   │   └── auth.js         # JWT verification
│   ├── utils/
│   │   └── helpers.js      # Formatters
│   └── server.js           # Entry point
├── mobile/                 # Capacitor Android project
├── .env.example            # Environment template
├── render.yaml             # Render deployment config
├── vercel.json             # Vercel deployment config
└── package.json            # Root scripts
```

---

## 🌐 Deployment

### Backend → Render

1. Connect your GitHub repo on [Render](https://render.com)
2. Create a **Web Service** using `render.yaml`
3. Set all environment variables in the Render dashboard
4. Deploy

### Frontend → Vercel

1. Connect your GitHub repo on [Vercel](https://vercel.com)
2. Vercel auto-detects the config from `vercel.json`
3. API requests are proxied to your Render backend
4. Deploy

---

## ⌨️ Keyboard Shortcuts

| Shortcut         | Action              |
|------------------|---------------------|
| `Ctrl + S`       | Save note           |
| `Ctrl + N`       | New note            |
| `Ctrl + F`       | Find & Replace      |
| `Ctrl + P`       | Print document      |
| `Ctrl + +`       | Zoom in             |
| `Ctrl + -`       | Zoom out            |
| `Ctrl + 0`       | Reset zoom          |

---

## 📄 License

ISC © Prasanth Gannavarapu
