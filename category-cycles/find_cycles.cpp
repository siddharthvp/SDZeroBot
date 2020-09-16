#include<iostream>
#include<unordered_map>
#include<unordered_set>
using namespace std;

// globals: for the graph and DFS
unordered_map< int, unordered_set<int> > graph;
unordered_set<int> visited, onStack;
unordered_map<int,int> edgeTo;

// globals: counting puroposes only
int numCycles = 0;
long long totalCycleSize = 0;

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
            numCycles++, totalCycleSize++;
            int x = v;
            while (x != i) {
                cout << x << ",";
                x = edgeTo[x];
                totalCycleSize++;
            }
            cout << i << "]";
        }
    }
    onStack.erase(onStack.find(v));
}

int main() {

    // Read inputs:

    // first read in and ignore the two strings ("subcat", "parentcat")
    // at the top of the file
    string x; cin >> x; cin >> x;

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
    // cout << "Done: found " + to_string(numCycles) + " cycles. Each cycle contains an average of " + to_string(totalCycleSize/numCycles) + " categories\n";
}


