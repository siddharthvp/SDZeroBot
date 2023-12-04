## Database report generator

`app.ts` contains all the working logic, but doesn't execute anything by itself. There are 3 entry points:
- `main.ts` - triggered via cron. See entry in `jobs.yml` file.
- `eventstream-metadata-maintainer.ts` - eventstream hook that updates stored metadata of queries present on pages, used in the cron job.
- `web-endpoint.ts` - webservice route that allows users to trigger update on a specific report.

Use `--fake` argument for the input to be read from `fake-configs.wikitext` and output to be written to `fake-output.wikitext. 