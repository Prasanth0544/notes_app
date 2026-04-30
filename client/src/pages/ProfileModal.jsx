import { useState } from 'react';

export default function ProfileModal({ user, onClose, onSave, onLinkPhone, getToken, API }) {
  const [profileForm, setProfileForm] = useState({
    name: user.name || '', username: user.username || '', age: user.age || '', role: user.role || ''
  });

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

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="profile-btn-cancel">Cancel</button>
          <button onClick={() => onSave(profileForm)} className="profile-btn-save">Save Changes</button>
        </div>
      </div>
    </div>
  );
}
