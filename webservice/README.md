## SDZeroBot webservice

An Express.js app. Access via https://sdzerobot.toolforge.org. Test locally by running `npm test` and visiting http://localhost:3000.

The `www-js-package.json` file is copied to `www/js/package.json`.

`npm restart` should be run inside toolforge's `www/js` directory after every code change. The toolforge-update worfklow takes care of this on every push if changes were made in `webservice/` directory, or in any of the `web-endpoint` files elsewhere. However, it won't trigger if changes are only made to files relied on by the web files. In such cases, the manual workflow `restart-services` could instead be used.
