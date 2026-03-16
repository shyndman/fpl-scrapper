## ADDED Requirements

### Requirement: Migration proof uses Python as the oracle

The TypeScript migration SHALL be considered ready for cutover only after the TypeScript implementation has been verified against the current Python behavior using characterization tests and parity checks.

#### Scenario: Evaluating migration readiness

- **WHEN** implementation work for a migrated area is considered complete
- **THEN** readiness is determined by evidence that the TypeScript behavior matches the Python behavior for the required test and parity surfaces
