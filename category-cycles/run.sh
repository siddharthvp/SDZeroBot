#!/bin/bash

cd "./MD-SDZeroBot/category-cycles"

cat get_edges.sql | sql --skip-column-names "${DB:-commonswiki}" > edges.out
echo "Got edges\n"

# add a -1 at the end for the cpp program to detect end of input
echo -e "\n-1" >> edges.out

g++ find_cycles.cpp
./a.out < edges.out > cycles.json

/data/project/mdanielsbot/bin/node prettify.js
