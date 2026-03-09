-- Migration: 001_initial
-- Description: Initial schema for permission grants system
-- Applied: Stores permission grants with usage tracking and recipient/channel whitelists

-- Enable foreign key support
PRAGMA foreign_keys = ON;

-- __migrations table for tracking applied migrations
CREATE TABLE IF NOT EXISTS __migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  name TEXT NOT NULL
);

-- Main table: permission_grants
-- Stores encrypted Biscuit tokens with usage limits and constraints
CREATE TABLE IF NOT EXISTS permission_grants (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  app_name TEXT,
  node_id TEXT NOT NULL,
  token_ciphertext BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  revocation_id TEXT,
  scopes TEXT,
  daily_payment_limit INTEGER,
  per_payment_limit INTEGER,
  daily_count_limit INTEGER,
  hourly_count_limit INTEGER,
  min_interval_seconds INTEGER,
  channel_opening_allowed INTEGER DEFAULT 0,
  channel_funding_limit INTEGER,
  can_close_channels INTEGER DEFAULT 0,
  can_force_close INTEGER DEFAULT 0,
  time_window_start TEXT,
  time_window_end TEXT,
  time_window_days TEXT,
  total_payments_made INTEGER DEFAULT 0,
  total_amount_paid INTEGER DEFAULT 0,
  last_used_at INTEGER,
  status TEXT DEFAULT 'pending'
);

-- Table: permission_usage_daily
-- Tracks daily payment usage per grant
CREATE TABLE IF NOT EXISTS permission_usage_daily (
  grant_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount_paid INTEGER DEFAULT 0,
  payments_count INTEGER DEFAULT 0,
  PRIMARY KEY (grant_id, date),
  FOREIGN KEY (grant_id) REFERENCES permission_grants(id) ON DELETE CASCADE
);

-- Table: permission_usage_hourly
-- Tracks hourly payment count per grant
CREATE TABLE IF NOT EXISTS permission_usage_hourly (
  grant_id TEXT NOT NULL,
  hour TEXT NOT NULL,
  payments_count INTEGER DEFAULT 0,
  PRIMARY KEY (grant_id, hour),
  FOREIGN KEY (grant_id) REFERENCES permission_grants(id) ON DELETE CASCADE
);

-- Table: permission_recipient_whitelist
-- Stores allowed recipients for a permission grant
CREATE TABLE IF NOT EXISTS permission_recipient_whitelist (
  grant_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  PRIMARY KEY (grant_id, recipient),
  FOREIGN KEY (grant_id) REFERENCES permission_grants(id) ON DELETE CASCADE
);

-- Table: permission_allowed_channels
-- Stores allowed channel IDs for a permission grant
CREATE TABLE IF NOT EXISTS permission_allowed_channels (
  grant_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (grant_id, channel_id),
  FOREIGN KEY (grant_id) REFERENCES permission_grants(id) ON DELETE CASCADE
);

-- Indexes for performance
-- Index on node_id for filtering grants by node
CREATE INDEX IF NOT EXISTS idx_permission_grants_node_id ON permission_grants(node_id);

-- Index on app_id for filtering grants by application
CREATE INDEX IF NOT EXISTS idx_permission_grants_app_id ON permission_grants(app_id);

-- Index on revocation_id for efficient revocation lookups
CREATE INDEX IF NOT EXISTS idx_permission_grants_revocation_id ON permission_grants(revocation_id);

-- Index on status for filtering by grant status
CREATE INDEX IF NOT EXISTS idx_permission_grants_status ON permission_grants(status);

-- Index on expires_at for finding expired grants
CREATE INDEX IF NOT EXISTS idx_permission_grants_expires_at ON permission_grants(expires_at);

-- Index on grant_id for usage tables (improves JOIN performance)
CREATE INDEX IF NOT EXISTS idx_usage_daily_grant_id ON permission_usage_daily(grant_id);
CREATE INDEX IF NOT EXISTS idx_usage_hourly_grant_id ON permission_usage_hourly(grant_id);
CREATE INDEX IF NOT EXISTS idx_recipient_whitelist_grant_id ON permission_recipient_whitelist(grant_id);
CREATE INDEX IF NOT EXISTS idx_allowed_channels_grant_id ON permission_allowed_channels(grant_id);

-- Record this migration
INSERT INTO __migrations (version, applied_at, name) VALUES (1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), '001_initial');
