/**
 * Script to check if all registered routes are valid without actually starting
 */

import {RouteValidator} from "./RouteValidator";

const routes = require('./routes.json');

// Exit normally (code 0) only if all routes are valid
process.exit(
	Object.entries(routes).every(([name, path]) => {
		return new RouteValidator(name).validate(path).isValid;
	}) ? 0 : 1
);
