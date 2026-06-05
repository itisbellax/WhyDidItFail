#!/bin/bash
# PrintMind — one-command start
# Kills any existing server on port 3000, then starts fresh.

cd "$(dirname "$0")"

# Kill whatever is on port 3000
PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Stopping existing server (PID $PID)…"
  kill "$PID"
  sleep 2
fi

echo "Starting PrintMind…"
nohup npm start > /tmp/printmind.log 2>&1 &
NEW_PID=$!
echo "Started (PID $NEW_PID) → http://localhost:3000"
echo "Logs: tail -f /tmp/printmind.log"
echo "Stop: kill $NEW_PID"
