#!/usr/bin/env bash
# Remote Ubuntu server setup — installs all system dependencies and starts POH
# Called by deploy.sh; can also be run directly on the server.
# Usage: bash setup.sh [dev|prod]
set -euo pipefail

MODE="${1:-prod}"
APP_DIR="$HOME/poh"
NODE_VERSION="22"

log()  { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠ $*\033[0m"; }

# ── 1. System packages ────────────────────────────────────────────────────────
log "Updating apt and installing base packages"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  curl git build-essential redis-server \
  ca-certificates gnupg lsb-release

# ── 2. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.slice(1).split(".")[0])')" -lt "$NODE_VERSION" ]]; then
  log "Installing Node.js $NODE_VERSION LTS"
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash - 2>/dev/null
  sudo apt-get install -y -qq nodejs
else
  ok "Node.js $(node -v) already installed"
fi

# ── 3. Yarn ───────────────────────────────────────────────────────────────────
if ! command -v yarn &>/dev/null; then
  log "Installing Yarn"
  sudo npm install -g yarn --quiet
else
  ok "Yarn $(yarn -v) already installed"
fi

# ── 4. Redis ──────────────────────────────────────────────────────────────────
log "Enabling Redis"
sudo systemctl enable redis-server --quiet
sudo systemctl restart redis-server
ok "Redis running"

# ── 5. Ollama ─────────────────────────────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  log "Installing Ollama"
  curl -fsSL https://ollama.com/install.sh | sh
else
  ok "Ollama $(ollama --version 2>&1 | head -1) already installed"
fi

log "Enabling Ollama service"
sudo systemctl enable ollama --quiet 2>/dev/null || true
sudo systemctl start  ollama --quiet 2>/dev/null || true

log "Pulling Ollama models (background)"
# Run in background — models are large, don't block setup
(
  sleep 5  # wait for ollama to start
  ollama pull llama3.2:latest    2>&1 | tail -1 || true
  ollama pull qwen2.5:1.5b       2>&1 | tail -1 || true
  ollama pull deepseek-r1:1.5b   2>&1 | tail -1 || true
  echo "[setup] Ollama models ready"
) &
disown

# ── 6. Qvac ───────────────────────────────────────────────────────────────────
if ! command -v qvac &>/dev/null; then
  log "Installing Qvac CLI + SDK globally"
  sudo npm install -g @qvac/cli @qvac/sdk --quiet
else
  ok "Qvac already installed"
fi

# ── 7. Project dependencies ───────────────────────────────────────────────────
log "Installing backend dependencies"
cd "$APP_DIR"
npm install --quiet

log "Installing frontend dependencies"
cd "$APP_DIR/frontend"
npm install --quiet

# ── 8. Frontend build (prod only) ─────────────────────────────────────────────
if [[ "$MODE" == "prod" ]]; then
  log "Building frontend"
  npm run build
fi

# ── 9. Systemd service ────────────────────────────────────────────────────────
SERVICE_FILE="/etc/systemd/system/poh.service"
log "Installing systemd service → $SERVICE_FILE"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=POH — Proof of Human server
After=network.target redis-server.service ollama.service
Wants=redis-server.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable poh
sudo systemctl restart poh

ok "POH service started"
echo ""
echo "┌─────────────────────────────────────────────┐"
echo "│  POH is live on http://$(hostname -I | awk '{print $1}'):3000        │"
echo "│                                             │"
echo "│  Manage:  sudo systemctl [start|stop|status|restart] poh  │"
echo "│  Logs:    journalctl -u poh -f              │"
echo "│  Ollama:  models downloading in background  │"
echo "└─────────────────────────────────────────────┘"
