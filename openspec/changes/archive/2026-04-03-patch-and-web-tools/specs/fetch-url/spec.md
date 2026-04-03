## Purpose
`fetch_url` gives AI agents access to web page content as plain text without requiring any API key or external configuration.

## Requirements

### Requirement: fetch_url fetches and strips HTML from a public URL
The system SHALL provide a `fetch_url` tool that performs an HTTP GET request and returns the response body with HTML tags stripped and whitespace normalized. Script and style block content SHALL be removed before tag stripping. The response SHALL be capped at 100KB. No API key is required.

#### Scenario: Public documentation page fetched
- **WHEN** an agent calls `fetch_url` with a reachable public URL
- **THEN** the response text (no HTML tags) is returned, up to 100KB

#### Scenario: Response exceeds 100KB
- **WHEN** the response body exceeds 100KB
- **THEN** only the first 100KB of stripped text is returned

#### Scenario: Unreachable URL returns error
- **WHEN** the URL cannot be reached (DNS failure, timeout, HTTP error)
- **THEN** the tool returns a descriptive error string

### Requirement: fetch_url blocks requests to private IP ranges
The system SHALL resolve the hostname of any URL before making the request and block requests whose resolved IP falls within loopback (127.0.0.0/8), private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), or link-local (169.254.0.0/16) ranges. IPv6 loopback (::1) SHALL also be blocked.

#### Scenario: Localhost URL blocked
- **WHEN** an agent calls `fetch_url` with a URL resolving to 127.0.0.1 or ::1
- **THEN** the tool returns an SSRF error and no HTTP request is made

#### Scenario: Private subnet URL blocked
- **WHEN** an agent calls `fetch_url` with a URL resolving to a private IP
- **THEN** the tool returns an SSRF error and no HTTP request is made
