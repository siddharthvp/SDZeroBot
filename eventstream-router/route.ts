import type {eventData} from "./main";
import {createLogStream} from "./utils";

/**
 * REGISTER ROUTES
 *
 * A route should default export a class extending Route, which defines the
 * filter and worker methods. The worker should be idempotent, that is, it
 * must handle the scenario of the same event being passed to it multiple times,
 * which could occur due to reconnections.
 *
 * NOTE: Route files should NOT contain any process.chdir() statements!
 * Avoid executing code at the top level, put any required initializations
 * in the class init() method, which can be async.
 *
 */

export abstract class Route {
	name: string;
	log: ((msg: any) => void);

	init(): void | Promise<void> {
		this.log = createLogStream('./' + this.name + '.out');
	}

	filter(data: eventData): boolean {
		return true;
	}

	abstract worker(data: eventData);
}