## Eventstream router

Handy interface to the [Wikimedia EventStreams API](https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams) (recentchange stream only: https://stream.wikimedia.org/v2/stream/recentchange). Multiple unrelated bot tasks share a single EventStream connection, and run together on a single process. Any tasks which do particularly heavy computation should use a separate process, spun off from the main streaming process via the child_process module. 

Files:

- main.ts: Main file executed on the grid using `jstart` command (see package.json)
- EventSource.js: Fork of the npm EventSource module with some modifications around error handling.
- app.ts: Most of the logic 

To create a new task consuming the event stream, create a file from this template:
```ts
import {Route} from "./app";

export default class Task extends Route {
    readonly name = "task" 
        
	async init() {
		super.init();
		this.log('[S] Started');
	}
	
	filter(data): boolean {
		return data.wiki === 'enwiki';
	}

	async worker(data) {
		// Do something with data
	}
}
```

and register it in `main.ts`.

Run `npm restart` on the toolforge host for any code changes to take effect. This automatically takes place through the GitHub Action workflow whenever the pulled commits have edits to any file whose name including path contains "eventstream". 
