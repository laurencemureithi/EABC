-- Migration: 0002_indexes_and_constraints.sql
-- Description: Adds indexes for tenant isolation, fast filtering, search, and integrity

-- Performance indexes for tenant isolation (company_id filtering)
CREATE INDEX IF NOT EXISTS idx_assets_company_id ON assets(company_id);
CREATE INDEX IF NOT EXISTS idx_assets_asset_id ON assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);

CREATE INDEX IF NOT EXISTS idx_breakdowns_company_id ON breakdowns(company_id);
CREATE INDEX IF NOT EXISTS idx_breakdowns_asset_uid ON breakdowns(asset_uid);
CREATE INDEX IF NOT EXISTS idx_breakdowns_status ON breakdowns(status);
CREATE INDEX IF NOT EXISTS idx_breakdowns_reported_dt ON breakdowns(reported_dt);

CREATE INDEX IF NOT EXISTS idx_maintenance_company_id ON maintenance_tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_asset_uid ON maintenance_tasks(asset_uid);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_tasks(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_due_date ON maintenance_tasks(due_date);

CREATE INDEX IF NOT EXISTS idx_inventory_company_id ON inventory_parts(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory_parts(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_parts(category);

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE INDEX IF NOT EXISTS idx_technicians_company_id ON technicians(company_id);

CREATE INDEX IF NOT EXISTS idx_audit_company_id ON audit_trail(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_trail(created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_user_company ON notifications(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_reports_company_id ON reports(company_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);

CREATE INDEX IF NOT EXISTS idx_asset_docs_asset_uid ON asset_documents(asset_uid);
CREATE INDEX IF NOT EXISTS idx_asset_docs_company_id ON asset_documents(company_id);

CREATE INDEX IF NOT EXISTS idx_asset_spares_asset_uid ON asset_spare_parts(asset_uid);
CREATE INDEX IF NOT EXISTS idx_asset_spares_company_id ON asset_spare_parts(company_id);

CREATE INDEX IF NOT EXISTS idx_messages_company_folder ON messages(company_id, folder);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_company_id ON recycle_bin(company_id);
