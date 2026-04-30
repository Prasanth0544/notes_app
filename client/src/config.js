// API URL detection — same logic as the original app.js
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isCapacitor = isLocalhost && !window.location.port;
const isLocalDev  = isLocalhost && !!window.location.port;

const RENDER_API = 'https://notes-app-e06a.onrender.com/api';

let API;
if (isCapacitor) {
  API = RENDER_API;
} else if (isLocalDev) {
  API = 'http://localhost:4000/api';
} else {
  // Production (Vercel or any non-localhost host) → Render backend
  API = RENDER_API;
}

export default API;
