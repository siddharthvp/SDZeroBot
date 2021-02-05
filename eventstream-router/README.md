## Eventstream router

Handy interface to the [Wikimedia EventStreams API](https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams) (recentchange stream only). Multiple unrelated bot tasks share a single EventStream connection, and run together on a single process. Any tasks which do particularly heavy computation should use a separate process, spun off from the main streaming process via the child_process module. 

Files:

- main.ts: Main file executed on the grid using `jstart` command (see package.json)
- EventSource.js: Fork of the npm EventSource module with some modifications around error handling.
- routes.json: list of "routes" – though the routes are `.ts` files, the file extensions here `.js` since they're compiled to js.
- route.ts: abstract class extended by all route classes.

To create a new task consuming the event stream, create a ts file from this template:
```ts
import {Route} from "./route";

export default class Task extends Route {
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

and add the js file name to `routes.json`.