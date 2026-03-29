// API URL detection — same logic as the original app.js
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isCapacitor = isLocalhost && !window.location.port;
const isLocalDev  = isLocalhost && !!window.location.port;

let API;
if (isCapacitor) {
  API = 'https://notes-app-e06a.onrender.com/api';
} else if (isLocalDev) {
  API = 'http://localhost:5000/api';
} else {
  API = '/api';
}

export default API;
