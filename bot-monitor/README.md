## Bot Monitor

- `Rule.ts`: Type definitions and methods for fetching and parsing "rules" (configurations of bot tasks to check).
- `Monitor.ts`: Code for checking bot edits and log actions and determining if it matches the configured requirements.
- `CheckDb.ts`: Interface to a SQLite database used for storing vital data points used for making API usage efficient.
- `Alert.ts`: Code for sending out alerts for bot tasks identified to be stopped.
- `Tabulator.ts`: Generates the tabular summary report.
- `main.ts`: Driver file
- `utils.ts`: A couple of utility functions.
- `test.ts`: Unit tests in mocha, though mostly empty.
