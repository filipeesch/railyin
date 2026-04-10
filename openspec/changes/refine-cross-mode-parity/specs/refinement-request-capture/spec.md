## MODIFIED Requirements

### Requirement: Per-request JSON files in report directory
The runner SHALL write each captured request as a numbered JSON file in a `requests/<scenario-name>/` subdirectory of the report directory. Each file SHALL contain the raw request body, the parsed response (`ResponseCapture`), the inspection record, the cost estimate, and the request timing for that request.

#### Scenario: Report directory contains per-request files with response and timing
- **WHEN** a scenario run completes with 3 proxied requests
- **THEN** the report directory contains `requests/<scenario-name>/001.json`, `002.json`, `003.json`, each with `{ request_id, body, response, inspection, cost, timing }`

#### Scenario: Response field present in mock mode capture
- **WHEN** a mock mode request capture file is written
- **THEN** the file contains a `response` field with a synthesized `ResponseCapture` matching the script entry

#### Scenario: Response field present in local mode capture
- **WHEN** a local mode request capture file is written
- **THEN** the file contains a `response` field with a parsed `ResponseCapture` from the streamed SSE
