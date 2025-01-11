#!/bin/bash
set -euo pipefail

function log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1\n"
}

log "Starting"
cd "/data/project/sdzerobot/SDZeroBot/category-cycles"

log "Getting parentcat to subcat mappings..."
node get-edges.js

# add a -1 at the end for the cpp program to detect end of input
echo -e "\n-1" >> edges.out

log "Compiling cpp script..."
g++ find_cycles.cpp

log "Starting cpp script..."
./a.out < edges.out > cycles.json

log "Starting export to wiki..."
/data/project/sdzerobot/bin/node prettify.js

log "Done"
