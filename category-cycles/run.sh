cd "./SDZeroBot/category-cycles"

cat get_edges.sql | sql enwiki > edges.out
echo "Got edges\n"

# add a -1 at the end for the cpp program to detect end of input
echo -e "\n-1" >> edges.out

g++ find_cycles.cpp
./a.out < edges.out > cycles.json

/data/project/sdzerobot/bin/node prettify.js > cycles_p.txt

head -5000 cycles_p.txt > /data/project/sdzerobot/www/static/output_pretty_trunc.txt
