# Shared helpers for start-rehearsal.sh / start-judging.sh (macOS + Linux).
# Keys are read from the macOS Keychain (or an already-exported env var, or a hidden prompt).
# They are never written to disk, printed, or passed on the command line.
set -euo pipefail
KOODE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"

# get_key VAR KEYCHAIN_SERVICE REQUIRED(1|0)
get_key() {
  local var="$1" service="$2" required="$3" val="${!1:-}"
  if [ -z "$val" ] && command -v security >/dev/null 2>&1; then
    val="$(security find-generic-password -a "$USER" -s "$service" -w 2>/dev/null || true)"
  fi
  if [ -z "$val" ] && [ "$required" = 1 ] && [ -t 0 ]; then
    read -r -s -p "$var (input hidden): " val; echo >&2
  fi
  if [ -z "$val" ] && [ "$required" = 1 ]; then
    echo "ERROR: $var not found (Keychain service '$service'). See docs/DEMO.md 'One-time setup'." >&2; exit 1
  fi
  printf -v "$var" '%s' "$val"
  export "$var"
}

port_free() {
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    echo "ERROR: something is already running on port $PORT (another Koode mode?). Stop it first (Ctrl-C in its terminal)." >&2
    exit 1
  fi
}

node_ok() {
  command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js 20+ not found (brew install node@20)." >&2; exit 1; }
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || { echo "ERROR: Node $major found; Koode needs Node 20+." >&2; exit 1; }
}
