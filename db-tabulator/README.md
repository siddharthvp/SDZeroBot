## Database report generator

`app.ts` contains all the working logic, but doesn't execute anything by itself. There are 3 entry points:
- `main.ts` - triggered via cron. See entry in `jobs.yml` file.
- `eventstream-metadata-maintainer.ts` - eventstream hook that updates stored metadata of queries present on pages, used in the cron job.
- `web-endpoint.ts` - webservice route that allows users to trigger update on a specific report.

Use `--fake` argument for the input to be read from `fake-configs.wikitext` and output to be written to `fake-output.wikitext`. 

### 2023 updates

Problems:
- Reports on the same page need to have the same update interval
- Pages are read completely to figure out whether updates are needed

Solution:
- Use EventStream to track new or updated subscribed pages. Persist the update configs in db.
- Persist the last updated timestamp of each report in db.
- In the cronjob, query the db to find out pages with updates required.

### Test plan
- Deploy, wait a minute
- Check if dbreports table is correctly populated
- Add a page to the category, verify that it shows up
- Update, delete and add queries to the category, verify table
- Delete all queries from the category, verify table
- Stop eventstream service, add a page to category and remove existing one, restart, verify table
- Trigger cronjob run, verify lastUpdate is correctly populated in table
- Trigger cronjob again, verify no updates are actually done again
- Trigger cronjob after simulating tools db failure (editing code check) as well
