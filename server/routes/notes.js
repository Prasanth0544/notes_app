/**
 * Notes CRUD Routes
 * Supports: folders, soft-delete (trash with 7-day auto-purge)
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { authMiddleware } = require('../middleware/auth');
const { formatNote, nowMs } = require('../utils/helpers');
const sanitizeHtml = require('sanitize-html');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Sanitization config: allow rich formatting, strip scripts/iframes
const SANITIZE_OPTS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img', 'h1', 'h2', 'h3', 'mark', 'sup', 'sub', 'u', 's',
    'span', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'hr', 'br', 'pre', 'code', 'blockquote', 'font'
  ]),
  allowedAttributes: {
    '*': ['style', 'class', 'id'],
    'a': ['href', 'target', 'rel'],
    'img': ['src', 'alt', 'width', 'height'],
    'font': ['size', 'color', 'face'],
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'data', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
};

function cleanContent(html) {
  if (!html) return '';
  return sanitizeHtml(html, SANITIZE_OPTS);
}

module.exports = function (db) {
  const notes = db.collection('notes');

  // ── Helper: auto-purge notes trashed > 7 days ─────
  async function autoPurgeTrash(userId) {
    const cutoff = nowMs() - SEVEN_DAYS_MS;
    await notes.deleteMany({
      user_id: userId,
      deleted_at: { $lte: cutoff },
    });
  }

  // ── List notes (exclude trashed) ──────────────────
  router.get('/', authMiddleware, async (req, res) => {
    try {
      // Auto-purge expired trash on each list request
      await autoPurgeTrash(req.userId);

      const q = (req.query.q || '').trim();
      const folder = (req.query.folder || '').trim();
      const query = { user_id: req.userId, deleted_at: { $exists: false } };
      if (q) {
        query.$or = [
          { title: { $regex: q, $options: 'i' } },
          { tags:  { $regex: q, $options: 'i' } },
        ];
      }
      if (folder) {
        query.folder = folder;
      }
      const projection = { title: 1, tags: 1, created: 1, modified: 1, user_id: 1, folder: 1, pinned: 1 };
      const docs = await notes.find(query, { projection }).sort({ pinned: -1, modified: -1 }).toArray();
      const results = docs.map(d => ({
        id:       String(d._id),
        title:    d.title || 'Untitled Note',
        content:  '',
        tags:     d.tags || [],
        folder:   d.folder || '',
        pinned:   d.pinned || false,
        created:  d.created || 0,
        modified: d.modified || 0,
      }));
      res.json(results);
    } catch (err) {
      console.error('List notes error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── List trashed notes ────────────────────────────
  router.get('/trash', authMiddleware, async (req, res) => {
    try {
      await autoPurgeTrash(req.userId);

      const docs = await notes.find(
        { user_id: req.userId, deleted_at: { $exists: true } },
        { projection: { title: 1, tags: 1, created: 1, modified: 1, deleted_at: 1, folder: 1 } }
      ).sort({ deleted_at: -1 }).toArray();

      const results = docs.map(d => ({
        id:         String(d._id),
        title:      d.title || 'Untitled Note',
        content:    '',
        tags:       d.tags || [],
        folder:     d.folder || '',
        created:    d.created || 0,
        modified:   d.modified || 0,
        deleted_at: d.deleted_at,
      }));
      res.json(results);
    } catch (err) {
      console.error('List trash error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  const userFolders = db.collection('user_folders');

  // ── List folders ──────────────────────────────────
  router.get('/folders', authMiddleware, async (req, res) => {
    try {
      const docs = await userFolders.find({ user_id: req.userId }).sort({ name: 1 }).toArray();
      res.json(docs.map(d => d.name));
    } catch (err) {
      console.error('List folders error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Create folder ─────────────────────────────────
  router.post('/folders', authMiddleware, async (req, res) => {
    try {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Folder name required' });
      // Check if already exists
      const existing = await userFolders.findOne({ user_id: req.userId, name });
      if (existing) return res.status(409).json({ error: 'Folder already exists' });
      await userFolders.insertOne({ user_id: req.userId, name, created: nowMs() });
      res.status(201).json({ ok: true, name });
    } catch (err) {
      console.error('Create folder error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Delete folder (trash all notes inside + remove folder) ─
  router.delete('/folders/:name', authMiddleware, async (req, res) => {
    try {
      const folderName = decodeURIComponent(req.params.name);
      // Soft-delete (trash) all notes in this folder
      await notes.updateMany(
        { user_id: req.userId, folder: folderName, deleted_at: null },
        { $set: { deleted_at: new Date().toISOString(), folder: '' } }
      );
      await userFolders.deleteOne({ user_id: req.userId, name: folderName });
      res.json({ ok: true, folder: folderName });
    } catch (err) {
      console.error('Delete folder error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Rename folder ─────────────────────────────────
  router.put('/folders/:name/rename', authMiddleware, async (req, res) => {
    try {
      const oldName = decodeURIComponent(req.params.name);
      const newName = (req.body.newName || '').trim();
      if (!newName) return res.status(400).json({ error: 'New folder name required' });
      if (oldName === newName) return res.json({ ok: true, name: newName });
      // Check if new name already exists
      const existing = await userFolders.findOne({ user_id: req.userId, name: newName });
      if (existing) return res.status(409).json({ error: `Folder "${newName}" already exists` });
      // Rename the folder
      await userFolders.updateOne(
        { user_id: req.userId, name: oldName },
        { $set: { name: newName } }
      );
      // Update all notes in this folder
      await notes.updateMany(
        { user_id: req.userId, folder: oldName },
        { $set: { folder: newName } }
      );
      res.json({ ok: true, oldName, newName });
    } catch (err) {
      console.error('Rename folder error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Get single note ───────────────────────────────
  router.get('/:id', authMiddleware, async (req, res) => {
    try {
      const doc = await notes.findOne({ _id: new ObjectId(req.params.id), user_id: req.userId });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      const note = formatNote(doc);
      note.folder = doc.folder || '';
      note.deleted_at = doc.deleted_at || null;
      res.json(note);
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  // ── Create note ───────────────────────────────────
  router.post('/', authMiddleware, async (req, res) => {
    try {
      let title = req.body.title || 'Untitled Note';
      const folder = req.body.folder || '';
      
      // Generate sequential untitled names
      if (title === 'Untitled Note' || title === 'Untitled') {
        let nextNum = 1;
        let isUnique = false;
        
        while (!isUnique) {
          const candidateTitle = `Untitled ${nextNum}`;
          const existing = await notes.findOne({ user_id: req.userId, title: candidateTitle, deleted_at: { $exists: false } });
          if (!existing) {
            title = candidateTitle;
            isUnique = true;
          } else {
            nextNum++;
          }
        }
      } else {
        const existing = await notes.findOne({ user_id: req.userId, title: title, deleted_at: { $exists: false } });
        if (existing) {
          return res.status(409).json({ error: `Chat name "${title}" already exists` });
        }
      }
      
      const ts = nowMs();
      const doc = {
        user_id:  req.userId,
        title:    title,
        content:  cleanContent(req.body.content || ''),
        tags:     req.body.tags || [],
        folder:   folder,
        created:  ts,
        modified: ts,
      };
      const result = await notes.insertOne(doc);
      doc._id = result.insertedId;
      const note = formatNote(doc);
      note.folder = doc.folder;
      res.status(201).json(note);
    } catch (err) {
      console.error('Create note error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Update note ───────────────────────────────────
  router.put('/:id', authMiddleware, async (req, res) => {
    try {
      const title = req.body.title || 'Untitled Note';
      const noteId = new ObjectId(req.params.id);
      
      const existing = await notes.findOne({ user_id: req.userId, title: title, _id: { $ne: noteId }, deleted_at: { $exists: false } });
      if (existing) {
        return res.status(409).json({ error: `Chat name "${title}" already exists` });
      }
      
      const ts = nowMs();
      const updateFields = {
        title:    title,
        content:  cleanContent(req.body.content || ''),
        tags:     req.body.tags || [],
        modified: ts,
      };
      // Only update folder if it's provided in the request
      if (req.body.folder !== undefined) {
        updateFields.folder = req.body.folder;
      }
      
      const result = await notes.findOneAndUpdate(
        { _id: noteId, user_id: req.userId },
        { $set: updateFields },
        { returnDocument: 'after' }
      );
      if (!result) return res.status(404).json({ error: 'Not found' });
      const note = formatNote(result);
      note.folder = result.folder || '';
      res.json(note);
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  // ── Toggle pin on note ─────────────────────────
  router.post('/:id/pin', authMiddleware, async (req, res) => {
    try {
      const doc = await notes.findOne({ _id: new ObjectId(req.params.id), user_id: req.userId });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      const newPinned = !doc.pinned;
      await notes.updateOne(
        { _id: doc._id },
        { $set: { pinned: newPinned } }
      );
      res.json({ ok: true, pinned: newPinned });
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  // ── Soft-delete note (move to trash) ──────────────
  router.delete('/:id', authMiddleware, async (req, res) => {
    try {
      const result = await notes.findOneAndUpdate(
        { _id: new ObjectId(req.params.id), user_id: req.userId, deleted_at: { $exists: false } },
        { $set: { deleted_at: nowMs() } },
        { returnDocument: 'after' }
      );
      if (!result) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true, trashed: true });
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  // ── Restore note from trash ───────────────────────
  router.post('/:id/restore', authMiddleware, async (req, res) => {
    try {
      const result = await notes.findOneAndUpdate(
        { _id: new ObjectId(req.params.id), user_id: req.userId, deleted_at: { $exists: true } },
        { $unset: { deleted_at: '' } },
        { returnDocument: 'after' }
      );
      if (!result) return res.status(404).json({ error: 'Not found in trash' });
      const note = formatNote(result);
      note.folder = result.folder || '';
      res.json({ ok: true, note });
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  // ── Permanent delete (from trash only) ────────────
  router.delete('/:id/permanent', authMiddleware, async (req, res) => {
    try {
      const result = await notes.deleteOne({
        _id: new ObjectId(req.params.id),
        user_id: req.userId,
        deleted_at: { $exists: true },
      });
      res.json({ ok: true, deleted: result.deletedCount });
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  return router;
};
