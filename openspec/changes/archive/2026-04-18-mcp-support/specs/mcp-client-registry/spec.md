## ADDED Requirements

### Requirement: Server lifecycle state machine
The registry SHALL maintain a state for each configured server: `idle`, `starting`, `running`, or `error`. On registry init, all servers start in `idle`. Connecting transitions through `starting` to `running` or `error`.

#### Scenario: Successful connection
- **WHEN** a server is started and the MCP initialize handshake completes successfully
- **THEN** the server transitions to `running` and its tool list is available

#### Scenario: Connection failure
- **WHEN** a server fails to start (process error, HTTP unreachable, or initialize timeout)
- **THEN** the server transitions to `error` with an error message stored

#### Scenario: Reload running server
- **WHEN** `reload(serverName)` is called on a server in any state
- **THEN** the server's existing connection is terminated, state resets to `idle`, and the server reconnects

### Requirement: MCP initialize handshake
The registry SHALL perform the MCP JSON-RPC initialize handshake before calling `tools/list`. This consists of sending `initialize` with protocol version and client info, then sending the `initialized` notification.

#### Scenario: Handshake on connect
- **WHEN** a server starts
- **THEN** the registry sends `initialize`, waits for the result, then sends `initialized` before any other method calls

### Requirement: Tool list caching
The registry SHALL cache the `tools/list` response for each running server and return cached definitions without re-querying the server on each call to `listTools()`.

#### Scenario: Cache hit
- **WHEN** `listTools()` is called and the server is `running` with a cached tool list
- **THEN** the cached list is returned without an additional `tools/list` request

#### Scenario: Cache invalidated on reload
- **WHEN** a server is reloaded
- **THEN** the tool cache is cleared and `tools/list` is re-fetched after reconnection

### Requirement: Tool invocation
The registry SHALL invoke MCP tools by sending `tools/call` with `name` and `arguments` and returning the content result as a string.

#### Scenario: Successful tool call
- **WHEN** `callTool(serverName, toolName, args)` is called and the server is `running`
- **THEN** the registry sends `tools/call` and returns the text content from the response

#### Scenario: Tool call on error server
- **WHEN** `callTool` is called for a server in `error` state
- **THEN** the registry returns an error string indicating the server is unavailable

### Requirement: Graceful shutdown
The registry SHALL terminate all stdio server processes and close all HTTP connections when `shutdown()` is called, using `Promise.allSettled` so one failure does not block others.

#### Scenario: Shutdown all servers
- **WHEN** `shutdown()` is called
- **THEN** all running stdio server processes are terminated and the registry transitions all servers to `idle`
