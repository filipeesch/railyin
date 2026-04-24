## 1. Config and resolver support

- [x] 1.1 Remove `engine.type: native` from supported workspace config validation
- [x] 1.2 Remove native-engine resolution branches and imports from the engine resolver
- [x] 1.3 Surface clear migration guidance for workspaces still configured with native

## 2. Obsolete runtime deletion

- [x] 2.1 Delete `src/bun/workflow/*` that only exists for the obsolete native runtime
- [x] 2.2 Delete `src/bun/engine/native/*`
- [x] 2.3 Remove native-only compatibility helpers and tests

## 3. Test and fixture cleanup

- [x] 3.1 Update engine/config tests to use only supported engines
- [x] 3.2 Remove or rewrite fixtures that assume native engine behavior

## 4. Validation

- [x] 4.1 Verify Copilot and Claude still satisfy the shared `ExecutionEngine` contract
- [x] 4.2 Verify unsupported native config fails fast and clearly
