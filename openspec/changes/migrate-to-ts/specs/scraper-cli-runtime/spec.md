## ADDED Requirements

### Requirement: Scraper and CLI behavior remain parity-checked

The migrated TypeScript scraper and CLI runtime SHALL preserve the current Python behavior for authenticated requests, sync execution, SQLite writes, and CLI result reporting.

#### Scenario: Running a sync command in TypeScript

- **WHEN** the TypeScript implementation performs a full sync or gameweek sync against the same fixtures and expectations used by the Python implementation
- **THEN** it produces the same observable scraper, database, and CLI outcomes within the migration contract
