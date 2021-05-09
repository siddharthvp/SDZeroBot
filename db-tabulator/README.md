## Database report generator

`app.ts` contains all the working logic, but doesn't execute anything by itself. There are 3 entry points:
- `main.ts` - triggered via cron. See entry in `crontab` file.
- `eventstream-trigger.ts` - eventstream hook that does a immediate update for a single page that is edited to newly transclude the triggering template.
- `web-endpoint.ts` - webservice route that allows users to trigger update on a specific report.

Use `--fake` argument for the input to be read from `fake-configs.wikitext` and output to be written to `fake-output.wikitext. 