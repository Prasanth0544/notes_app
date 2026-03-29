/**
 * Helper utilities
 */

function formatUser(doc) {
  return {
    id:             String(doc._id),
    email:          doc.email || '',
    phone:          doc.phone || '',
    name:           doc.name || '',
    username:       doc.username || '',
    age:            doc.age || '',
    role:           doc.role || '',
    avatar:         doc.avatar || '',
    auth_providers: doc.auth_providers || ['email'],
    profile_done:   doc.profile_done || false,
  };
}

function formatNote(doc) {
  return {
    id:       String(doc._id),
    title:    doc.title || 'Untitled Note',
    content:  doc.content || '',
    tags:     doc.tags || [],
    created:  doc.created || 0,
    modified: doc.modified || 0,
  };
}

function nowMs() {
  return Date.now();
}

module.exports = { formatUser, formatNote, nowMs };
