## SDZeroBot webservice

An Express.js app. Access via https://sdzerobot.toolforge.org. Test locally by running `npm test` and visiting http://localhost:3000.

The `toolforge-update` workflow syncs this directory with `www/js` on the host. 

All paths to SDZeroBot files in code must be via `../../SDZeroBot` rather than via `../` – the latter will work locally but not when inside `www/js` directory!

`npm restart` should be run inside toolforge's `www/js` directory after every code change. The toolforge-update worflow takes care of this on every push if changes were made in `webservice/` directory, or in any of the `web-endpoint` files elsewhere. However, it won't trigger if changes are only made to files relied on by the web files. In such cases, the manual workflow `toolforge-web-restart` could instead be used.
