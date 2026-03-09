# Permission Management Migration System

## Created: /packages/runtime/src/permissions/migrator.ts

### Implementation Summary

**PermissionMigrator class** provides database migration management for the permission grants system:

1. **Constructor** (`dbPath: string, migrationsDir?: string`)
   - Creates SQLite database connection with WAL mode and foreign keys enabled
   - Defaults to built-in migrations directory, but supports custom paths
   - Ensures parent directory exists before creating database

2. **ensureMigrationsTable()**: Creates `__migrations` table if not exists
   - version: INTEGER PRIMARY KEY
   - applied_at: INTEGER NOT NULL
   - name: TEXT NOT NULL

3. **getAppliedMigrations()**: Returns list of already applied version numbers
   - Queries __migrations table and returns sorted version numbers

4. **getPendingMigrations()**: Returns migrations not yet applied
   - Discovers all .sql files matching pattern `^\d+_.+\.sql$`
   - Parses version from filename (e.g., 001_initial.sql → version 1)
   - Filters out already applied migrations

5. **migrate()**: Runs all pending migrations in order
   - Each migration runs in a transaction
   - Uses INSERT OR IGNORE to handle migrations that self-record (like 001_initial)
   - Failed migrations throw descriptive errors and are NOT recorded

6. **migrate(dbPath: string)**: Helper function
   - Creates migrator instance, runs migrations, closes connection

### Migration File Discovery
- Pattern: `/^\d+_.+\.sql$/`
- Sorted by version number (numeric sort)
- SQL content read as UTF-8

### Error Handling
- Migration failures throw Error with version, name, and underlying message
- Failed migrations are not recorded → idempotent retry on next run
- ENOENT on migrations directory returns empty array (graceful handling)

### Idempotency
- Re-running migrate() is safe - only pending migrations are applied
- INSERT OR IGNORE prevents duplicate entries for self-recording migrations

### Build Status
- ESM build: ✅ Success
- No TypeScript errors in implementation
- Code follows existing patterns from sqlite-store.ts
