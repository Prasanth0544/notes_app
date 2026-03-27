"""
NoteVault – Flask + MongoDB Atlas + JWT Auth Backend
=====================================================
Supports: Email/Password, Google OAuth, GitHub OAuth, Phone+Password
Run:  python server.py
API:  http://localhost:5000
"""

import os
import base64
import uuid
import requests as http_req
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from flask import Flask, request, jsonify, send_from_directory, send_file, redirect
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity
)
from pymongo import MongoClient
from bson import ObjectId
import bcrypt
import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv

# ── Load .env ────────────────────────────────────────────────────
load_dotenv()

MONGO_URI         = os.getenv('MONGO_URI')
JWT_SECRET_KEY    = os.getenv('JWT_SECRET_KEY', 'fallback-change-me')
GOOGLE_CLIENT_ID  = os.getenv('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SEC = os.getenv('GOOGLE_CLIENT_SECRET', '')
GITHUB_CLIENT_ID  = os.getenv('GITHUB_CLIENT_ID', '')
GITHUB_CLIENT_SEC = os.getenv('GITHUB_CLIENT_SECRET', '')
APP_URL           = os.getenv('APP_URL', 'http://localhost:5000')
PORT              = int(os.getenv('PORT', '5000'))
ALLOWED_ORIGINS   = os.getenv('ALLOWED_ORIGINS', '*')  # comma-separated in prod

# Cloudinary
CLOUDINARY_CLOUD  = os.getenv('CLOUDINARY_CLOUD_NAME', '')
CLOUDINARY_KEY    = os.getenv('CLOUDINARY_API_KEY', '')
CLOUDINARY_SECRET = os.getenv('CLOUDINARY_API_SECRET', '')

if not MONGO_URI:
    print('  ⚠️  MONGO_URI not set in .env – cannot start.')
    exit(1)

# ── Config ───────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR  = BASE_DIR
ALLOWED_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'}

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
app.config['JWT_SECRET_KEY']            = JWT_SECRET_KEY
app.config['JWT_ACCESS_TOKEN_EXPIRES']  = timedelta(days=30)

cors_origins = ALLOWED_ORIGINS if ALLOWED_ORIGINS == '*' else [o.strip() for o in ALLOWED_ORIGINS.split(',')]
CORS(app, origins=cors_origins, supports_credentials=True)
jwt = JWTManager(app)

# ── MongoDB ───────────────────────────────────────────────────────
client     = MongoClient(MONGO_URI)
db         = client['notevault']
users_col  = db['users']
notes_col  = db['notes']

users_col.create_index('email',  unique=True, sparse=True)
users_col.create_index('phone',  unique=True, sparse=True)
users_col.create_index('oauth_id', sparse=True)
notes_col.create_index([('user_id', 1), ('modified', -1)])

print('  ✅ Connected to MongoDB Atlas – database: notevault')

# ── Cloudinary ────────────────────────────────────────────────────
if CLOUDINARY_CLOUD and CLOUDINARY_KEY and CLOUDINARY_SECRET:
    cloudinary.config(
        cloud_name  = CLOUDINARY_CLOUD,
        api_key     = CLOUDINARY_KEY,
        api_secret  = CLOUDINARY_SECRET,
        secure      = True,
    )
    print('  ✅ Cloudinary configured')
else:
    print('  ⚠️  Cloudinary not configured – images will use base64 fallback')


# ── Helpers ───────────────────────────────────────────────────────
def now_ms():
    return int(datetime.now(timezone.utc).timestamp() * 1000)

def make_token(user_id, extra=None):
    claims = extra or {}
    return create_access_token(identity=str(user_id), additional_claims=claims)

def user_to_dict(doc):
    return {
        'id':             str(doc['_id']),
        'email':          doc.get('email', ''),
        'phone':          doc.get('phone', ''),
        'name':           doc.get('name', ''),
        'username':       doc.get('username', ''),
        'age':            doc.get('age', ''),
        'role':           doc.get('role', ''),
        'avatar':         doc.get('avatar', ''),
        'auth_providers': doc.get('auth_providers', ['email']),
        'profile_done':   doc.get('profile_done', False),
    }

def note_to_dict(doc):
    return {
        'id':       str(doc['_id']),
        'title':    doc.get('title', 'Untitled Note'),
        'content':  doc.get('content', ''),
        'tags':     doc.get('tags', []),
        'created':  doc.get('created', 0),
        'modified': doc.get('modified', 0),
    }

def find_or_create_oauth_user(email, name, avatar, provider, oauth_id):
    """Find existing user by email or oauth_id, or create new one."""
    user = users_col.find_one({'email': email}) if email else None
    if not user:
        user = users_col.find_one({'oauth_id': oauth_id})
    if user:
        # Merge provider if not already there
        if provider not in user.get('auth_providers', []):
            users_col.update_one({'_id': user['_id']}, {
                '$addToSet': {'auth_providers': provider},
                '$set': {'avatar': avatar or user.get('avatar', ''), 'name': name or user.get('name', '')}
            })
        user = users_col.find_one({'_id': user['_id']})
        return user, False  # existing
    # Create new user
    doc = {
        'email':          email or '',
        'oauth_id':       oauth_id,
        'name':           name or '',
        'username':       '',
        'age':            '',
        'role':           '',
        'avatar':         avatar or '',
        'auth_providers': [provider],
        'profile_done':   False,
        'created_at':     datetime.now(timezone.utc),
    }
    result = users_col.insert_one(doc)
    doc['_id'] = result.inserted_id
    return doc, True  # new user


# ════════════════════════════════════════════════════════════════
#  STATIC SERVING
# ════════════════════════════════════════════════════════════════

@app.route('/login.html')
def serve_login():
    return send_file(os.path.join(STATIC_DIR, 'login.html'))

@app.route('/profile-setup.html')
def serve_profile_setup():
    return send_file(os.path.join(STATIC_DIR, 'profile-setup.html'))

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    if path and os.path.exists(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    return send_file(os.path.join(STATIC_DIR, 'index.html'))


# ════════════════════════════════════════════════════════════════
#  AUTH – EMAIL / PASSWORD
# ════════════════════════════════════════════════════════════════

@app.route('/api/auth/register', methods=['POST'])
def register():
    data     = request.get_json(force=True)
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')
    name     = data.get('name', '').strip()

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    if users_col.find_one({'email': email}):
        return jsonify({'error': 'An account with this email already exists'}), 409

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    doc = {
        'email':          email,
        'password_hash':  pw_hash,
        'name':           name or email.split('@')[0],
        'username':       '',
        'age':            '',
        'role':           '',
        'avatar':         '',
        'auth_providers': ['email'],
        'profile_done':   False,
        'created_at':     datetime.now(timezone.utc),
    }
    result = users_col.insert_one(doc)
    doc['_id'] = result.inserted_id
    token = make_token(doc['_id'])
    return jsonify({'token': token, 'user': user_to_dict(doc)}), 201


@app.route('/api/auth/login', methods=['POST'])
def login():
    data     = request.get_json(force=True)
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    user = users_col.find_one({'email': email})
    if not user or 'password_hash' not in user:
        return jsonify({'error': 'Invalid email or password'}), 401

    if not bcrypt.checkpw(password.encode(), user['password_hash']):
        return jsonify({'error': 'Invalid email or password'}), 401

    token = make_token(user['_id'])
    return jsonify({'token': token, 'user': user_to_dict(user)})


# ── Phone + Password ─────────────────────────────────────────────

@app.route('/api/auth/register/phone', methods=['POST'])
def register_phone():
    data     = request.get_json(force=True)
    phone    = data.get('phone', '').strip()
    password = data.get('password', '')
    name     = data.get('name', '').strip()

    if not phone or not password:
        return jsonify({'error': 'Phone and password are required'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    if users_col.find_one({'phone': phone}):
        return jsonify({'error': 'An account with this phone already exists'}), 409

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    doc = {
        'email':          '',
        'phone':          phone,
        'password_hash':  pw_hash,
        'name':           name or f'User {phone[-4:]}',
        'username':       '',
        'age':            '',
        'role':           '',
        'avatar':         '',
        'auth_providers': ['phone'],
        'profile_done':   False,
        'created_at':     datetime.now(timezone.utc),
    }
    result = users_col.insert_one(doc)
    doc['_id'] = result.inserted_id
    token = make_token(doc['_id'])
    return jsonify({'token': token, 'user': user_to_dict(doc)}), 201


@app.route('/api/auth/login/phone', methods=['POST'])
def login_phone():
    data     = request.get_json(force=True)
    phone    = data.get('phone', '').strip()
    password = data.get('password', '')

    user = users_col.find_one({'phone': phone})
    if not user or 'password_hash' not in user:
        return jsonify({'error': 'Invalid phone or password'}), 401

    if not bcrypt.checkpw(password.encode(), user['password_hash']):
        return jsonify({'error': 'Invalid phone or password'}), 401

    token = make_token(user['_id'])
    return jsonify({'token': token, 'user': user_to_dict(user)})


# ── Google OAuth ─────────────────────────────────────────────────

@app.route('/api/auth/google')
def google_oauth_start():
    if not GOOGLE_CLIENT_ID:
        return jsonify({'error': 'Google OAuth not configured'}), 501
    params = {
        'client_id':     GOOGLE_CLIENT_ID,
        'redirect_uri':  f'{APP_URL}/api/auth/google/callback',
        'response_type': 'code',
        'scope':         'openid email profile',
        'access_type':   'online',
    }
    return redirect(f'https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}')


@app.route('/api/auth/google/callback')
def google_oauth_callback():
    code = request.args.get('code')
    if not code:
        return redirect(f'/login.html?error=google_denied')

    # Exchange code for token
    token_resp = http_req.post('https://oauth2.googleapis.com/token', data={
        'code':          code,
        'client_id':     GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SEC,
        'redirect_uri':  f'{APP_URL}/api/auth/google/callback',
        'grant_type':    'authorization_code',
    }).json()

    id_token = token_resp.get('id_token')
    if not id_token:
        return redirect(f'/login.html?error=google_failed')

    # Decode ID token (without verify for simplicity – use google-auth lib in prod)
    import json
    parts = id_token.split('.')
    payload_bytes = parts[1] + '=' * (4 - len(parts[1]) % 4)
    payload = json.loads(base64.b64decode(payload_bytes))

    email    = payload.get('email', '')
    name     = payload.get('name', '')
    avatar   = payload.get('picture', '')
    oauth_id = payload.get('sub', '')

    user, is_new = find_or_create_oauth_user(email, name, avatar, 'google', oauth_id)
    token = make_token(user['_id'])
    next_page = 'profile-setup.html' if not user.get('profile_done') else 'index.html'
    return redirect(f'/{next_page}?token={token}')


# ── GitHub OAuth ────────────────────────────────────────────────

@app.route('/api/auth/github')
def github_oauth_start():
    if not GITHUB_CLIENT_ID:
        return jsonify({'error': 'GitHub OAuth not configured'}), 501
    params = {
        'client_id':    GITHUB_CLIENT_ID,
        'redirect_uri': f'{APP_URL}/api/auth/github/callback',
        'scope':        'user:email',
    }
    return redirect(f'https://github.com/login/oauth/authorize?{urlencode(params)}')


@app.route('/api/auth/github/callback')
def github_oauth_callback():
    code = request.args.get('code')
    if not code:
        return redirect(f'/login.html?error=github_denied')

    token_resp = http_req.post(
        'https://github.com/login/oauth/access_token',
        data={'client_id': GITHUB_CLIENT_ID, 'client_secret': GITHUB_CLIENT_SEC, 'code': code},
        headers={'Accept': 'application/json'}
    ).json()

    access_token = token_resp.get('access_token')
    if not access_token:
        return redirect(f'/login.html?error=github_failed')

    # Get user info
    gh_headers = {'Authorization': f'token {access_token}', 'Accept': 'application/json'}
    user_info  = http_req.get('https://api.github.com/user', headers=gh_headers).json()
    emails     = http_req.get('https://api.github.com/user/emails', headers=gh_headers).json()

    email    = next((e['email'] for e in emails if e.get('primary') and e.get('verified')), '')
    name     = user_info.get('name') or user_info.get('login', '')
    avatar   = user_info.get('avatar_url', '')
    oauth_id = str(user_info.get('id', ''))

    user, is_new = find_or_create_oauth_user(email, name, avatar, 'github', oauth_id)
    token = make_token(user['_id'])
    next_page = 'profile-setup.html' if not user.get('profile_done') else 'index.html'
    return redirect(f'/{next_page}?token={token}')


# ════════════════════════════════════════════════════════════════
#  PROFILE
# ════════════════════════════════════════════════════════════════

@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def get_me():
    user_id = get_jwt_identity()
    user = users_col.find_one({'_id': ObjectId(user_id)})
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify(user_to_dict(user))


@app.route('/api/auth/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    data = request.get_json(force=True)

    updates = {
        'username':     data.get('username', '').strip(),
        'age':          data.get('age', '').strip() if isinstance(data.get('age'), str) else str(data.get('age', '')),
        'role':         data.get('role', '').strip(),
        'name':         data.get('name', '').strip(),
        'profile_done': True,
    }
    updates = {k: v for k, v in updates.items() if v}
    updates['profile_done'] = True

    # Handle backup password (for OAuth users who want email+password login)
    backup_pw = data.get('backup_password', '').strip()
    if backup_pw and len(backup_pw) >= 6:
        updates['password_hash'] = bcrypt.hashpw(backup_pw.encode(), bcrypt.gensalt())
        # Ensure 'email' is in auth_providers so they can use email+password login
        users_col.update_one(
            {'_id': ObjectId(user_id)},
            {'$addToSet': {'auth_providers': 'email'}}
        )

    users_col.update_one({'_id': ObjectId(user_id)}, {'$set': updates})
    user = users_col.find_one({'_id': ObjectId(user_id)})
    return jsonify(user_to_dict(user))


# ════════════════════════════════════════════════════════════════
#  NOTES API  (all require JWT)
# ════════════════════════════════════════════════════════════════

@app.route('/api/notes', methods=['GET'])
@jwt_required()
def list_notes():
    user_id = get_jwt_identity()
    q = request.args.get('q', '').strip()
    query = {'user_id': user_id}
    if q:
        query['$or'] = [
            {'title':   {'$regex': q, '$options': 'i'}},
            {'tags':    {'$regex': q, '$options': 'i'}},
        ]
    # Only fetch lightweight fields for the list — skip full content (can be MBs with images)
    projection = {'title': 1, 'tags': 1, 'created': 1, 'modified': 1, 'user_id': 1}
    docs = notes_col.find(query, projection).sort('modified', -1)
    results = []
    for d in docs:
        results.append({
            'id':       str(d['_id']),
            'title':    d.get('title', 'Untitled Note'),
            'content':  '',  # Don't send full content in list view
            'tags':     d.get('tags', []),
            'created':  d.get('created', 0),
            'modified': d.get('modified', 0),
        })
    return jsonify(results)


@app.route('/api/notes/<note_id>', methods=['GET'])
@jwt_required()
def get_note(note_id):
    user_id = get_jwt_identity()
    try:
        doc = notes_col.find_one({'_id': ObjectId(note_id), 'user_id': user_id})
    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400
    if not doc:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(note_to_dict(doc))


@app.route('/api/notes', methods=['POST'])
@jwt_required()
def create_note():
    user_id = get_jwt_identity()
    data = request.get_json(force=True)
    ts = now_ms()
    doc = {
        'user_id':  user_id,
        'title':    data.get('title', 'Untitled Note'),
        'content':  data.get('content', ''),
        'tags':     data.get('tags', []),
        'created':  ts,
        'modified': ts,
    }
    result = notes_col.insert_one(doc)
    doc['_id'] = result.inserted_id
    return jsonify(note_to_dict(doc)), 201


@app.route('/api/notes/<note_id>', methods=['PUT'])
@jwt_required()
def update_note(note_id):
    user_id = get_jwt_identity()
    data = request.get_json(force=True)
    ts = now_ms()
    try:
        result = notes_col.find_one_and_update(
            {'_id': ObjectId(note_id), 'user_id': user_id},
            {'$set': {
                'title':    data.get('title', 'Untitled Note'),
                'content':  data.get('content', ''),
                'tags':     data.get('tags', []),
                'modified': ts,
            }},
            return_document=True
        )
    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400
    if not result:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(note_to_dict(result))


@app.route('/api/notes/<note_id>', methods=['DELETE'])
@jwt_required()
def delete_note(note_id):
    user_id = get_jwt_identity()
    try:
        result = notes_col.delete_one({'_id': ObjectId(note_id), 'user_id': user_id})
    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400
    return jsonify({'ok': True, 'deleted': result.deleted_count})


# ── Image Upload (Cloudinary or Base64 fallback) ─────────────────

@app.route('/api/images', methods=['POST'])
@jwt_required()
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    f   = request.files['file']
    ext = f.filename.rsplit('.', 1)[-1].lower() if '.' in f.filename else 'png'
    if ext not in ALLOWED_EXT:
        return jsonify({'error': 'File type not allowed'}), 400

    # ── Cloudinary upload (production) ──
    if CLOUDINARY_CLOUD and CLOUDINARY_KEY:
        try:
            user_id = get_jwt_identity()
            result = cloudinary.uploader.upload(
                f,
                folder=f'notevault/{user_id}',
                public_id=f'{uuid.uuid4().hex[:12]}',
                resource_type='image',
                overwrite=False,
            )
            return jsonify({
                'url':     result['secure_url'],
                'name':    f.filename or 'image.png',
                'note_id': request.form.get('note_id', 'inline'),
            }), 201
        except Exception as e:
            return jsonify({'error': f'Cloudinary upload failed: {str(e)}'}), 500

    # ── Base64 fallback (local dev without Cloudinary) ──
    mime_map = {
        'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
        'svg': 'image/svg+xml',
    }
    mime = mime_map.get(ext, 'image/png')
    b64  = base64.b64encode(f.read()).decode()
    return jsonify({
        'url':     f'data:{mime};base64,{b64}',
        'name':    f.filename or 'image.png',
        'note_id': request.form.get('note_id', 'inline'),
    }), 201

# ── Sync API (for mobile app) ─────────────────────────────────
@app.route('/api/sync/pull', methods=['POST'])
@jwt_required()
def sync_pull():
    """Mobile → pull all notes modified after a given timestamp."""
    uid   = get_jwt_identity()
    since = request.json.get('since', 0)  # epoch ms
    docs  = list(notes_col.find({
        'user_id': uid,
        'modified': {'$gt': since}
    }).sort('modified', -1))
    return jsonify([{
        'id':       str(d['_id']),
        'title':    d.get('title', ''),
        'content':  d.get('content', ''),
        'tags':     d.get('tags', []),
        'created':  d.get('created', 0),
        'modified': d.get('modified', 0),
    } for d in docs])


@app.route('/api/sync/push', methods=['POST'])
@jwt_required()
def sync_push():
    """Mobile → push an array of locally-changed notes to Atlas."""
    uid   = get_jwt_identity()
    notes = request.json.get('notes', [])
    results = []
    for n in notes:
        cloud_id = n.get('cloud_id')  # Atlas _id if previously synced
        now_ms   = n.get('modified', int(datetime.now(timezone.utc).timestamp() * 1000))
        doc_data = {
            'user_id':  uid,
            'title':    n.get('title', 'Untitled Note'),
            'content':  n.get('content', ''),
            'tags':     n.get('tags', []),
            'created':  n.get('created', now_ms),
            'modified': now_ms,
        }
        if cloud_id:
            # Update existing note
            notes_col.update_one(
                {'_id': ObjectId(cloud_id), 'user_id': uid},
                {'$set': doc_data},
                upsert=True
            )
            results.append({'local_id': n.get('local_id'), 'cloud_id': cloud_id, 'status': 'updated'})
        else:
            # Insert new note
            r = notes_col.insert_one(doc_data)
            results.append({'local_id': n.get('local_id'), 'cloud_id': str(r.inserted_id), 'status': 'created'})
    return jsonify({'synced': len(results), 'results': results})


@app.route('/api/sync/delete', methods=['POST'])
@jwt_required()
def sync_delete():
    """Mobile → delete notes from Atlas that were deleted locally."""
    uid = get_jwt_identity()
    ids = request.json.get('ids', [])
    deleted = 0
    for cid in ids:
        try:
            r = notes_col.delete_one({'_id': ObjectId(cid), 'user_id': uid})
            deleted += r.deleted_count
        except Exception:
            pass
    return jsonify({'deleted': deleted})


# ── Run ───────────────────────────────────────────────────────────
if __name__ == '__main__':
    print()
    print('  ╔══════════════════════════════════════════════╗')
    print('  ║   NoteVault Server – running!                ║')
    print(f'  ║   Open: http://localhost:{PORT:<19}║')
    print('  ║   Auth: Email · Phone · Google · GitHub     ║')
    print('  ║   DB:   MongoDB Atlas (notevault)           ║')
    print('  ╚══════════════════════════════════════════════╝')
    print()
    app.run(host='0.0.0.0', port=PORT, debug=False)
