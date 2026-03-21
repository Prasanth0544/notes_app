# Deploy NoteVault to Oracle Cloud (Always Free)

## What You Get
- **Free forever** Ubuntu VM (1 CPU, 1 GB RAM) — more than enough
- **Public IP** — app works from anywhere in the world
- **No sleep** — always running, unlike Render

## Prerequisites
- Credit/debit card (for verification only — **₹0 charged**)
- Your GitHub repo with NoteVault code pushed

---

## Step 1 — Create OCI Account
1. Go to [cloud.oracle.com/sign-up](https://cloud.oracle.com/sign-up)
2. Fill in your details, verify email
3. Add credit/debit card (₹0 verification charge, refunded)
4. Select home region: **India South (Hyderabad)** or **India West (Mumbai)**
5. Wait for account to be provisioned (~2 min)

## Step 2 — Create a VM Instance
1. Login to [cloud.oracle.com](https://cloud.oracle.com)
2. Click **"Create a VM instance"** (or Compute → Instances → Create)
3. Configure:
   - **Name**: `notevault`
   - **Image**: Ubuntu 22.04 (click "Change image" → Ubuntu)
   - **Shape**: VM.Standard.E2.1.Micro (**Always Free**)
   - **SSH Key**: Click **"Generate a key pair"** → **Download both keys**
     - Save `ssh-key-*.key` (private) somewhere safe!
4. Click **Create** → Wait ~2 min for it to start

## Step 3 — Open Port 5000 (Firewall)
1. Go to **Networking → Virtual Cloud Networks**
2. Click your VCN → **Security Lists** → **Default Security List**
3. Click **Add Ingress Rules**:
   - Source CIDR: `0.0.0.0/0`
   - Destination Port Range: `5000`
   - Description: `NoteVault`
4. Click **Add**

## Step 4 — SSH into Your VM
1. Find your VM's **Public IP** (Compute → Instances → click your VM)
2. Open PowerShell on your laptop:
```powershell
ssh -i "C:\path\to\ssh-key.key" ubuntu@YOUR_PUBLIC_IP
```
> First time it will ask "Are you sure?" — type `yes`

## Step 5 — Deploy NoteVault (One Command!)
Once SSH'd into the VM, run:
```bash
# Download and run the deploy script
curl -O https://raw.githubusercontent.com/Prasanth0544/notes_app/main/deploy_oci.sh
chmod +x deploy_oci.sh
./deploy_oci.sh
```

This script automatically:
- Installs Python 3, pip, git
- Clones your GitHub repo
- Creates a virtual environment
- Installs all dependencies
- Sets up the `.env` file
- Opens port 5000 in the VM firewall
- Creates a systemd service (auto-starts on boot)

## Step 6 — Update APP_URL in .env
```bash
nano ~/notes-app/.env
```
Change `APP_URL` to:
```
APP_URL=http://YOUR_OCI_PUBLIC_IP:5000
```
Then restart:
```bash
sudo systemctl restart notevault
```

## Step 7 — Test It!
Open in your phone/laptop browser:
```
http://YOUR_OCI_PUBLIC_IP:5000
```
You should see the NoteVault login page! 🎉

## Step 8 — Update Mobile App
On your laptop, update these 3 files to replace the local IP with your OCI public IP:

| File | Line | Change to |
|------|------|-----------|
| `mobile/www/app.js` | 13 | `http://YOUR_OCI_IP:5000/api` |
| `mobile/www/login.html` | 158 | `http://YOUR_OCI_IP:5000/api` |
| `mobile/www/profile-setup.html` | 128 | `http://YOUR_OCI_IP:5000/api` |

Then rebuild and reinstall APK:
```powershell
cd c:\Users\prasa\Documents\notes-app\mobile
npx cap sync android
cd android
.\gradlew assembleDebug
C:\Users\prasa\AppData\Local\Android\Sdk\platform-tools\adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

---

## Useful Commands (on the OCI VM)
```bash
# Check if server is running
sudo systemctl status notevault

# View live logs
sudo journalctl -u notevault -f

# Restart after code changes
cd ~/notes-app && git pull && sudo systemctl restart notevault

# Stop the server
sudo systemctl stop notevault
```
