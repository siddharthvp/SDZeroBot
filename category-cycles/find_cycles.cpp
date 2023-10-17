/**
 * Reads the output of the database query as STDIN 
 * and writes a JSON string representing the cycles
 * to STDOUT.
 */

#include<iostream>
#include<unordered_map>
#include<unordered_set>
using namespace std;

cout.sync_with_stdio(false);

// globals: for the graph and DFS
unordered_map< int, unordered_set<int> > graph;
unordered_set<int> visited, onStack;
unordered_map<int,int> edgeTo;

bool first = true;

void dfs(int v) {
    visited.insert(v);
    onStack.insert(v);
    for (int i : graph[v]) {
        if (visited.find(i) == visited.end()) { // unvisited
            edgeTo[i] = v;
            dfs(i);
        } else if (onStack.find(i) != onStack.end()) {
            if (first) {
                cout << "[";
                first = false;
            } else {
                cout << ",[";
            }
            int x = v;
            while (x != i) {
                cout << x << ",";
                x = edgeTo[x];
            }
            cout << i << "]";
        }
    }
    onStack.erase(onStack.find(v));
}

int main() {

    // Read inputs:

    unordered_multimap<int,int> cl;
    int parent, sub;
    while(1) {
        cin >> sub;
        if (sub == -1) { // end of input
            break;
        }
        cin >> parent;
        cl.insert({ parent, sub });
    }
    // cout << "Finished reading inputs...\n";

    // Convert list of edges representation to adjacency list representation
    for (auto p: cl) {
        graph[p.first].insert(p.second);
    }
    // cout << "Finished converting list of edges to adjacency list...\n";

    cout << "[";

    // Begin DFS
    for (auto p: graph) {
        if (visited.find(p.first) == visited.end()) {
            dfs(p.first);
        }
    }

    cout << "]";
}
