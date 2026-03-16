## ADDED Requirements

### Requirement: Dashboard routes preserve current behavior

The migrated TypeScript dashboard runtime SHALL preserve the current Python behavior for HTML routes, JSON routes, static assets, image fallback handling, and template-rendered page context.

#### Scenario: Serving dashboard pages and API responses in TypeScript

- **WHEN** a request is made to a dashboard page route or JSON API route covered by the current characterization suite
- **THEN** the TypeScript implementation returns the same observable response shape, status behavior, and template context within the migration contract
