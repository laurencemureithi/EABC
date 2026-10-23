-- Migration: 0001_initial_schema.sql
-- Description: Creates the full authoritative production relational schema for EABC / Opsloom

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. COMPANIES / ORGANIZATIONS
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  primary_color TEXT DEFAULT '#7E22CE',
  secondary_color TEXT DEFAULT '#C084FC',
  logo_light_url TEXT,
  logo_dark_url TEXT,
  show_name_next_to_logo BOOLEAN DEFAULT false,
  logo_height INTEGER DEFAULT 44,
  logo_width_pct INTEGER DEFAULT 85,
  logo_alignment TEXT DEFAULT 'left',
  logo_fit TEXT DEFAULT 'contain',
  designation_line_1 TEXT,
  designation_line_2 TEXT,
  designation_line_3 TEXT,
  departments_json TEXT,
  kpi_targets_json TEXT,
  created_at TEXT
);

-- 2. USERS
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  uid TEXT UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password TEXT,
  role TEXT NOT NULL DEFAULT 'Administrator',
  access_scope TEXT DEFAULT 'Full System',
  department TEXT DEFAULT 'Engineering',
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  active BOOLEAN DEFAULT true,
  permissions_json TEXT,
  edit_permissions_json TEXT,
  delete_permissions_json TEXT,
  signature_name TEXT,
  signature_title TEXT,
  signature_font TEXT,
  signature_color TEXT,
  signature_style TEXT,
  signature_image_url TEXT,
  profile_image_url TEXT,
  created_at TEXT
);

-- 3. ASSETS
CREATE TABLE IF NOT EXISTS assets (
  uid TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  section TEXT,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'operational',
  criticality TEXT NOT NULL DEFAULT 'A',
  serial_no TEXT,
  manufacturer TEXT,
  model_number TEXT,
  power_rating TEXT,
  supplier TEXT,
  installation_date TEXT,
  year_of_manufacture TEXT,
  warranty_expiry TEXT,
  technical_notes TEXT,
  category TEXT,
  location TEXT,
  service_provider TEXT,
  asset_value TEXT,
  photo_url TEXT,
  registered_at TEXT,
  created_at TEXT
);

-- 4. BREAKDOWNS & FAILURE INCIDENTS
CREATE TABLE IF NOT EXISTS breakdowns (
  breakdown_id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  asset_uid TEXT,
  asset_id TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  incident_title TEXT NOT NULL,
  section TEXT,
  department TEXT,
  reported_dt TEXT NOT NULL,
  failure_category TEXT,
  severity TEXT,
  symptoms TEXT,
  technician_name TEXT,
  technician_phone TEXT,
  technician_email TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  notes TEXT,
  duration_mins INTEGER,
  resolved_at TEXT,
  created_at TEXT,
  cost_total TEXT DEFAULT '0',
  cost_subtotal TEXT DEFAULT '0',
  cost_vat_pct TEXT DEFAULT '16',
  cost_vat_amount TEXT DEFAULT '0',
  cost TEXT DEFAULT '0',
  downtime_hours TEXT DEFAULT '0',
  rca_json TEXT,
  progress_log_json TEXT,
  media_json TEXT
);

-- 5. MAINTENANCE TASKS
CREATE TABLE IF NOT EXISTS maintenance_tasks (
  task_id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  asset_uid TEXT,
  asset_id TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  maintenance_type TEXT NOT NULL,
  frequency TEXT NOT NULL,
  section TEXT,
  technician TEXT,
  task_title TEXT,
  task_description TEXT,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled',
  priority TEXT NOT NULL DEFAULT 'Medium',
  notes TEXT,
  completed_at TEXT,
  completion_notes TEXT,
  created_at TEXT,
  cost TEXT DEFAULT '0',
  cost_total TEXT DEFAULT '0',
  invoice_url TEXT,
  invoice_name TEXT
);

-- 6. INVENTORY PARTS
CREATE TABLE IF NOT EXISTS inventory_parts (
  uid TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  category TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  storage_location TEXT,
  unit_price TEXT,
  supplier TEXT,
  lead_time_days INTEGER,
  is_critical BOOLEAN DEFAULT false,
  manufacturer TEXT,
  model_number TEXT,
  tech_specs TEXT,
  photo_url TEXT,
  doc_url TEXT,
  created_at TEXT,
  quantity_on_hand INTEGER,
  reorder_level INTEGER,
  unit_cost TEXT
);

-- 7. TECHNICIANS
CREATE TABLE IF NOT EXISTS technicians (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  specialization TEXT,
  status TEXT DEFAULT 'Active',
  department TEXT,
  created_at TEXT
);

-- 8. RECYCLE BIN
CREATE TABLE IF NOT EXISTS recycle_bin (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  entity_type TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  primary_id TEXT NOT NULL,
  deleted_by_name TEXT,
  deleted_by_email TEXT,
  deleted_by_role TEXT,
  deleted_at TEXT NOT NULL,
  deleted_at_iso TEXT,
  record_data TEXT NOT NULL,
  summary TEXT
);

-- 9. AUDIT TRAIL
CREATE TABLE IF NOT EXISTS audit_trail (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  module TEXT NOT NULL,
  href TEXT,
  severity TEXT DEFAULT 'info',
  user_name TEXT,
  user_email TEXT,
  user_role TEXT,
  created_at TEXT
);

-- 10. SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at TEXT
);

-- 11. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  company_id TEXT,
  event_type TEXT NOT NULL,
  entity_module TEXT NOT NULL,
  entity_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  is_read BOOLEAN DEFAULT false,
  is_toasted BOOLEAN DEFAULT false,
  created_at TEXT NOT NULL
);

-- 12. REPORTS
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  name TEXT NOT NULL,
  report_title TEXT,
  category TEXT,
  category_key TEXT,
  department TEXT,
  scope_mode TEXT,
  start_date TEXT,
  end_date TEXT,
  period TEXT,
  format TEXT DEFAULT 'PDF',
  status TEXT DEFAULT 'READY',
  created_at TEXT,
  created_at_fmt TEXT,
  generated_label TEXT,
  user_name TEXT,
  exec_notes TEXT,
  data_json TEXT
);

-- 13. ASSET DOCUMENTS
CREATE TABLE IF NOT EXISTS asset_documents (
  id TEXT PRIMARY KEY,
  uid TEXT,
  asset_uid TEXT NOT NULL,
  company_id TEXT,
  title TEXT NOT NULL,
  doc_name TEXT,
  category TEXT DEFAULT 'Manual',
  version TEXT DEFAULT 'v1.0',
  owner TEXT,
  expiry_date TEXT,
  review_date TEXT,
  description TEXT,
  file_url TEXT,
  uploaded_at TEXT
);

-- 14. ASSET SPARE PARTS
CREATE TABLE IF NOT EXISTS asset_spare_parts (
  id TEXT PRIMARY KEY,
  asset_uid TEXT NOT NULL,
  company_id TEXT,
  part_name TEXT NOT NULL,
  part_number TEXT,
  quantity INTEGER DEFAULT 1,
  criticality TEXT DEFAULT 'A',
  lead_time_days INTEGER DEFAULT 7,
  supplier TEXT,
  created_at TEXT
);

-- 15. INTERNAL MESSAGES
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  folder TEXT DEFAULT 'inbox',
  sender_name TEXT,
  sender_email TEXT,
  recipient_email TEXT,
  subject TEXT NOT NULL,
  content TEXT,
  category TEXT,
  priority TEXT DEFAULT 'Normal',
  is_read BOOLEAN DEFAULT false,
  created_at TEXT
);
