import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Represents a discovered migration file
 */
export interface MigrationFile {
  /** Migration version number parsed from filename */
  version: number;
  /** Migration name (filename without extension) */
  name: string;
  /** Raw SQL content of the migration */
  sql: string;
}

/**
 * Manages database migrations for the permission grants system.
 * Reads migration files from the migrations directory and tracks
 * applied migrations in the __migrations table.
 */
export class PermissionMigrator {
  private readonly db: Database.Database;
  private readonly migrationsDir: string;

  /**
   * Creates a new PermissionMigrator instance
   * @param dbPath - Path to the SQLite database file
   * @param migrationsDir - Optional custom migrations directory (defaults to built-in migrations)
   */
  constructor(dbPath: string, migrationsDir?: string) {
    // Ensure parent directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Default to the built-in migrations directory
    if (migrationsDir) {
      this.migrationsDir = migrationsDir;
    } else {
      const currentFile = fileURLToPath(import.meta.url);
      this.migrationsDir = join(dirname(currentFile), 'migrations');
    }
  }

  /**
   * Ensures the __migrations table exists for tracking applied migrations
   */
  ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS __migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        name TEXT NOT NULL
      );
    `);
  }

  /**
   * Returns a list of already applied migration version numbers
   * @returns Array of version numbers
   */
  getAppliedMigrations(): number[] {
    this.ensureMigrationsTable();

    const rows = this.db.prepare('SELECT version FROM __migrations ORDER BY version ASC').all() as {
      version: number;
    }[];

    return rows.map((row) => row.version);
  }

  /**
   * Discovers and returns all migration files from the migrations directory
   * @returns Array of MigrationFile objects sorted by version
   */
  private discoverMigrations(): MigrationFile[] {
    const migrations: MigrationFile[] = [];

    try {
      const files = readdirSync(this.migrationsDir);

      for (const file of files) {
        // Match pattern: digits_*.sql (e.g., 001_initial.sql)
        const match = file.match(/^(\d+)_(.+)\.sql$/);
        if (!match) continue;

        const version = parseInt(match[1], 10);
        const name = basename(file, '.sql');
        const filePath = join(this.migrationsDir, file);
        const sql = readFileSync(filePath, 'utf-8');

        migrations.push({ version, name, sql });
      }
    } catch (error) {
      // If migrations directory doesn't exist, return empty array
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    // Sort by version number
    return migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Returns migrations that have not yet been applied
   * @returns Array of pending MigrationFile objects
   */
  getPendingMigrations(): MigrationFile[] {
    const applied = new Set(this.getAppliedMigrations());
    const allMigrations = this.discoverMigrations();

    return allMigrations.filter((migration) => !applied.has(migration.version));
  }

  /**
   * Runs all pending migrations in order.
   * Each migration is run in a transaction.
   * Failed migrations are NOT recorded and can be retried.
   * @throws Error if a migration fails
   */
  async migrate(): Promise<void> {
    const pending = this.getPendingMigrations();

    if (pending.length === 0) {
      return;
    }

    for (const migration of pending) {
      try {
        // Run migration in a transaction
        this.db.transaction(() => {
          // Execute the migration SQL
          this.db.exec(migration.sql);

          // Record the migration as applied
          // Note: If the migration SQL already includes the INSERT (like 001_initial does),
          // this will be a no-op due to the PRIMARY KEY constraint
          this.db
            .prepare(
              'INSERT OR IGNORE INTO __migrations (version, applied_at, name) VALUES (?, ?, ?)',
            )
            .run(migration.version, Date.now(), migration.name);
        })();
      } catch (error) {
        throw new Error(
          `Migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Closes the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Simple helper function that creates a migrator and runs all pending migrations
 * @param dbPath - Path to the SQLite database file
 * @returns Promise that resolves when migrations complete
 */
export async function migrate(dbPath: string): Promise<void> {
  const migrator = new PermissionMigrator(dbPath);
  try {
    await migrator.migrate();
  } finally {
    migrator.close();
  }
}
