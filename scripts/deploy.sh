#!/usr/bin/env bash
# Deploy POH to an Ubuntu server in one command.
# Usage: bash scripts/deploy.sh [user@host] [dev|prod]
#
# Defaults:
#   host  — SERVER in .env, or root@<prompt>
#   mode  — prod
#
# What it does:
#   1. Rsyncs the project (skips .env, node_modules, uploads, dist, data/dataset.json)
#   2. Uploads your .env to the server
#   3. Runs scripts/setup.sh remotely
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Config ────────────────────────────────────────────────────────────────────
# Load SERVER from .env if present
if [[ -f "$PROJECT_DIR/.env" ]]; then
  SERVER_ENV=$(grep -E '^SERVER=' "$PROJECT_DIR/.env" | cut -d= -f2- | tr -d '"' || true)
fi

TARGET="${1:-${SERVER_ENV:-}}"
MODE="${2:-prod}"

if [[ -z "$TARGET" ]]; then
  read -rp "Server (user@host): " TARGET
fi

log()  { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }

# Parse user and host
SSH_USER="${TARGET%%@*}"
SSH_HOST="${TARGET##*@}"
APP_DIR="/home/$SSH_USER/poh"
[[ "$SSH_USER" == "root" ]] && APP_DIR="/root/poh"

log "Deploying to $TARGET  ($MODE mode)"
log "Remote app directory: $APP_DIR"

# ── 1. Rsync project ──────────────────────────────────────────────────────────
log "Syncing project files"
rsync -az --progress \
  --exclude='.env' \
  --exclude='node_modules/' \
  --exclude='frontend/node_modules/' \
  --exclude='frontend/dist/' \
  --exclude='uploads/' \
  --exclude='data/dataset.json' \
  --exclude='.git/' \
  "$PROJECT_DIR/" \
  "$TARGET:$APP_DIR/"

ok "Files synced"

# ── 2. Upload .env ────────────────────────────────────────────────────────────
if [[ -f "$PROJECT_DIR/.env" ]]; then
  log "Uploading .env"
  scp "$PROJECT_DIR/.env" "$TARGET:$APP_DIR/.env"
  ok ".env uploaded"
else
  echo ""
  echo "  ⚠  No .env found locally. You will need to create one on the server:"
  echo "     ssh $TARGET 'nano $APP_DIR/.env'"
fi

# ── 3. Run remote setup ───────────────────────────────────────────────────────
log "Running setup on $SSH_HOST"
ssh -t "$TARGET" "bash $APP_DIR/scripts/setup.sh $MODE"
