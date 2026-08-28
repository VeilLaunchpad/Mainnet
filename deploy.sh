#!/usr/bin/env bash
#
# Deploy VEILPAD to Railway.
#
# Everything the dashboard would ask for is done here instead, in the order
# that matters: the service has to exist before a volume can attach to it, and
# the domain has to exist before the app can register its Telegram webhook, so
# the final redeploy is what makes the bot come alive rather than an
# afterthought.
#
# Re-running this is safe. Each step checks for what it would create.

set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-veilpad}"
MOUNT_PATH="${MOUNT_PATH:-/data}"

say() { printf '\n\033[1;35m==>\033[0m %s\n' "$1"; }
note() { printf '    %s\n' "$1"; }

command -v railway >/dev/null 2>&1 || {
  echo "Railway CLI not found. Install it with:  npm i -g @railway/cli"
  exit 1
}

# ---------------------------------------------------------------------------

say "1/6  Signing in"
if railway whoami >/dev/null 2>&1; then
  note "already signed in as $(railway whoami 2>/dev/null | tail -1)"
else
  note "a browser window will open, or a device code will be printed"
  railway login
fi

say "2/6  Project"
if railway status >/dev/null 2>&1; then
  note "this directory is already linked to a project"
else
  railway init --name "$PROJECT_NAME"
fi

say "3/6  First deploy"
note "builds the Dockerfile and creates the service"
railway up -y

# `railway up` creates the service but does not link this directory to it, and
# every later command needs a linked service to act on.
if ! railway status 2>/dev/null | grep -A1 "Linked service" | grep -qv "None"; then
  note "linking this directory to the new service"
  railway link -p "$PROJECT_NAME" -e production -s "$PROJECT_NAME" >/dev/null 2>&1 || true
fi

say "4/6  Volume at $MOUNT_PATH"
if MSYS_NO_PATHCONV=1 railway volume list 2>/dev/null | grep -q "$MOUNT_PATH"; then
  note "a volume is already mounted there"
else
  # Without this the SQLite index lives inside the container and every deploy
  # starts from an empty database.
  # Git Bash rewrites a leading slash into a Windows path before the CLI ever
  # sees it, so `/data` arrives as `C:/Program Files/Git/data` and is rejected.
  MSYS_NO_PATHCONV=1 railway volume add -m "$MOUNT_PATH"
  note "attached. the app reads RAILWAY_VOLUME_MOUNT_PATH by itself"
fi

say "5/6  Public domain"
if railway domain list 2>/dev/null | grep -qE 'https?://'; then
  note "a domain already exists"
  railway domain list 2>/dev/null | grep -oE 'https?://[^ ]+' | head -3
else
  # Telegram cannot deliver to a service with no public URL.
  railway domain
fi

say "6/6  Redeploy onto the volume and domain"
note "the first deploy ran before either existed, so this is the one that counts"
railway redeploy -y

# ---------------------------------------------------------------------------

say "Done"
cat <<'EOF'
    Watch it come up with:   railway logs

    A healthy boot prints:
      [veilpad] public url : https://<your-app>.up.railway.app
      [veilpad] data dir   : /data/veilpad
      [veilpad] bucket    : no snapshot in the bucket
      [veilpad] telegram  : webhook -> https://<your-app>.up.railway.app/api/telegram/webhook
      [veilpad] agents    : heartbeat sweep every 30s
      [veilpad] backup    : every 15 minutes to the bucket

    Stop any local Telegram poller before using the bot. Telegram allows one
    delivery method per bot, and the webhook now belongs to Railway.
EOF
