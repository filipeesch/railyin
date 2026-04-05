# Railyin

## Development

```bash
bun install
bun run dev
```

## Testing

### Backend tests

Runs unit and integration tests for the Bun backend (no app required):

```bash
bun test
# or
bun run test
```

### UI tests

UI tests drive the live app through its debug bridge (`localhost:9229`). The app must be running before you execute them.

**1. Start the app:**

```bash
bun run dev
```

**2. In a separate terminal, run the UI tests:**

```bash
bun run test:ui
```

> The tests open the code review overlay, interact with Monaco diff editor zones, click buttons, and assert on visible state. They reset their own DB state at the start of each suite, so no manual cleanup is needed between runs.
