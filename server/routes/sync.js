/**
 * Mobile Sync Routes
 * Replaces server.py lines 573–639
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { authMiddleware } = require('../middleware/auth');

module.exports = function (db) {
  const notes = db.collection('notes');

  // ── Pull: get notes modified after a timestamp ─────
  router.post('/pull', authMiddleware, async (req, res) => {
    try {
      const since = req.body.since || 0;
      const docs = await notes.find({
        user_id: req.userId,
        modified: { $gt: since },
      }).sort({ modified: -1 }).toArray();

      res.json(docs.map(d => ({
        id:       String(d._id),
        title:    d.title || '',
        content:  d.content || '',
        tags:     d.tags || [],
        created:  d.created || 0,
        modified: d.modified || 0,
      })));
    } catch (err) {
      console.error('Sync pull error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Push: upsert array of local notes ──────────────
  router.post('/push', authMiddleware, async (req, res) => {
    try {
      const notesList = req.body.notes || [];
      const results = [];

      for (const n of notesList) {
        const cloudId = n.cloud_id;
        const ts = n.modified || Date.now();
        const docData = {
          user_id:  req.userId,
          title:    n.title || 'Untitled Note',
          content:  n.content || '',
          tags:     n.tags || [],
          created:  n.created || ts,
          modified: ts,
        };

        if (cloudId) {
          await notes.updateOne(
            { _id: new ObjectId(cloudId), user_id: req.userId },
            { $set: docData },
            { upsert: true }
          );
          results.push({ local_id: n.local_id, cloud_id: cloudId, status: 'updated' });
        } else {
          const r = await notes.insertOne(docData);
          results.push({ local_id: n.local_id, cloud_id: String(r.insertedId), status: 'created' });
        }
      }

      res.json({ synced: results.length, results });
    } catch (err) {
      console.error('Sync push error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Delete: remove notes from Atlas ────────────────
  router.post('/delete', authMiddleware, async (req, res) => {
    try {
      const ids = req.body.ids || [];
      let deleted = 0;
      for (const cid of ids) {
        try {
          const r = await notes.deleteOne({ _id: new ObjectId(cid), user_id: req.userId });
          deleted += r.deletedCount;
        } catch {}
      }
      res.json({ deleted });
    } catch (err) {
      console.error('Sync delete error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};
