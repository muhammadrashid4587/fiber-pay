# Permission Module Tests

Unit tests for the permission management system at `/packages/runtime/src/permissions/`.

## Test Files

| File | Description | Test Count |
|------|-------------|------------|
| `storage.test.ts` | Storage layer CRUD operations | ~45 tests |
| `limit-tracker.test.ts` | Daily/hourly limits, midnight reset | ~35 tests |
| `manager.test.ts` | Permission manager lifecycle, tokens | ~40 tests |
| `migrator.test.ts` | Database migration system | ~35 tests |

## Running Tests

```bash
# Run all permission tests
bun test packages/runtime/src/permissions/__tests__/

# Run with coverage
bun test --coverage packages/runtime/src/permissions/__tests__/
```

## Test Coverage Areas

### Storage Layer (`storage.test.ts`)
- Grant CRUD: create, read, update, revoke
- Usage tracking: daily/hourly recording
- Whitelist management: recipients, allowed channels
- Edge cases: empty arrays, unicode, large bigints

### Limit Tracker (`limit-tracker.test.ts`)
- Per-payment limit enforcement
- Daily payment amount limits
- Daily count limits
- Hourly count limits
- Combined limit checking
- Midnight reset logic

### Permission Manager (`manager.test.ts`)
- Grant lifecycle: create → approve → revoke
- Permission request parsing
- Token generation (Biscuit)
- Event emission
- Expiration parsing (d/h/m/s)

### Migrator (`migrator.test.ts`)
- Migration discovery and ordering
- Transaction safety
- Applied migration tracking
- Error handling

## Environment Requirements

- **bun** (v1.2.5+)
- **better-sqlite3** (native module, requires recompilation for Bun)
- **@biscuit-auth/biscuit-wasm** (WebAssembly module)

### Known Issues

**better-sqlite3 ABI Mismatch**: If you encounter errors like:
```
The module 'better_sqlite3' was compiled against a different Node.js ABI version
```

Run:
```bash
# Rebuild for current platform
pnpm rebuild better-sqlite3

# Or reinstall
rm -rf node_modules
pnpm install
```

## Test Data

All tests use:
- In-memory SQLite databases (via temp files)
- Mock permission grants with randomized IDs
- Isolated test fixtures per test case
- Automatic cleanup via `afterEach`

## Mocking Strategy

- **Storage**: Real SQLite with temp files
- **Biscuit tokens**: Partial mocking for crypto operations
- **Time**: Date manipulation for limit window testing
