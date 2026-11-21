#!/usr/bin/env bash
# JUDGING MODE: real Groq planner (openai/gpt-oss-20b) + real Sarvam voice. Mock is impossible here:
# the backend refuses to start without a model key, and this script stops if /health is not groq/mock:false/voice:true.
source "$(dirname "$0")/_common.sh"
node_ok; port_free
get_key GROQ_API_KEY koode-groq 1
get_key SARVAM_API_KEY koode-sarvam 1
export KOODE_PROVIDER=groq KOODE_REQUIRE_LLM=1
unset KOODE_FAULT KOODE_MODEL KOODE_SPEECH KOODE_MOCK_TRANSCRIPT
cd "$KOODE_ROOT/backend"
node src/server.js &
PID=$!
trap 'kill $PID 2>/dev/null' INT TERM
for _ in $(seq 1 30); do
  H="$(curl -s "http://127.0.0.1:$PORT/health" || true)"; [ -n "$H" ] && break; sleep 0.3
done
case "$H" in
  *'"provider":"groq"'*'"mock":false'*'"voice":true'*'"speech":"sarvam"'*)
    echo "JUDGING MODE OK: $H" >&2
    echo "Panel badge must read 'model: openai/gpt-oss-20b'. No Groq call is made until you give Koode a goal." >&2 ;;
  *)
    echo "ERROR: backend is not in judging configuration: ${H:-no response}" >&2; kill $PID 2>/dev/null; exit 1 ;;
esac
wait $PID
