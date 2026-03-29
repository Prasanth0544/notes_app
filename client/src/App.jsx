import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import ProfileSetup from './pages/ProfileSetup.jsx';
import NotesApp from './pages/NotesApp.jsx';

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('nv_token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login.html" element={<LoginPage />} />
      <Route path="/profile-setup" element={
        <ProtectedRoute><ProfileSetup /></ProtectedRoute>
      } />
      <Route path="/profile-setup.html" element={
        <ProtectedRoute><ProfileSetup /></ProtectedRoute>
      } />
      <Route path="/" element={
        <ProtectedRoute><NotesApp /></ProtectedRoute>
      } />
      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
