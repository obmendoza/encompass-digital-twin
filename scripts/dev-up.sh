#!/usr/bin/env bash
# Restore the local dev terminals: API (:4000), Web (:3000), Agent (:8000).
#
# With tmux available (default): creates a "twin-dev" session with three panes,
# each tailing one service. Re-running attaches to the existing session.
#
# Without tmux (--no-tmux): launches the services in the background and writes
# logs to /tmp/twin-{api,web,agent}.log.
#
# Stop everything: tmux kill-session -t twin-dev   (or pkill -f tsx / next / uvicorn)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="${AGENT_DIR:-$HOME/Downloads/mortgage_uw_agent}"
SESSION="${SESSION:-twin-dev}"
USE_TMUX=1

for arg in "$@"; do
  case "$arg" in
    --no-tmux) USE_TMUX=0 ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
  esac
done

# Write per-service launcher scripts to a temp dir, then invoke them. This
# sidesteps the shell-quoting maze of passing inline commands through tmux
# (which dispatches via /bin/sh on macOS — no `source`, no `set -a`).
LAUNCHER_DIR="$(mktemp -d /tmp/twin-dev-XXXXXX)"

cat > "$LAUNCHER_DIR/api.sh" <<EOF
#!/usr/bin/env bash
cd "$REPO_ROOT" && exec pnpm --filter @twin/api dev
EOF

cat > "$LAUNCHER_DIR/web.sh" <<EOF
#!/usr/bin/env bash
cd "$REPO_ROOT" && exec pnpm --filter @twin/web dev
EOF

cat > "$LAUNCHER_DIR/agent.sh" <<EOF
#!/usr/bin/env bash
cd "$AGENT_DIR" || { echo "AGENT_DIR not found: $AGENT_DIR"; exec bash; }
if [ -d .venv ]; then source .venv/bin/activate; fi
if [ -f .env ]; then set -a; source .env; set +a; fi
exec uvicorn backend.main:app --reload --port 8000
EOF

chmod +x "$LAUNCHER_DIR"/*.sh

if [ ! -d "$AGENT_DIR" ]; then
  echo "warn: AGENT_DIR not found at $AGENT_DIR — agent pane will exit. Set AGENT_DIR=... to override." >&2
fi

if [ "$USE_TMUX" -eq 1 ] && command -v tmux >/dev/null 2>&1; then
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' already exists — attaching."
    exec tmux attach -t "$SESSION"
  fi
  tmux new-session -d -s "$SESSION" -n services "$LAUNCHER_DIR/api.sh"
  tmux split-window -h -t "$SESSION:services" "$LAUNCHER_DIR/web.sh"
  tmux split-window -v -t "$SESSION:services.1" "$LAUNCHER_DIR/agent.sh"
  tmux select-layout -t "$SESSION:services" tiled
  echo "Started tmux session '$SESSION'. Attach with: tmux attach -t $SESSION"
  echo "Launcher scripts: $LAUNCHER_DIR"
  exit 0
fi

echo "Starting services in background (logs in /tmp/twin-*.log)…"
nohup "$LAUNCHER_DIR/api.sh"   >/tmp/twin-api.log   2>&1 &
nohup "$LAUNCHER_DIR/web.sh"   >/tmp/twin-web.log   2>&1 &
nohup "$LAUNCHER_DIR/agent.sh" >/tmp/twin-agent.log 2>&1 &
echo "  API   → http://localhost:4000  (tail -f /tmp/twin-api.log)"
echo "  Web   → http://localhost:3000  (tail -f /tmp/twin-web.log)"
echo "  Agent → http://localhost:8000  (tail -f /tmp/twin-agent.log)"
