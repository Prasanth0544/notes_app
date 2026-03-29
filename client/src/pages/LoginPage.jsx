import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../config.js';
import '../styles/login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('email');
  const [isLogin, setIsLogin] = useState(true);
  const [toast, setToast] = useState({ msg: '', isError: true, show: false });

  // ── Check URL token (from OAuth redirect) ──────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlErr = params.get('error');
    if (urlToken) {
      localStorage.setItem('nv_token', urlToken);
      navigate('/profile-setup');
      return;
    }
    if (urlErr) showToast(`OAuth failed: ${urlErr.replace('_', ' ')}. Check .env config.`);
    // If already logged in, redirect
    if (localStorage.getItem('nv_token')) navigate('/');
  }, []);

  function showToast(msg, isError = true) {
    setToast({ msg, isError, show: true });
  }

  function handleAuthSuccess(data) {
    localStorage.setItem('nv_token', data.token);
    localStorage.setItem('nv_user', JSON.stringify(data.user));
    if (!data.user.profile_done) {
      navigate('/profile-setup');
    } else {
      navigate('/');
    }
  }

  async function authFetch(path, body) {
    try {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: { error: 'Network error — check your connection.' } };
    }
  }

  async function handleEmailLogin(e) {
    e.preventDefault();
    const form = e.target;
    const { ok, data } = await authFetch('/auth/login', {
      email: form.email.value.trim(),
      password: form.password.value,
    });
    if (!ok) return showToast(data.error || 'Login failed');
    handleAuthSuccess(data);
  }

  async function handleEmailRegister(e) {
    e.preventDefault();
    const form = e.target;
    const { ok, data } = await authFetch('/auth/register', {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
    });
    if (!ok) return showToast(data.error || 'Registration failed');
    handleAuthSuccess(data);
  }

  async function handlePhoneLogin(e) {
    e.preventDefault();
    const form = e.target;
    const { ok, data } = await authFetch('/auth/login/phone', {
      phone: form.phone.value.trim(),
      password: form.password.value,
    });
    if (!ok) return showToast(data.error || 'Login failed');
    handleAuthSuccess(data);
  }

  async function handlePhoneRegister(e) {
    e.preventDefault();
    const form = e.target;
    const { ok, data } = await authFetch('/auth/register/phone', {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      password: form.password.value,
    });
    if (!ok) return showToast(data.error || 'Registration failed');
    handleAuthSuccess(data);
  }

  function PasswordField({ id, placeholder }) {
    const [show, setShow] = useState(false);
    return (
      <div className="pw-wrap">
        <input type={show ? 'text' : 'password'} name={id} id={id} placeholder={placeholder || '••••••••'} required />
        <button type="button" className="pw-toggle" onClick={() => setShow(!show)}>{show ? '🙈' : '👁'}</button>
      </div>
    );
  }

  return (
    <>
      <div className="bg-orbs"><div className="orb orb1"></div><div className="orb orb2"></div><div className="orb orb3"></div></div>
      <div className="auth-wrapper">
        <div className="brand">
          <span className="brand-icon">📓</span>
          <span className="brand-name">NoteVault</span>
        </div>
        <p className="brand-tagline">Your private, personal notes — always secure.</p>

        <div className="auth-card">
          {/* Tab strip */}
          <div className="tab-strip">
            {['email', 'phone', 'oauth'].map(tab => (
              <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => { setActiveTab(tab); setToast({ ...toast, show: false }); }}>
                {tab === 'email' ? '✉ Email' : tab === 'phone' ? '📱 Phone' : '🔗 Social'}
              </button>
            ))}
          </div>

          {/* ── EMAIL TAB ── */}
          {activeTab === 'email' && (
            <div>
              <div className="subtoggle">
                <button className={`stab ${isLogin ? 'active' : ''}`} onClick={() => { setIsLogin(true); setToast({ ...toast, show: false }); }}>Sign In</button>
                <button className={`stab ${!isLogin ? 'active' : ''}`} onClick={() => { setIsLogin(false); setToast({ ...toast, show: false }); }}>Create Account</button>
              </div>
              {isLogin ? (
                <form className="auth-form" onSubmit={handleEmailLogin} autoComplete="off">
                  <div className="field-group"><label>Email</label><input type="email" name="email" placeholder="you@example.com" required /></div>
                  <div className="field-group"><label>Password</label><PasswordField id="password" /></div>
                  <button type="submit" className="btn-primary">Sign In →</button>
                </form>
              ) : (
                <form className="auth-form" onSubmit={handleEmailRegister} autoComplete="off">
                  <div className="field-group"><label>Full Name</label><input type="text" name="name" placeholder="Your name" /></div>
                  <div className="field-group"><label>Email</label><input type="email" name="email" placeholder="you@example.com" required /></div>
                  <div className="field-group"><label>Password</label><PasswordField id="password" placeholder="Min 6 characters" /></div>
                  <button type="submit" className="btn-primary">Create Account →</button>
                </form>
              )}
            </div>
          )}

          {/* ── PHONE TAB ── */}
          {activeTab === 'phone' && (
            <div>
              <div className="subtoggle">
                <button className={`stab ${isLogin ? 'active' : ''}`} onClick={() => { setIsLogin(true); setToast({ ...toast, show: false }); }}>Sign In</button>
                <button className={`stab ${!isLogin ? 'active' : ''}`} onClick={() => { setIsLogin(false); setToast({ ...toast, show: false }); }}>Create Account</button>
              </div>
              {isLogin ? (
                <form className="auth-form" onSubmit={handlePhoneLogin} autoComplete="off">
                  <div className="field-group"><label>Phone Number</label><input type="tel" name="phone" placeholder="+91 9876543210" required /></div>
                  <div className="field-group"><label>Password</label><PasswordField id="password" /></div>
                  <button type="submit" className="btn-primary">Sign In →</button>
                </form>
              ) : (
                <form className="auth-form" onSubmit={handlePhoneRegister} autoComplete="off">
                  <div className="field-group"><label>Full Name</label><input type="text" name="name" placeholder="Your name" /></div>
                  <div className="field-group"><label>Phone Number</label><input type="tel" name="phone" placeholder="+91 9876543210" required /></div>
                  <div className="field-group"><label>Password</label><PasswordField id="password" placeholder="Min 6 characters" /></div>
                  <button type="submit" className="btn-primary">Create Account →</button>
                </form>
              )}
            </div>
          )}

          {/* ── SOCIAL TAB ── */}
          {activeTab === 'oauth' && (
            <div>
              <p className="oauth-hint">Sign in with your existing account — no password needed.</p>
              <a className="btn-oauth google" onClick={() => { window.location.href = API.replace('/api', '') + '/api/auth/google'; }}>
                <svg viewBox="0 0 48 48" width="20" height="20"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                Continue with Google
              </a>
              <a className="btn-oauth github" onClick={() => { window.location.href = API.replace('/api', '') + '/api/auth/github'; }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                Continue with GitHub
              </a>
              <div className="oauth-note"><span>🔐 OAuth requires Google/GitHub app setup in <code>.env</code></span></div>
            </div>
          )}

          {/* Toast */}
          {toast.show && (
            <div className={`auth-toast ${toast.isError ? 'err' : 'ok'}`}>{toast.msg}</div>
          )}
        </div>

        <p className="footer-note">🔒 Your notes are private. Only you can see them.</p>
      </div>
    </>
  );
}
