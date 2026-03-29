import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../config.js';
import '../styles/login.css';

const ROLES = [
  { emoji: '🎓', label: 'Student' },
  { emoji: '💻', label: 'Developer' },
  { emoji: '🎨', label: 'Designer' },
  { emoji: '💼', label: 'Professional' },
  { emoji: '🔬', label: 'Researcher' },
  { emoji: '🌟', label: 'Other' },
];

export default function ProfileSetup() {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState('');
  const [toast, setToast] = useState({ msg: '', isError: true, show: false });
  const [user, setUser] = useState({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) localStorage.setItem('nv_token', urlToken);
    const token = localStorage.getItem('nv_token');
    if (!token) { navigate('/login'); return; }
    try {
      const u = JSON.parse(localStorage.getItem('nv_user') || '{}');
      setUser(u);
    } catch {}
  }, []);

  const token = localStorage.getItem('nv_token');

  async function saveProfile(e) {
    e.preventDefault();
    const form = e.target;
    const password = form.password.value;
    if (password && password.length < 6) {
      return setToast({ msg: 'Backup password must be at least 6 characters', isError: true, show: true });
    }
    const body = {
      username: form.username.value.trim(),
      name: form.displayname.value.trim(),
      age: form.age.value.trim(),
      role: selectedRole,
      backup_password: password || '',
    };
    const res = await fetch(API + '/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setToast({ msg: data.error || 'Could not save profile', isError: true, show: true });
    localStorage.setItem('nv_user', JSON.stringify(data));
    setToast({ msg: '✅ Profile saved! Loading your notes…', isError: false, show: true });
    setTimeout(() => navigate('/'), 900);
  }

  async function handleSkip() {
    await fetch(API + '/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ profile_done: true }),
    });
    navigate('/');
  }

  const [showPw, setShowPw] = useState(false);

  return (
    <>
      <div className="bg-orbs"><div className="orb orb1"></div><div className="orb orb2"></div><div className="orb orb3"></div></div>
      <div className="auth-wrapper">
        <div className="brand"><span className="brand-icon">📓</span><span className="brand-name">NoteVault</span></div>
        <p className="brand-tagline">Almost there! Tell us a bit about yourself.</p>

        <div className="auth-card">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6c63ff' }}></div>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6c63ff' }}></div>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }}></div>
          </div>

          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #6c63ff, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', margin: '0 auto 16px', color: '#fff', overflow: 'hidden' }}>
            {user.avatar ? <img src={user.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : '🧑'}
          </div>

          <form className="auth-form" onSubmit={saveProfile} autoComplete="off">
            <div className="field-group">
              <label>Username <span style={{ color: '#64748b', fontWeight: 400 }}>(how others see you)</span></label>
              <input type="text" name="username" placeholder="e.g. prasanth_notes" maxLength={30} />
            </div>
            <div className="field-group">
              <label>Display Name</label>
              <input type="text" name="displayname" placeholder="Your full name" defaultValue={user.name || ''} />
            </div>
            <div className="field-group">
              <label>Age</label>
              <input type="number" name="age" placeholder="e.g. 21" min={5} max={120} />
            </div>
            <div className="field-group">
              <label>I am a…</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 6 }}>
                {ROLES.map(r => (
                  <button type="button" key={r.label}
                    className={`role-card ${selectedRole === r.label ? 'selected' : ''}`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 8px', borderRadius: 12, border: `2px solid ${selectedRole === r.label ? '#6c63ff' : 'rgba(255,255,255,0.08)'}`, background: selectedRole === r.label ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.04)', cursor: 'pointer', fontSize: '0.78rem', color: selectedRole === r.label ? '#a78bfa' : '#94a3b8', transition: 'all 0.2s', fontFamily: "'Inter', sans-serif", userSelect: 'none' }}
                    onClick={() => setSelectedRole(r.label)}>
                    <span style={{ fontSize: '1.6rem' }}>{r.emoji}</span>{r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-group">
              <label>🔑 Set a Backup Password <span style={{ color: '#64748b', fontWeight: 400 }}>(for login without Google/GitHub)</span></label>
              <div className="pw-wrap" style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} name="password" placeholder="Min 6 characters" minLength={6} />
                <button type="button" className="pw-toggle" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}
                  onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁'}</button>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 6, lineHeight: 1.4 }}>
                ⚡ This lets you sign in with your email + this password if you can't use Google/GitHub.
              </div>
            </div>
            <button type="submit" className="btn-primary">Save & Open NoteVault →</button>
          </form>

          {toast.show && <div className={`auth-toast ${toast.isError ? 'err' : 'ok'}`}>{toast.msg}</div>}

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <a onClick={handleSkip} style={{ color: '#6c63ff', fontSize: '0.82rem', textDecoration: 'none', cursor: 'pointer' }}>Skip for now — fill in later</a>
          </div>
        </div>

        <p className="footer-note">🔒 This info is private and stored securely.</p>
      </div>
    </>
  );
}
