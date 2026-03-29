/**
 * Notes CRUD Routes
 * Replaces server.py lines 433–524
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { authMiddleware } = require('../middleware/auth');
const { formatNote, nowMs } = require('../utils/helpers');

module.exports = function (db) {
  const notes = db.collection('notes');

  // ── List notes (lightweight — no content) ──────────
  router.get('/', authMiddleware, async (req, res) => {
    try {
      const q = (req.query.q || '').trim();
      const query = { user_id: req.userId };
      if (q) {
        query.$or = [
          { title: { $regex: q, $options: 'i' } },
          { tags:  { $regex: q, $options: 'i' } },
        ];
      }
      const projection = { title: 1, tags: 1, created: 1, modified: 1, user_id: 1 };
      const docs = await notes.find(query, { projection }).sort({ modified: -1 }).toArray();
      const results = docs.map(d => ({
        id:       String(d._id),
        title:    d.title || 'Untitled Note',
        content:  '',  // Don't send full content in list view
        tags:     d.tags || [],
        created:  d.created || 0,
        modified: d.modified || 0,
      }));
      res.json(results);
    } catch (err) {
      console.error('List notes error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Get single note ────────────────────────────────
  router.get('/:id', authMiddleware, async (req, res) => {
    try {
      const doc = await notes.findOne({ _id: new ObjectId(req.params.id), user_id: req.userId });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      res.json(formatNote(doc));
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  // ── Create note ────────────────────────────────────
  router.post('/', authMiddleware, async (req, res) => {
    try {
      const ts = nowMs();
      const doc = {
        user_id:  req.userId,
        title:    req.body.title || 'Untitled Note',
        content:  req.body.content || '',
        tags:     req.body.tags || [],
        created:  ts,
        modified: ts,
      };
      const result = await notes.insertOne(doc);
      doc._id = result.insertedId;
      res.status(201).json(formatNote(doc));
    } catch (err) {
      console.error('Create note error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Update note ────────────────────────────────────
  router.put('/:id', authMiddleware, async (req, res) => {
    try {
      const ts = nowMs();
      const result = await notes.findOneAndUpdate(
        { _id: new ObjectId(req.params.id), user_id: req.userId },
        { $set: {
          title:    req.body.title || 'Untitled Note',
          content:  req.body.content || '',
          tags:     req.body.tags || [],
          modified: ts,
        }},
        { returnDocument: 'after' }
      );
      if (!result) return res.status(404).json({ error: 'Not found' });
      res.json(formatNote(result));
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  // ── Delete note ────────────────────────────────────
  router.delete('/:id', authMiddleware, async (req, res) => {
    try {
      const result = await notes.deleteOne({ _id: new ObjectId(req.params.id), user_id: req.userId });
      res.json({ ok: true, deleted: result.deletedCount });
    } catch (err) {
      res.status(400).json({ error: 'Invalid ID' });
    }
  });

  return router;
};
