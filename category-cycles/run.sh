#!/bin/bash

cd "./SDZeroBot/category-cycles"

cat get_edges.sql | sql enwiki --skip-column-names > edges.out
echo "Got edges\n"

# add a -1 at the end for the cpp program to detect end of input
echo -e "\n-1" >> edges.out

g++ find_cycles.cpp
./a.out < edges.out > cycles.json

/data/project/sdzerobot/bin/node prettify.js
