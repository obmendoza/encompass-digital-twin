# Local Dev — Restore the Three Terminals

The local stack runs three long-lived processes, one per terminal:

| Service | Command                              | URL                    |
| ------- | ------------------------------------ | ---------------------- |
| API     | `pnpm --filter @twin/api dev`        | http://localhost:4000  |
| Web     | `pnpm --filter @twin/web dev`        | http://localhost:3000  |
| Agent   | `uvicorn main:app --reload --port 8000` (in `~/Downloads/mortgage_uw_agent`) | http://localhost:8000 |

Closed terminals can't be recovered after the fact — the processes died with them. Use one of the options below to bring the stack back up.

## Option A — One command (recommended)

```
./scripts/dev-up.sh
```

Creates a tmux session named `twin-dev` with three panes (API, Web, Agent) and attaches. Re-running attaches to the existing session instead of spawning duplicates.

Detach: `Ctrl-b d`. Re-attach: `tmux attach -t twin-dev`. Stop everything: `tmux kill-session -t twin-dev`.

If the agent repo lives somewhere other than `~/Downloads/mortgage_uw_agent`:

```
AGENT_DIR=/path/to/mortgage_uw_agent ./scripts/dev-up.sh
```

No tmux on your machine? Use `./scripts/dev-up.sh --no-tmux` — the services run in the background with logs in `/tmp/twin-{api,web,agent}.log`.

## Option B — Three terminals by hand

Open three terminals and run one command in each:

```
# Terminal 1 — API (:4000)
pnpm --filter @twin/api dev

# Terminal 2 — Web (:3000)
pnpm --filter @twin/web dev

# Terminal 3 — Agent (:8000)
cd ~/Downloads/mortgage_uw_agent
source .venv/bin/activate   # if you use a venv
uvicorn main:app --reload --port 8000
```

## Prerequisites

- `pnpm install` has been run at the repo root (workspace install).
- `.env` files exist for `@twin/api` and `@twin/web` (see `CLAUDE.md` for required vars: `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_API_URL`, `AGENT_SERVICE_URL`).
- The agent repo at `~/Downloads/mortgage_uw_agent` has its Python deps installed.

## Verify the stack is up

```
curl -s http://localhost:4000/health    && echo
curl -s http://localhost:3000           >/dev/null && echo "web ok"
curl -s http://localhost:8000/health    && echo
```
