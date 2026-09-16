#!/usr/bin/env bash


set -euo pipefail

cd "$(dirname "$0")" 


# Load shared config (KAFKA_BOOTSTRAP, POLL_SECONDS) and export to child processes
if [ -f .env ]; then
  set -a; source .env; set +a
fi



# Zones from args if given, else all three
if [ "$#" -gt 0 ]; then
  ZONES=("$@")
else
  ZONES=("NORTH" "MIDLANDS" "SOUTH")
fi


pids=()
cleanup() { echo; echo "Stopping workers…"; kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup INT TERM EXIT     # Ctrl+C kills all of them

for zone in "${ZONES[@]}"; do
  echo "▶ worker $zone"
  WORKER_ZONE="$zone" uv run scraper.py &
  pids+=($!)
done

wait                           # keep the script alive until workers exit