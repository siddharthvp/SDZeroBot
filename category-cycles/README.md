## Category cycles

Used to generate [User:SDZeroBot/Category_cycles](https://en.wikipedia.org/wiki/User:SDZeroBot/Category_cycles). 

Run using `bash run.sh`. 

To run for a wiki other than enwiki, pass in the environment variables:
* DB
* API_URL
* OAUTH2_ACCESS_TOKEN

Files:
- get_edges.sql: Get a list of all parentcat—subcat connections through the database, with only the category page IDs for efficiency in the next step.
- find_cycles.cpp: Use depth-first search in the graph to detect the cycles.
- prettify.js: Translate the page IDs to titles using the API, and publish report to wiki.

[phab:T263096](https://phabricator.wikimedia.org/T263096) seeks to make such a script a part of MediaWiki.
