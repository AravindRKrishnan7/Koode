#!/usr/bin/env bash
# SIMULATION / REHEARSAL MODE: mock planner (scripted targets, NOT AI). Uses no Groq quota.
# Voice (Sarvam) stays real if SARVAM_API_KEY is available, so the microphone path can be rehearsed.
source "$(dirname "$0")/_common.sh"
node_ok; port_free
get_key SARVAM_API_KEY koode-sarvam 0
unset GROQ_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY GOOGLE_API_KEY KOODE_REQUIRE_LLM
export KOODE_PROVIDER=mock
cat >&2 <<'BANNER'
################################################################
#  KOODE REHEARSAL — SIMULATION ONLY (mock planner, not AI)   #
#  Panel badge shows: "MOCK test harness (not AI)" in red.    #
#  Do NOT use this mode in front of judges.                   #
################################################################
BANNER
[ -n "${SARVAM_API_KEY:-}" ] && echo "Voice: real Sarvam STT/TTS" >&2 || echo "Voice: off (no SARVAM_API_KEY) — typing only" >&2
cd "$KOODE_ROOT/backend" && exec node src/server.js
