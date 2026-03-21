#!/bin/bash
# ── NoteVault — Oracle Cloud VM Setup Script ──────────────────
# Run this on your OCI Ubuntu VM after SSH-ing in.
# Usage:  chmod +x deploy_oci.sh && ./deploy_oci.sh

set -e

echo "═══════════════════════════════════════════════"
echo "  NoteVault — Oracle Cloud Deployment"
echo "═══════════════════════════════════════════════"

# 1. System updates
echo "▸ Updating system packages…"
sudo apt update && sudo apt upgrade -y

# 2. Install Python 3, pip, git
echo "▸ Installing Python3, pip, git…"
sudo apt install -y python3 python3-pip python3-venv git

# 3. Clone the repo
echo "▸ Cloning NoteVault from GitHub…"
cd ~
if [ -d "notes-app" ]; then
  echo "  notes-app already exists, pulling latest…"
  cd notes-app && git pull
else
  git clone https://github.com/Prasanth0544/notes_app.git notes-app
  cd notes-app
fi

# 4. Create virtual environment
echo "▸ Setting up Python virtual environment…"
python3 -m venv venv
source venv/bin/activate

# 5. Install dependencies
echo "▸ Installing Python dependencies…"
pip install --upgrade pip
pip install -r requirements.txt

# 6. Create .env file (user must fill in values)
if [ ! -f ".env" ]; then
  echo "▸ Creating .env file…"
  cat > .env << 'EOF'
MONGO_URI=YOUR_MONGODB_ATLAS_CONNECTION_STRING_HERE
JWT_SECRET_KEY=YOUR_JWT_SECRET_KEY_HERE

# Optional — Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional — GitHub OAuth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

APP_URL=http://YOUR_OCI_PUBLIC_IP:5000
EOF
  echo "  ⚠ EDIT .env with: nano .env"
fi

# 7. Open firewall port 5000
echo "▸ Opening port 5000 in firewall…"
sudo iptables -I INPUT -p tcp --dport 5000 -j ACCEPT
sudo apt install -y iptables-persistent
sudo netfilter-persistent save

# 8. Create systemd service
echo "▸ Creating systemd service…"
sudo tee /etc/systemd/system/notevault.service > /dev/null << EOF
[Unit]
Description=NoteVault Flask Server
After=network.target

[Service]
User=$USER
WorkingDirectory=$HOME/notes-app
Environment=PATH=$HOME/notes-app/venv/bin:/usr/bin
ExecStart=$HOME/notes-app/venv/bin/gunicorn --bind 0.0.0.0:5000 --workers 2 --timeout 120 server:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable notevault
sudo systemctl start notevault

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ NoteVault is now running!"
echo "  URL: http://YOUR_OCI_PUBLIC_IP:5000"
echo "  Check status: sudo systemctl status notevault"
echo "  View logs:    sudo journalctl -u notevault -f"
echo "═══════════════════════════════════════════════"
