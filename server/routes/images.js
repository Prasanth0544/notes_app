/**
 * Image Upload Route (Cloudinary or Base64 fallback)
 * Replaces server.py lines 529–570
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

module.exports = function () {
  router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file' });

      const ext = (req.file.originalname || '').split('.').pop().toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'File type not allowed' });

      const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
      const CLOUD_KEY  = process.env.CLOUDINARY_API_KEY;

      // ── Cloudinary upload ──
      if (CLOUD_NAME && CLOUD_KEY) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: `notevault/${req.userId}`,
              public_id: require('crypto').randomUUID().replace(/-/g, '').slice(0, 12),
              resource_type: 'image',
              overwrite: false,
            },
            (err, result) => err ? reject(err) : resolve(result)
          );
          stream.end(req.file.buffer);
        });

        return res.status(201).json({
          url:     result.secure_url,
          name:    req.file.originalname || 'image.png',
          note_id: req.body.note_id || 'inline',
        });
      }

      // ── Base64 fallback ──
      const mimeMap = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        svg: 'image/svg+xml',
      };
      const mime = mimeMap[ext] || 'image/png';
      const b64 = req.file.buffer.toString('base64');
      res.status(201).json({
        url:     `data:${mime};base64,${b64}`,
        name:    req.file.originalname || 'image.png',
        note_id: req.body.note_id || 'inline',
      });
    } catch (err) {
      console.error('Image upload error:', err);
      res.status(500).json({ error: `Upload failed: ${err.message}` });
    }
  });

  return router;
};
