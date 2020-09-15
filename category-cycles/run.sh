cd "~/SDZeroBot/category-cycles"

cat get_edges.sql | sql enwiki > edges.out
echo "Got edges\n"

g++ find_cycles.cpp
./a.out < edges.out > cycles.out 
