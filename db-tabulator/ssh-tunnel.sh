#!/bin/bash

if [[ $(lsof -i | grep LISTEN | grep -c 4711) == 0 ]]; then
  ssh -L 4711:enwiki.analytics.db.svc.eqiad.wmflabs:3306 toolforge
fi
