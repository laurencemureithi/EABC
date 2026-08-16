-- ASSETS
CREATE TABLE IF NOT EXISTS assets (
  uid TEXT PRIMARY KEY,
  registered_at TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  section TEXT NOT NULL,
  serial_no TEXT,
  manufacturer TEXT,
  model_number TEXT,
  power_rating TEXT,
  supplier TEXT,
  installation_date TEXT,
  year_of_manufacture TEXT,
  warranty_expiry TEXT,
  technical_notes TEXT,
  status TEXT NOT NULL DEFAULT 'operational',
  criticality TEXT NOT NULL DEFAULT 'A',
  photo_url TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_asset_id ON assets(asset_id);

-- STATUS HISTORY
CREATE TABLE IF NOT EXISTS asset_status_history (
  id TEXT PRIMARY KEY,
  asset_uid TEXT NOT NULL,
  status TEXT NOT NULL,
  from_ts TEXT NOT NULL,
  to_ts TEXT,
  reason TEXT,
  FOREIGN KEY(asset_uid) REFERENCES assets(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ash_asset_uid ON asset_status_history(asset_uid);

-- BREAKDOWNS
CREATE TABLE IF NOT EXISTS breakdowns (
  breakdown_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  reported_dt TEXT NOT NULL,
  incident_title TEXT NOT NULL,
  section TEXT NOT NULL,
  asset_uid TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_serial_no TEXT,
  failure_category TEXT,
  severity TEXT,
  symptoms TEXT,
  technician_name TEXT,
  technician_phone TEXT,
  technician_email TEXT,
  status TEXT NOT NULL,
  notes TEXT,
  duration_mins INTEGER,
  resolved_at TEXT,
  FOREIGN KEY(asset_uid) REFERENCES assets(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_breakdowns_asset_uid ON breakdowns(asset_uid);
CREATE INDEX IF NOT EXISTS idx_breakdowns_status ON breakdowns(status);
CREATE INDEX IF NOT EXISTS idx_breakdowns_reported_dt ON breakdowns(reported_dt);

-- BREAKDOWN MEDIA
CREATE TABLE IF NOT EXISTS breakdown_media (
  id TEXT PRIMARY KEY,
  breakdown_id TEXT NOT NULL,
  file_url TEXT NOT NULL,
  FOREIGN KEY(breakdown_id) REFERENCES breakdowns(breakdown_id) ON DELETE CASCADE
);

-- BREAKDOWN PROGRESS LOG
CREATE TABLE IF NOT EXISTS breakdown_progress (
  id TEXT PRIMARY KEY,
  breakdown_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  status TEXT NOT NULL,
  work_log TEXT,
  labor_hours TEXT,
  findings TEXT,
  FOREIGN KEY(breakdown_id) REFERENCES breakdowns(breakdown_id) ON DELETE CASCADE
);

-- RCA (1:1)
CREATE TABLE IF NOT EXISTS breakdown_rca (
  breakdown_id TEXT PRIMARY KEY,
  primary_root_cause TEXT,
  severity_re_evaluated INTEGER NOT NULL DEFAULT 0,
  why1 TEXT, why2 TEXT, why3 TEXT, why4 TEXT, why5 TEXT,
  corrective TEXT,
  preventive TEXT,
  verified_by TEXT,
  closure_date TEXT,
  saved_at TEXT,
  FOREIGN KEY(breakdown_id) REFERENCES breakdowns(breakdown_id) ON DELETE CASCADE
);

-- MAINTENANCE TASKS
CREATE TABLE IF NOT EXISTS maintenance_tasks (
  task_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  section TEXT NOT NULL,
  asset_uid TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  maintenance_type TEXT NOT NULL,
  frequency TEXT NOT NULL,
  technician TEXT,
  task_description TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  notes TEXT,
  completed_at TEXT,
  completion_notes TEXT,
  FOREIGN KEY(asset_uid) REFERENCES assets(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pm_asset_uid ON maintenance_tasks(asset_uid);
CREATE INDEX IF NOT EXISTS idx_pm_due_date ON maintenance_tasks(due_date);

-- INVENTORY PARTS
CREATE TABLE IF NOT EXISTS inventory_parts (
  uid TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  part_name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  storage_location TEXT NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL,
  lead_time_days INTEGER,
  is_critical INTEGER NOT NULL DEFAULT 0,
  manufacturer TEXT NOT NULL,
  model_number TEXT NOT NULL,
  tech_specs TEXT NOT NULL,
  photo_url TEXT,
  doc_url TEXT
);

CREATE TABLE IF NOT EXISTS inventory_compatible_assets (
  id TEXT PRIMARY KEY,
  part_uid TEXT NOT NULL,
  asset_uid TEXT NOT NULL,
  FOREIGN KEY(part_uid) REFERENCES inventory_parts(uid) ON DELETE CASCADE,
  FOREIGN KEY(asset_uid) REFERENCES assets(uid) ON DELETE CASCADE
);

-- ASSET DOCUMENTS + SPARE PARTS (profile tabs)
CREATE TABLE IF NOT EXISTS asset_documents (
  id TEXT PRIMARY KEY,
  asset_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  FOREIGN KEY(asset_uid) REFERENCES assets(uid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_spare_parts (
  id TEXT PRIMARY KEY,
  asset_uid TEXT NOT NULL,
  part_name TEXT NOT NULL,
  part_no TEXT,
  qty TEXT,
  vendor TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY(asset_uid) REFERENCES assets(uid) ON DELETE CASCADE
);
