#!/bin/bash
set -euo pipefail

function log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Starting"
cd "/data/project/mdanielsbot/MD-SDZeroBot/category-cycles"

log "Getting parentcat to subcat mappings..."
cat get_edges.sql | sql --skip-column-names "${DB:-commonswiki}" > edges.out
log "Got edges"

# add a -1 at the end for the cpp program to detect end of input
echo -e "\n-1" >> edges.out

log "Compiling cpp script..."
g++ find_cycles.cpp

log "Starting cpp script..."
./a.out < edges.out > cycles.json

log "Starting export to wiki..."
node prettify.js

log "Done"
