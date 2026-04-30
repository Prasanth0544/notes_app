import { useState } from 'react';

export default function ProfileModal({ user, onClose, onSave, onLinkPhone, onChangePassword, getToken, API }) {
  const [profileForm, setProfileForm] = useState({
    name: user.name || '', username: user.username || '', age: user.age || '', role: user.role || ''
  });
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [pwForm, setPwForm] = useState({ old_password: '', new_password: '' });

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal-box" onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', color: 'var(--fg)', fontSize: '1.1rem' }}>✏️ Edit Profile</h3>

        {/* Avatar + Email (read-only) */}
        <div className="profile-header-strip">
          <div className="profile-avatar-lg">
            {user.avatar ? <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (user.name || user.email || 'U').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ color: 'var(--fg)', fontSize: '.85rem', fontWeight: 600 }}>{user.email || user.phone || 'No email'}</div>
            <div style={{ color: 'var(--muted)', fontSize: '.7rem' }}>ID: {user.id?.slice(-8) || '—'}</div>
          </div>
        </div>

        {/* Editable fields */}
        {[
          { key: 'name', label: 'Full Name', placeholder: 'John Doe' },
          { key: 'username', label: 'Username', placeholder: 'johndoe' },
          { key: 'age', label: 'Age', placeholder: '25' },
          { key: 'role', label: 'Role / Title', placeholder: 'Developer' },
        ].map(f => (
          <div key={f.key} style={{ marginBottom: 12 }}>
            <label className="profile-field-label">{f.label}</label>
            <input
              type="text"
              value={profileForm[f.key]}
              onChange={e => setProfileForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="profile-field-input"
            />
          </div>
        ))}

        {/* Auth providers */}
        <div style={{ marginBottom: 16 }}>
          <label className="profile-field-label" style={{ marginBottom: 6 }}>Linked Accounts</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {(user.auth_providers || []).map(p => (
              <span key={p} className={`auth-badge auth-badge-${p}`}>
                ✓ {p === 'google' ? '🔵 Google' : p === 'github' ? '⚫ GitHub' : p === 'phone' ? '📱 Phone' : p === 'email' ? '📧 Email' : p}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {!(user.auth_providers || []).includes('google') && (
              <button onClick={() => { const baseUrl = API.replace('/api', ''); window.location.href = `${baseUrl}/api/auth/google?link_token=${getToken()}`; }}
                className="auth-link-btn auth-link-google">🔵 Link Google Account</button>
            )}
            {!(user.auth_providers || []).includes('github') && (
              <button onClick={() => { const baseUrl = API.replace('/api', ''); window.location.href = `${baseUrl}/api/auth/github?link_token=${getToken()}`; }}
                className="auth-link-btn auth-link-github">⚫ Link GitHub Account</button>
            )}
            {!(user.auth_providers || []).includes('phone') && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="tel" placeholder="+91 9876543210" id="linkPhoneInput" className="profile-field-input" style={{ flex: 1 }} />
                <button onClick={() => {
                  const phone = document.getElementById('linkPhoneInput')?.value?.trim();
                  if (phone) onLinkPhone(phone);
                }} className="auth-link-btn auth-link-phone">📱 Link Phone</button>
              </div>
            )}
          </div>
        </div>

        {/* Change Password Section */}
        {user.password_hash && (
          <div style={{ marginBottom: 16 }}>
            <button 
              onClick={() => setShowPasswordChange(!showPasswordChange)}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: '0.9rem', fontWeight: 500 }}
            >
              {showPasswordChange ? '▼ Hide Password Change' : '▶ Change Password'}
            </button>
            
            {showPasswordChange && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div style={{ marginBottom: 8 }}>
                  <label className="profile-field-label">Current Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={pwForm.old_password}
                    onChange={e => setPwForm(prev => ({ ...prev, old_password: e.target.value }))}
                    className="profile-field-input"
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="profile-field-label">New Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={pwForm.new_password}
                    onChange={e => setPwForm(prev => ({ ...prev, new_password: e.target.value }))}
                    className="profile-field-input"
                  />
                </div>
                <button 
                  onClick={() => {
                    onChangePassword(pwForm.old_password, pwForm.new_password);
                    setPwForm({ old_password: '', new_password: '' });
                    setShowPasswordChange(false);
                  }}
                  disabled={!pwForm.old_password || pwForm.new_password.length < 6}
                  className="auth-link-btn" style={{ background: 'var(--accent)', color: 'white', opacity: (!pwForm.old_password || pwForm.new_password.length < 6) ? 0.5 : 1 }}
                >
                  Update Password
                </button>
              </div>
            )}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="profile-btn-cancel">Cancel</button>
          <button onClick={() => onSave(profileForm)} className="profile-btn-save">Save Changes</button>
        </div>
      </div>
    </div>
  );
}
