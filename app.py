from __future__ import annotations

import os
import re
import csv
import io
import shutil
import subprocess
import tempfile
import html
import calendar as pycalendar
import time
import mimetypes
from uuid import uuid4
from datetime import datetime, timedelta, date
from typing import Optional
from math import ceil
from functools import wraps
from urllib.parse import urlsplit, urljoin
from secrets import token_urlsafe

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    session,
    abort,
    Response,
    jsonify,
    flash,
    send_file,
    g,
    has_request_context,
)
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash


os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")


def _safe_makedirs(path, mode=0o777, exist_ok=True):
    try:
        os.makedirs(path, mode=mode, exist_ok=exist_ok)
    except OSError:
        pass


# -------------------------
# App setup
# -------------------------
app = Flask(__name__)

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

_safe_makedirs(app.instance_path)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(app.instance_path, "eabc.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)
migrate = Migrate(app, db)

from sqlalchemy import Text
from sqlalchemy.types import JSON

class Asset(db.Model):
    __tablename__ = "assets"
    uid = db.Column(db.String, primary_key=True)          # you already use uid
    asset_id = db.Column(db.String, index=True)
    asset_name = db.Column(db.String, index=True)
    section = db.Column(db.String, index=True)
    department = db.Column(db.String, index=True, default="Engineering")
    status = db.Column(db.String, default="operational")
    serial_no = db.Column(db.String, default="")
    criticality = db.Column(db.String, default="")
    photo_url = db.Column(db.String, default="")

class Breakdown(db.Model):
    __tablename__ = "breakdowns"
    breakdown_id = db.Column(db.String, primary_key=True)
    created_at = db.Column(db.String, index=True)
    reported_dt = db.Column(db.String, index=True)
    incident_title = db.Column(db.String)
    section = db.Column(db.String, index=True)

    asset_uid = db.Column(db.String, db.ForeignKey("assets.uid"), index=True)
    asset_name = db.Column(db.String)
    asset_id = db.Column(db.String)

    asset_serial_no = db.Column(db.String, default="")
    failure_category = db.Column(db.String, default="")
    severity = db.Column(db.String, default="medium")
    symptoms = db.Column(db.String, default="")

    technician_name = db.Column(db.String, default="")
    technician_phone = db.Column(db.String, default="")
    technician_email = db.Column(db.String, default="")

    status = db.Column(db.String, default="open", index=True)
    notes = db.Column(db.String, default="")

    media = db.Column(JSON, default=list)          # list of URLs
    progress_log = db.Column(JSON, default=list)   # list of dicts
    rca = db.Column(JSON, default=dict)            # dict payload

    duration_mins = db.Column(db.Integer, nullable=True)
    resolved_at = db.Column(db.String, nullable=True)

    department = db.Column(db.String, index=True, default="Engineering")

class MaintenanceTask(db.Model):
    __tablename__ = "maintenance_tasks"
    task_id = db.Column(db.String, primary_key=True)
    created_at = db.Column(db.String, index=True)
    created_by = db.Column(db.String, default="")

    section = db.Column(db.String, index=True)
    asset_uid = db.Column(db.String, db.ForeignKey("assets.uid"), index=True)
    asset_name = db.Column(db.String)
    asset_id = db.Column(db.String)

    maintenance_type = db.Column(db.String, default="PM")
    frequency = db.Column(db.String, default="Monthly")
    technician = db.Column(db.String, default="")

    task_description = db.Column(Text, default="")
    due_date = db.Column(db.String, index=True)
    status = db.Column(db.String, default="upcoming", index=True)
    priority = db.Column(db.String, default="medium")

    notes = db.Column(Text, default="")
    completed_at = db.Column(db.String, nullable=True)
    completion_notes = db.Column(Text, nullable=True)

    history = db.Column(JSON, default=list)
    department = db.Column(db.String, index=True, default="Engineering")

class InventoryPart(db.Model):
    __tablename__ = "inventory_parts"
    uid = db.Column(db.String, primary_key=True)
    created_at = db.Column(db.String, index=True)

    part_name = db.Column(db.String, index=True)
    sku = db.Column(db.String, unique=True, index=True)
    category = db.Column(db.String, index=True)
    compatible_assets = db.Column(JSON, default=list)

    qty = db.Column(db.Integer, default=0)
    min_qty = db.Column(db.Integer, default=0)
    storage_location = db.Column(db.String, default="")
    unit_price = db.Column(db.Float, default=0.0)
    supplier = db.Column(db.String, default="")
    lead_time_days = db.Column(db.Integer, nullable=True)
    is_critical = db.Column(db.Boolean, default=False)

    manufacturer = db.Column(db.String, default="")
    model_number = db.Column(db.String, default="")
    tech_specs = db.Column(Text, default="")

    photo_url = db.Column(db.String, nullable=True)
    doc_url = db.Column(db.String, nullable=True)

class ReportExport(db.Model):
    __tablename__ = "report_exports"
    id = db.Column(db.String, primary_key=True)
    name = db.Column(db.String, index=True)
    category = db.Column(db.String, index=True)
    department = db.Column(db.String, index=True)

    user_name = db.Column(db.String, default="")
    user_initials = db.Column(db.String, default="")
    date = db.Column(db.String, default="")

    status = db.Column(db.String, default="READY")
    filename = db.Column(db.String, nullable=True)
    file_size_mb = db.Column(db.Float, nullable=True)
    download_url = db.Column(db.String, nullable=True)
    created_at = db.Column(db.String, index=True)

    send_email = db.Column(db.Boolean, default=False)
    schedule_monthly = db.Column(db.Boolean, default=False)
    include_cover = db.Column(db.Boolean, default=False)

def asset_to_dict(a: Asset) -> dict:
    return dict(
        uid=a.uid,
        asset_id=a.asset_id or "",
        asset_name=a.asset_name or "",
        section=a.section or "",
        department=a.department or "Engineering",
        status=a.status or "operational",
        serial_no=a.serial_no or "",
        criticality=a.criticality or "",
        photo_url=a.photo_url or "",
    )

def breakdown_to_dict(b: Breakdown) -> dict:
    return dict(
        breakdown_id=b.breakdown_id,
        created_at=b.created_at,
        reported_dt=b.reported_dt,
        incident_title=b.incident_title or "",
        section=b.section or "",
        asset_uid=b.asset_uid,
        asset_name=b.asset_name or "",
        asset_id=b.asset_id or "",
        asset_serial_no=b.asset_serial_no or "",
        failure_category=b.failure_category or "",
        severity=b.severity or "medium",
        symptoms=b.symptoms or "",
        technician_name=b.technician_name or "",
        technician_phone=b.technician_phone or "",
        technician_email=b.technician_email or "",
        status=b.status or "open",
        notes=b.notes or "",
        media=b.media or [],
        progress_log=b.progress_log or [],
        rca=b.rca or {},
        duration_mins=b.duration_mins,
        resolved_at=b.resolved_at,
        department=b.department or "Engineering",
    )

# Secret key (env first, persistent local fallback)
def _load_or_create_secret_key() -> str:
    env_key = (os.environ.get("FLASK_SECRET_KEY") or "").strip()
    if env_key:
        return env_key
    secret_path = os.path.join(app.instance_path, ".secret_key")
    try:
        if os.path.exists(secret_path):
            with open(secret_path, "r", encoding="utf-8") as f:
                existing = (f.read() or "").strip()
                if existing:
                    return existing
    except Exception:
        pass
    generated = token_urlsafe(48)
    try:
        with open(secret_path, "w", encoding="utf-8") as f:
            f.write(generated)
        try:
            os.chmod(secret_path, 0o600)
        except Exception:
            pass
    except Exception:
        return generated
    return generated

app.secret_key = _load_or_create_secret_key()

# Cookie defaults
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = (os.environ.get("FLASK_ENV") == "production" or os.environ.get("OPSLOOM_FORCE_SECURE_COOKIE") == "1")
app.config["SESSION_COOKIE_NAME"] = os.environ.get("OPSLOOM_SESSION_COOKIE", "opsloom_session")

# 3.1 Config constants
DOWNTIME_COST_PER_HOUR = float(os.environ.get("DOWNTIME_COST_PER_HOUR", "3500"))  # adjust to your reality
UPTIME_TARGET = float(os.environ.get("UPTIME_TARGET", "99.5"))

# Total request cap
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024  # 30MB total request cap

AUTH_PUBLIC_ENDPOINTS = {"static", "login", "login_submit", "login_google", "request_credentials", "forgot_password"}
LOGIN_ATTEMPTS: dict[str, list[datetime]] = {}
LOGIN_RATE_WINDOW_SECONDS = int(os.environ.get("OPSLOOM_LOGIN_RATE_WINDOW_SECONDS", "900"))
LOGIN_RATE_MAX_ATTEMPTS = int(os.environ.get("OPSLOOM_LOGIN_RATE_MAX_ATTEMPTS", "6"))
LOGIN_RATE_LOCK_SECONDS = int(os.environ.get("OPSLOOM_LOGIN_RATE_LOCK_SECONDS", "900"))


def _client_identity() -> str:
    forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    return forwarded or (request.remote_addr or "unknown")


def _login_rate_key(email: str) -> str:
    return f"{_client_identity()}|{(email or '').strip().lower()}"


def _login_locked(email: str) -> bool:
    key = _login_rate_key(email)
    now = datetime.utcnow()
    attempts = [ts for ts in LOGIN_ATTEMPTS.get(key, []) if (now - ts).total_seconds() <= LOGIN_RATE_LOCK_SECONDS]
    LOGIN_ATTEMPTS[key] = attempts
    return len(attempts) >= LOGIN_RATE_MAX_ATTEMPTS


def _record_login_failure(email: str) -> None:
    key = _login_rate_key(email)
    now = datetime.utcnow()
    recent = [ts for ts in LOGIN_ATTEMPTS.get(key, []) if (now - ts).total_seconds() <= LOGIN_RATE_WINDOW_SECONDS]
    recent.append(now)
    LOGIN_ATTEMPTS[key] = recent


def _clear_login_failures(email: str) -> None:
    LOGIN_ATTEMPTS.pop(_login_rate_key(email), None)


def _safe_next_url(target: str) -> str:
    target = (target or "").strip()
    if not target:
        return ""
    parts = urlsplit(target)
    if parts.scheme or parts.netloc:
        return ""
    if not target.startswith("/"):
        return ""
    return target


# -------------------------
# Data (demo / in-memory)
# -------------------------
DEPARTMENTS = ["Engineering", "HR", "Logistics & Warehousing", "Business Development", "Production"]
SECTIONS = ["Acaricide", "Nutraceuticals", "Pharma", "Seeds", "Premises"]

FAILURE_CATEGORIES = ["Mechanical", "Electrical", "Control System", "Utility"]
TECHNICIANS = ["David Kimani", "Sarah Njeri", "James Omondi", "Faith Mumbua"]

# Uploads (images)
ASSET_UPLOAD_DIR = os.path.join(app.root_path, "static", "uploads", "assets")
BREAKDOWN_UPLOAD_DIR = os.path.join(app.root_path, "static", "uploads", "breakdowns")
_safe_makedirs(ASSET_UPLOAD_DIR)
_safe_makedirs(BREAKDOWN_UPLOAD_DIR)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
MAX_FILE_BYTES = 5 * 1024 * 1024  # 5MB per image

# Uploads (documents)
ASSET_DOC_UPLOAD_DIR = os.path.join(app.root_path, "static", "uploads", "asset_docs")
_safe_makedirs(ASSET_DOC_UPLOAD_DIR)

# Uploads (inventory parts)
INVENTORY_UPLOAD_DIR = os.path.join(app.root_path, "static", "uploads", "parts")
INVENTORY_DOC_UPLOAD_DIR = os.path.join(app.root_path, "static", "uploads", "part_docs")
MESSAGE_UPLOAD_DIR = os.path.join(app.root_path, "static", "uploads", "messages")
USER_PROFILE_UPLOAD_DIR = os.path.join(app.root_path, "static", "uploads", "users")
_safe_makedirs(INVENTORY_UPLOAD_DIR)
_safe_makedirs(INVENTORY_DOC_UPLOAD_DIR)
_safe_makedirs(MESSAGE_UPLOAD_DIR)
_safe_makedirs(USER_PROFILE_UPLOAD_DIR)

INVENTORY_CATEGORIES = ["Electrical", "Mechanical", "Control", "Pneumatic", "Power Transmission"]

DOC_ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "xls", "xlsx", "csv", "png", "jpg", "jpeg", "webp"}
DOC_MAX_FILE_BYTES = 10 * 1024 * 1024  # 10MB per doc

# In-memory stores (no DB yet)
ASSETS: list[dict] = []
BREAKDOWNS: list[dict] = []
MAINTENANCE_TASKS: list[dict] = []
INVENTORY_PARTS: list[dict] = []
# -------------------------
# Reports (in-memory exports)
# -------------------------
REPORT_EXPORT_DIR = os.path.join(app.root_path, "static", "exports", "reports")
BRAND_DIR = os.path.join(app.root_path, "static", "brand")
ULTRAVETIS_LOGO = os.path.join(BRAND_DIR, "ultravetis_logo.png")
ULTRAVETIS_HEADER = os.path.join(BRAND_DIR, "ultravetis_header.png")  # optional

ULTRAVETIS_ADDRESS_LINES = [
    "Shanghai Road, Nairobi, Kenya",
    "Zip Code 00100",
    "Email: opsloom.ke@gmail.com",
]
_safe_makedirs(REPORT_EXPORT_DIR)

REPORT_EXPORTS: list[dict] = []
AUDIT_TRAIL: list[dict] = []
INTERNAL_MESSAGES: list[dict] = []
DRAFT_MESSAGES: list[dict] = []
OUTBOX_MESSAGES: list[dict] = []


def default_system_settings() -> dict:
    return {
        "mail_signature_name": "Engineering Reliability Office",
        "mail_signature_title": "Opsloom Reports Automation",
        "mail_signature_footer": "Opsloom",
        "mail_signature_font": "Inter",
        "mail_signature_color": "#1554FF",
        "mail_signature_style": "formal",
        "mail_signature_image_url": "",
        "default_report_recipients": ["opsloom.ke@gmail.com"],
        "smtp_host": "",
        "smtp_port": 587,
        "smtp_user": "",
        "smtp_pass": "",
        "smtp_from": "",
        "report_watermark": "Internal Use",
        "company_contact_email": "opsloom.ke@gmail.com",
        "company_contact_phone": "+254 20 2358205",
        "password_reset_help": "Contact Opsloom support or your system administrator to reset your password.",
    }


def default_notifications() -> list[dict]:
    now = datetime.now()
    return [
        {
            "id": "notif-system-stable",
            "title": "System stable",
            "message": "All core Opsloom modules are available and responsive.",
            "kind": "success",
            "created_at": now.isoformat(timespec="seconds"),
            "is_read": False,
            "href": "/dashboard",
            "should_toast": False,
        },
        {
            "id": "notif-low-stock-review",
            "title": "Review low stock parts",
            "message": "Inventory alerts are available for immediate replenishment decisions.",
            "kind": "warning",
            "created_at": (now - timedelta(hours=2)).isoformat(timespec="seconds"),
            "is_read": False,
            "href": "/inventory",
            "should_toast": True,
        },
    ]


def default_internal_messages() -> list[dict]:
    now = datetime.now().isoformat(timespec="seconds")
    return [
        {
            "id": "msg-welcome-admin",
            "thread_id": "thread-welcome-admin",
            "sender_email": "opsloom.ke@gmail.com",
            "sender_name": "Opsloom System",
            "recipient_emails": ["opsloom.ke@gmail.com"],
            "subject": "Welcome to the Opsloom workspace",
            "body": "Your administrator workspace is ready. Use Admin Credentials & Users to control access, messages, and audit visibility.",
            "attachments": [],
            "created_at": now,
            "is_read_by": [],
            "forwarded_from": "",
            "delivery_status": "sent",
            "sent_at": now,
        }
    ]


def default_draft_messages() -> list[dict]:
    return []


def default_outbox_messages() -> list[dict]:
    return []


def default_technician_directory() -> list[dict]:
    base = [
        ("David Kimani", "Mechanical Technician", "Mechanical", "+254700000101", "david.kimani@opsloom.co.ke"),
        ("Sarah Njeri", "Electrical Technician", "Electrical", "+254700000102", "sarah.njeri@opsloom.co.ke"),
        ("James Omondi", "Maintenance Planner", "Planning", "+254700000103", "james.omondi@opsloom.co.ke"),
        ("Faith Mumbua", "Instrumentation Technician", "Controls", "+254700000104", "faith.mumbua@opsloom.co.ke"),
    ]
    out = []
    for idx, (name, role, discipline, phone, email) in enumerate(base, start=1):
        out.append({
            "id": f"TECH-{idx:03d}",
            "name": name,
            "role": role,
            "discipline": discipline,
            "phone": phone,
            "email": email,
            "active": True,
        })
    return out


ROLE_PERMISSION_PRESETS = {
    "Administrator": ["dashboard", "assets", "breakdowns", "maintenance", "inventory", "reports", "settings_manage", "users_manage", "notifications_manage", "technicians_manage"],
    "Engineering Manager": ["dashboard", "assets", "breakdowns", "maintenance", "inventory", "reports", "settings_manage", "notifications_manage", "technicians_manage"],
    "Supervisor": ["dashboard", "assets", "breakdowns", "maintenance", "inventory", "reports"],
    "Viewer": ["dashboard", "assets", "reports"],
}


def default_permissions_for_role(role: str) -> list[str]:
    role = (role or "Viewer").strip()
    return list(ROLE_PERMISSION_PRESETS.get(role, ROLE_PERMISSION_PRESETS["Viewer"]))


def default_admin_users() -> list[dict]:
    return [
        {
            "id": "USR-001",
            "name": "Laurence Magondu",
            "email": "opsloom.ke@gmail.com",
            "role": "Administrator",
            "access_scope": "Full System",
            "department": "Engineering",
            "active": True,
            "password_hash": generate_password_hash("Admin@123"),
            "permissions": default_permissions_for_role("Administrator"),
            "signature_name": "Laurence Magondu",
            "signature_title": "Administrator",
            "signature_font": "Inter",
            "signature_color": "#1554FF",
            "signature_style": "formal",
            "signature_image_url": "",
            "profile_image_url": "",
        }
    ]


SYSTEM_SETTINGS: dict = default_system_settings()
SYSTEM_NOTIFICATIONS: list[dict] = default_notifications()
TECHNICIAN_DIRECTORY: list[dict] = default_technician_directory()
ADMIN_USERS: list[dict] = default_admin_users()
INTERNAL_MESSAGES: list[dict] = default_internal_messages()
DRAFT_MESSAGES: list[dict] = default_draft_messages()
OUTBOX_MESSAGES: list[dict] = default_outbox_messages()
AUDIT_TRAIL: list[dict] = []


def _normalize_user_record(row: dict) -> dict:
    out = dict(row or {})
    out.setdefault("role", "Viewer")
    out.setdefault("access_scope", "Department")
    out.setdefault("department", "Engineering")
    out.setdefault("active", True)
    perms = out.get("permissions")
    if not isinstance(perms, list) or not perms:
        perms = default_permissions_for_role(out.get("role") or "Viewer")
    out["permissions"] = sorted(set([str(x).strip() for x in perms if str(x).strip()]))
    out.setdefault("signature_name", out.get("name") or "")
    out.setdefault("signature_title", out.get("role") or "")
    out.setdefault("signature_font", SYSTEM_SETTINGS.get("mail_signature_font") or "Inter")
    out.setdefault("signature_color", SYSTEM_SETTINGS.get("mail_signature_color") or "#1554FF")
    out.setdefault("signature_style", SYSTEM_SETTINGS.get("mail_signature_style") or "formal")
    out.setdefault("signature_image_url", SYSTEM_SETTINGS.get("mail_signature_image_url") or "")
    out.setdefault("profile_image_url", "")
    raw_password = str(out.pop("password", "") or "").strip()
    if raw_password and not out.get("password_hash"):
        out["password_hash"] = generate_password_hash(raw_password)
    return out


def _current_user_record() -> dict | None:
    if not ADMIN_USERS:
        return None
    user_id = (session.get("user_id") or "").strip()
    email = (session.get("user_email") or "").strip().lower()
    if user_id:
        row = next((u for u in ADMIN_USERS if (u.get("id") or "") == user_id), None)
        if row:
            return _normalize_user_record(row)
    if email:
        row = next((u for u in ADMIN_USERS if (u.get("email") or "").strip().lower() == email), None)
        if row:
            return _normalize_user_record(row)
    return _normalize_user_record(ADMIN_USERS[0])


def _current_user_permissions() -> list[str]:
    row = _current_user_record()
    return list((row or {}).get("permissions") or [])


def user_has_permission(permission: str) -> bool:
    if not permission:
        return True
    perms = set(_current_user_permissions())
    return "settings_manage" in perms or permission in perms


def permission_required(permission: str):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not session.get("user_id"):
                return redirect(url_for("login", next=request.path))
            if not user_has_permission(permission):
                flash("You do not have access to that area.", "error")
                return redirect(url_for("dashboard"))
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def refresh_technician_names():
    global TECHNICIANS
    names = []
    for row in TECHNICIAN_DIRECTORY:
        if row.get("active", True) and (row.get("name") or "").strip():
            names.append((row.get("name") or "").strip())
    TECHNICIANS = sorted(set(names)) or ["Unassigned"]




def _dateish(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    return parse_date_only(str(value))


def technician_workload_snapshot(dept: str | None = None) -> list[dict]:
    dept = (dept or get_current_department() or "Engineering").strip() or "Engineering"
    active_breakdown_statuses = {"open", "in_progress", "on_hold"}
    tech_index: dict[str, dict] = {}

    for row in TECHNICIAN_DIRECTORY:
        if not row.get("active", True):
            continue
        name = (row.get("name") or "").strip()
        if not name:
            continue
        tech_index[name] = {
            "id": row.get("id"),
            "name": name,
            "role": row.get("role") or "Technician",
            "discipline": row.get("discipline") or "General",
            "phone": row.get("phone") or "",
            "email": row.get("email") or "",
            "active": bool(row.get("active", True)),
        }

    for name in TECHNICIANS:
        n = (name or "").strip()
        if n and n not in tech_index:
            tech_index[n] = {
                "id": f"LEGACY-{re.sub(r'[^A-Za-z0-9]+','', n).upper()[:12] or uuid4().hex[:8]}",
                "name": n,
                "role": "Technician",
                "discipline": "General",
                "phone": "",
                "email": "",
                "active": True,
            }

    today = datetime.now().date()
    in_7 = today + timedelta(days=7)
    dept_tasks = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]
    visible_open_tasks = _visible_management_tasks(dept_tasks, status_filter="")
    rows: list[dict] = []
    for info in tech_index.values():
        name = info["name"]
        assigned_tasks = [t for t in dept_tasks if ((t.get("technician") or "").strip() == name)]
        assigned_open_visible = [t for t in visible_open_tasks if ((t.get("technician") or "").strip() == name)]
        assigned_breakdowns = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept and ((b.get("technician_name") or "").strip() == name)]
        open_pm = overdue_pm = due_soon = completed_count = on_time_count = 0
        completion_spans = []
        recent_work = []
        for t in assigned_tasks:
            st = (t.get("status") or "").strip().lower()
            due = _dateish(t.get("due_date"))
            created = _dateish(t.get("created_at"))
            completed = _dateish(t.get("completed_at"))
            title = (t.get("task_title") or t.get("task_description") or "Maintenance Task").strip()
            recent_work.append({
                "kind": "PM",
                "title": title,
                "status": st or "upcoming",
                "date": completed or due or created,
                "task_id": t.get("task_id") or "",
            })
            if st in ("completed", "complete", "done"):
                completed_count += 1
                if due and completed and completed <= due:
                    on_time_count += 1
                if created and completed:
                    try:
                        completion_spans.append(max(0, (completed - created).days))
                    except Exception:
                        pass
        for t in assigned_open_visible:
            due = _dateish(t.get("due_date"))
            open_pm += 1
            if due and due < today:
                overdue_pm += 1
            if due and today <= due <= in_7:
                due_soon += 1
        active_breakdowns = resolved_count = 0
        for b in assigned_breakdowns:
            st = (b.get("status") or "").strip().lower()
            reported = _dateish(b.get("reported_dt") or b.get("created_at"))
            resolved = _dateish(b.get("resolved_at"))
            title = (b.get("incident_title") or "Breakdown Incident").strip()
            recent_work.append({
                "kind": "BD",
                "title": title,
                "status": st or "open",
                "date": resolved or reported,
                "breakdown_id": b.get("breakdown_id") or "",
            })
            if st in active_breakdown_statuses:
                active_breakdowns += 1
            elif st == "resolved":
                resolved_count += 1
        recent_work.sort(key=lambda x: (x.get("date") or date.min), reverse=True)
        on_time_rate = round((on_time_count / completed_count) * 100.0, 1) if completed_count else None
        avg_completion_days = round(sum(completion_spans) / len(completion_spans), 1) if completion_spans else None
        total_load = int(open_pm + active_breakdowns)
        availability_score = max(0, 100 - (open_pm * 12) - (active_breakdowns * 18) - (overdue_pm * 15))
        row = dict(info)
        row.update(
            open_pm=int(open_pm), active_breakdowns=int(active_breakdowns), due_soon=int(due_soon), overdue_pm=int(overdue_pm),
            completed_count=int(completed_count), resolved_breakdowns=int(resolved_count), on_time_rate=on_time_rate,
            avg_completion_days=avg_completion_days, total_load=total_load, availability_score=int(availability_score), recent_work=recent_work[:6]
        )
        rows.append(row)
    rows.sort(key=lambda x: (x.get("total_load", 0), -x.get("availability_score", 0)), reverse=True)
    return rows


def technician_recommendations(limit: int = 3, dept: str | None = None) -> list[dict]:
    rows = technician_workload_snapshot(dept)
    rows.sort(key=lambda x: (x.get("availability_score", 0), -(x.get("total_load", 0)), -(x.get("on_time_rate") or 0.0)), reverse=True)
    out = []
    for row in rows[:limit]:
        load = row.get("total_load", 0)
        flag = "available" if load <= 1 else ("balanced" if load <= 3 else "high")
        meta = f"{row.get('open_pm', 0)} open PM • {row.get('active_breakdowns', 0)} active BD • {row.get('availability_score', 0)}% availability"
        out.append(dict(row, short=row.get("name"), initials=initials(row.get("name") or "") or "NA", meta=meta, flag=flag))
    return out


def technician_profile_payload(tech_id_or_name: str, dept: str | None = None) -> dict | None:
    key = (tech_id_or_name or "").strip().lower()
    if not key:
        return None
    row = next((r for r in technician_workload_snapshot(dept) if (r.get("id") or "").strip().lower() == key or (r.get("name") or "").strip().lower() == key), None)
    if not row:
        return None
    status_label = "Available" if row.get("total_load", 0) <= 1 else ("Balanced" if row.get("total_load", 0) <= 3 else "High Load")
    recent = []
    for item in row.get("recent_work") or []:
        href = ""
        if item.get("task_id"):
            href = url_for("maintenance_view", task_id=item.get("task_id"))
        elif item.get("breakdown_id"):
            href = url_for("breakdowns_view", breakdown_id=item.get("breakdown_id"))
        recent.append({
            "kind": item.get("kind"),
            "title": item.get("title"),
            "status": item.get("status"),
            "date": item.get("date").isoformat() if hasattr(item.get("date"), 'isoformat') else "",
            "href": href,
        })
    return {
        "id": row.get("id"), "name": row.get("name"), "role": row.get("role"), "discipline": row.get("discipline"),
        "phone": row.get("phone"), "email": row.get("email"), "availability_score": row.get("availability_score"),
        "status_label": status_label, "open_pm": row.get("open_pm"), "active_breakdowns": row.get("active_breakdowns"),
        "due_soon": row.get("due_soon"), "overdue_pm": row.get("overdue_pm"), "completed_count": row.get("completed_count"),
        "resolved_breakdowns": row.get("resolved_breakdowns"), "on_time_rate": row.get("on_time_rate"), "avg_completion_days": row.get("avg_completion_days"),
        "recent_work": recent,
    }


def unread_notifications_count() -> int:
    return sum(1 for n in SYSTEM_NOTIFICATIONS if not n.get("is_read"))


def unread_messages_count() -> int:
    email = (session.get("user_email") or "").strip().lower()
    if not email:
        return 0
    count = 0
    for m in INTERNAL_MESSAGES:
        recips = [str(x).strip().lower() for x in (m.get("recipient_emails") or []) if str(x).strip()]
        if email in recips and email not in {str(x).strip().lower() for x in (m.get("is_read_by") or []) if str(x).strip()}:
            count += 1
    return count


def log_audit(action: str, detail: str, module: str = "general", href: str | None = None, severity: str = "info"):
    user = _current_user_record() or {}
    AUDIT_TRAIL.insert(0, {
        "id": uuid4().hex,
        "action": (action or "System event").strip(),
        "detail": (detail or "").strip(),
        "module": (module or "general").strip(),
        "severity": (severity or "info").strip().lower(),
        "href": href or "",
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "user_name": user.get("name") or session.get("user_email") or "System",
        "user_email": user.get("email") or session.get("user_email") or "",
        "department": get_current_department() if session.get("user_id") else "Engineering",
        "request_path": request.path if request else "",
    })
    del AUDIT_TRAIL[300:]


def _toast_default(title: str, message: str, kind: str) -> bool:
    title_l = (title or "").strip().lower()
    msg_l = (message or "").strip().lower()
    if kind in ("error", "warning"):
        return True
    if any(k in title_l for k in ["report generated", "message received", "credential request", "password reset", "system alert"]):
        return True
    if "action required" in msg_l or "failed" in msg_l:
        return True
    return False


def push_notification(title: str, message: str, kind: str = "info", href: str | None = None, *, toast: bool | None = None, module: str = "general"):
    if has_request_context():
        setattr(g, "_notification_emitted", True)
    SYSTEM_NOTIFICATIONS.insert(0, {
        "id": uuid4().hex,
        "title": title.strip() or "System update",
        "message": message.strip() or "An update is available.",
        "kind": (kind or "info").strip().lower(),
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "is_read": False,
        "href": href or "",
        "should_toast": _toast_default(title, message, kind) if toast is None else bool(toast),
    })
    del SYSTEM_NOTIFICATIONS[120:]
    log_audit(title, message, module=module, href=href, severity=kind)


def _build_message_record(sender_email: str, sender_name: str, recipient_emails: list[str], subject: str, body: str, attachments: list[dict] | None = None, thread_id: str | None = None, forwarded_from: str = "", delivery_status: str = "draft") -> dict:
    recips = []
    seen = set()
    for e in recipient_emails or []:
        key = str(e or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        recips.append(key)
    now = datetime.now().isoformat(timespec="seconds")
    return {
        "id": uuid4().hex,
        "thread_id": thread_id or uuid4().hex,
        "sender_email": (sender_email or "opsloom.ke@gmail.com").strip().lower(),
        "sender_name": (sender_name or "System").strip(),
        "recipient_emails": recips,
        "subject": (subject or "").strip() or "Untitled message",
        "body": (body or "").strip(),
        "attachments": attachments or [],
        "created_at": now,
        "updated_at": now,
        "sent_at": now if delivery_status == "sent" else "",
        "is_read_by": [],
        "forwarded_from": forwarded_from or "",
        "delivery_status": delivery_status,
    }


def _message_folder_counts(email: str) -> dict:
    email = (email or "").strip().lower()
    inbox = 0
    sent = 0
    drafts = 0
    outbox = 0
    unread = 0
    for m in INTERNAL_MESSAGES:
        recips = [str(x).strip().lower() for x in (m.get("recipient_emails") or []) if str(x).strip()]
        sender = (m.get("sender_email") or "").strip().lower()
        if email in recips:
            inbox += 1
            if email not in {str(x).strip().lower() for x in (m.get("is_read_by") or []) if str(x).strip()}:
                unread += 1
        if email and email == sender:
            sent += 1
    drafts = sum(1 for m in DRAFT_MESSAGES if (m.get("sender_email") or "").strip().lower() == email)
    outbox = sum(1 for m in OUTBOX_MESSAGES if (m.get("sender_email") or "").strip().lower() == email)
    return {"inbox": inbox, "sent": sent, "drafts": drafts, "outbox": outbox, "unread": unread}


def _message_module_label() -> str:
    seg = (request.path.strip("/").split("/")[:1] or ["system"])[0]
    seg = (seg or "system").replace("-", " ").replace("_", " ").strip().title()
    return seg or "System"


def _should_auto_alert(response) -> bool:
    if not has_request_context():
        return False
    if response.status_code >= 400 or not session.get("user_id"):
        return False
    if getattr(g, "_notification_emitted", False):
        return False
    endpoint = (request.endpoint or "").strip()
    path = (request.path or "").strip().lower()
    if endpoint in {"static", "login", "login_submit", "login_google"}:
        return False
    if endpoint.startswith("notifications") or path.startswith("/notifications"):
        return False
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        return True
    return request.method == "GET" and (str(request.args.get("print") or "").strip().lower() in ("1", "true", "yes") or str(request.args.get("autoprint") or "").strip().lower() in ("1", "true", "yes"))


def _emit_auto_alert():
    endpoint = (request.endpoint or "").lower()
    path = request.path.lower()
    module_label = _message_module_label()
    if request.method == "GET" and (str(request.args.get("print") or "").strip().lower() in ("1", "true", "yes") or str(request.args.get("autoprint") or "").strip().lower() in ("1", "true", "yes")):
        push_notification("Print preview ready", f"{module_label} print preview is ready.", "info", href=request.path, toast=True, module=endpoint.split(".")[0] if endpoint else "general")
        return
    if request.method == "DELETE" or "delete" in endpoint or "/delete" in path:
        action, kind = "deleted", "warning"
    elif any(k in endpoint or k in path for k in ["update", "edit", "toggle", "complete", "resolve", "mark", "respond"]):
        action, kind = "updated", "info"
    elif any(k in endpoint or k in path for k in ["send", "create", "add", "new", "schedule", "generate", "submit", "save"]):
        action, kind = "saved", "success"
    else:
        action, kind = "completed", "info"
    push_notification(f"{module_label} action recorded", f"{module_label} {action} successfully.", kind, href=request.referrer or request.path, toast=True, module=endpoint.split(".")[0] if endpoint else "general")


def push_internal_message(sender_email: str, sender_name: str, recipient_emails: list[str], subject: str, body: str, attachments: list[dict] | None = None, thread_id: str | None = None, forwarded_from: str = "") -> dict:
    msg = _build_message_record(sender_email, sender_name, recipient_emails, subject, body, attachments=attachments, thread_id=thread_id, forwarded_from=forwarded_from, delivery_status="sent")
    INTERNAL_MESSAGES.insert(0, msg)
    del INTERNAL_MESSAGES[500:]
    for recip in (msg.get("recipient_emails") or []):
        push_notification("Message received", f"{msg['sender_name']} sent: {msg['subject']}", "info", href=url_for("messages_center", folder="inbox", open=msg["id"]), toast=True, module="messages")
    return msg


def _normalize_percentage(val, default=16.0) -> float:
    try:
        v = float(str(val or "").replace("%", "").strip())
        return max(0.0, min(100.0, v))
    except Exception:
        return float(default)


def _extract_numbers_from_text(text: str) -> list[float]:
    nums = []
    for raw in re.findall(r"\d+[\d,]*\.?\d*", str(text or "")):
        try:
            nums.append(float(raw.replace(",", "")))
        except Exception:
            pass
    return nums


def _invoice_cost_guess(file_storage) -> dict:
    if not file_storage or not getattr(file_storage, "filename", ""):
        return {"subtotal": None, "vat_pct": None, "vat_amount": None, "total": None, "filename": ""}
    try:
        payload = file_storage.read()
        file_storage.stream.seek(0)
    except Exception:
        return {"subtotal": None, "vat_pct": None, "vat_amount": None, "total": None, "filename": secure_filename(file_storage.filename or "")}
    text = ""
    try:
        text = payload.decode("utf-8", errors="ignore")
    except Exception:
        text = ""
    nums = sorted(_extract_numbers_from_text(text), reverse=True)
    total = nums[0] if nums else None
    vat_amount = None
    subtotal = None
    vat_pct = None
    if total is not None and len(nums) >= 2:
        subtotal = nums[1]
        vat_amount = max(0.0, round(total - subtotal, 2))
        if subtotal > 0:
            vat_pct = round((vat_amount / subtotal) * 100.0, 2)
    return {"subtotal": subtotal, "vat_pct": vat_pct, "vat_amount": vat_amount, "total": total, "filename": secure_filename(file_storage.filename or "")}


def _compute_cost_fields(subtotal_raw, apply_vat_raw, vat_pct_raw, invoice_guess: dict | None = None) -> dict:
    subtotal = _safe_float(subtotal_raw, None)
    apply_vat = str(apply_vat_raw or "off").strip().lower() in ("1", "true", "yes", "on")
    vat_pct = _normalize_percentage(vat_pct_raw, 16.0)
    if invoice_guess and subtotal is None and invoice_guess.get("subtotal") is not None:
        subtotal = _safe_float(invoice_guess.get("subtotal"), None)
    if invoice_guess and not apply_vat and invoice_guess.get("vat_amount"):
        apply_vat = True
    if invoice_guess and invoice_guess.get("vat_pct") is not None:
        vat_pct = _normalize_percentage(invoice_guess.get("vat_pct"), vat_pct)
    if subtotal is None and invoice_guess and invoice_guess.get("total") is not None and not apply_vat:
        subtotal = _safe_float(invoice_guess.get("total"), None)
    vat_amount = round((subtotal or 0.0) * vat_pct / 100.0, 2) if apply_vat and subtotal is not None else 0.0
    total_cost = round((subtotal or 0.0) + vat_amount, 2) if subtotal is not None else None
    return {
        "cost_subtotal": subtotal,
        "cost_apply_vat": apply_vat,
        "cost_vat_pct": vat_pct,
        "cost_vat_amount": vat_amount if subtotal is not None else None,
        "cost_total": total_cost,
    }


def _task_cost_counts_for_reporting(task: dict) -> bool:
    if task is None:
        return False
    subtotal = _safe_float(task.get("cost_subtotal"), None)
    total = _safe_float(task.get("cost_total"), None)
    if subtotal is None and total is None:
        return False
    status = (task.get("status") or "").strip().lower()
    if status in {"completed", "done", "closed"}:
        return True
    if bool(task.get("cost_collected")):
        return True
    try:
        series_position = int(task.get("series_position") or 0)
    except Exception:
        series_position = 0
    if series_position > 1 and str(task.get("schedule_group_id") or "").strip():
        return False
    return True


def _task_cost_value(task: dict, key: str, default=0.0):
    if not _task_cost_counts_for_reporting(task):
        return default
    return _safe_float(task.get(key), default)


def metric_catalog() -> dict:
    return {
        "asset_reliability": [
            ("mtbf", "Mean Time Between Failures (MTBF)"),
            ("mttr", "Mean Time To Repair (MTTR)"),
            ("availability", "Operational Availability %"),
            ("downtime", "Unscheduled Downtime (hrs)"),
            ("failure_rate", "Failure Rate"),
            ("health_score", "Asset Health Score"),
        ],
        "breakdown_analytics": [
            ("incidents", "Total Incidents"),
            ("downtime", "Total Downtime (hrs)"),
            ("mttr", "Mean Time To Repair (MTTR)"),
            ("loss_estimate", "Estimated Production Loss"),
            ("root_cause", "Root Cause Distribution"),
            ("heatmap", "Breakdown Heatmap"),
        ],
        "maintenance_compliance": [
            ("pm_adherence", "PM Schedule Adherence"),
            ("sop_validation", "SOP Validation Score"),
            ("audit_readiness", "Audit Readiness"),
            ("technician_ranking", "Technician Compliance Ranking"),
            ("critical_gaps", "Critical Audit Gaps"),
            ("late_tasks", "Late / Overdue PM Tasks"),
        ],
        "inventory_spares": [
            ("inventory_value", "Total Inventory Value"),
            ("turnover", "Stock Turnover Ratio"),
            ("dead_stock", "Dead Stock Identification"),
            ("stockouts", "Critical Stock-outs"),
            ("consumption_vs_proc", "Consumption vs Procurement"),
            ("vendor_reliability", "Vendor Reliability Ratings"),
        ],
        "strategic_roi": [
            ("value_realized", "Total Value Realized"),
            ("roi_multiplier", "Portfolio ROI Multiplier"),
            ("life_extension", "Average Asset Life Extension"),
            ("pillar_breakdown", "ROI by Strategic Pillar"),
            ("breakeven", "Investment vs Savings Break-even"),
            ("projects", "Project-by-Project Performance"),
        ],
    }


def metric_label(metric_key: str, category_key: str = "") -> str:
    cat = metric_catalog().get(category_key or "", [])
    mapping = {k: v for k, v in cat}
    fallback = {
        "mtbf": "Mean Time Between Failures (MTBF)",
        "mttr": "Mean Time To Repair (MTTR)",
        "availability": "Operational Availability %",
        "downtime": "Unscheduled Downtime (hrs)",
        "failure_rate": "Failure Rate",
        "health_score": "Asset Health Score",
        "incidents": "Total Incidents",
        "loss_estimate": "Estimated Production Loss",
        "root_cause": "Root Cause Distribution",
        "heatmap": "Breakdown Heatmap",
        "pm_adherence": "PM Schedule Adherence",
        "sop_validation": "SOP Validation Score",
        "audit_readiness": "Audit Readiness",
        "technician_ranking": "Technician Compliance Ranking",
        "critical_gaps": "Critical Audit Gaps",
        "late_tasks": "Late / Overdue PM Tasks",
        "inventory_value": "Total Inventory Value",
        "turnover": "Stock Turnover Ratio",
        "dead_stock": "Dead Stock Identification",
        "stockouts": "Critical Stock-outs",
        "consumption_vs_proc": "Consumption vs Procurement",
        "vendor_reliability": "Vendor Reliability Ratings",
        "value_realized": "Total Value Realized",
        "roi_multiplier": "Portfolio ROI Multiplier",
        "life_extension": "Average Asset Life Extension",
        "pillar_breakdown": "ROI by Strategic Pillar",
        "breakeven": "Investment vs Savings Break-even",
        "projects": "Project-by-Project Performance",
    }
    return mapping.get(metric_key) or fallback.get(metric_key) or metric_key.replace("_", " ").title()


# ============================================================
# Persistent storage (JSON) for in-memory stores
# ============================================================
# This keeps the existing in-memory data structures (lists of dicts)
# but saves them to disk so data survives app restarts.

import json
import threading
import atexit

DATA_DIR = os.path.join(app.root_path, "data")
_safe_makedirs(DATA_DIR)

DATASTORE_PATH = os.path.join(DATA_DIR, "datastore.json")
_DATASTORE_LOCK = threading.Lock()
PERSIST_BACKUP_DIR = os.path.join(DATA_DIR, "backups")
_safe_makedirs(PERSIST_BACKUP_DIR)
_LAST_PERSIST_BACKUP_TS = 0.0
REPORT_GENERATION_PROGRESS: dict[str, dict] = {}

def _default_store() -> dict:
    return {
        "version": 2,
        "saved_at": "",
        "ASSETS": [],
        "BREAKDOWNS": [],
        "MAINTENANCE_TASKS": [],
        "INVENTORY_PARTS": [],
        "SPARE_PARTS": [],
        "REPORT_EXPORTS": [],
        "AUDIT_TRAIL": [],
        "ASSET_DOCUMENTS": [],
        "SYSTEM_SETTINGS": default_system_settings(),
        "SYSTEM_NOTIFICATIONS": default_notifications(),
        "TECHNICIAN_DIRECTORY": default_technician_directory(),
        "ADMIN_USERS": default_admin_users(),
        "INTERNAL_MESSAGES": default_internal_messages(),
        "DRAFT_MESSAGES": default_draft_messages(),
        "OUTBOX_MESSAGES": default_outbox_messages(),
    }


def _write_persistence_backups(force: bool = False):
    global _LAST_PERSIST_BACKUP_TS
    try:
        now_ts = time.time()
        if not force and (now_ts - float(_LAST_PERSIST_BACKUP_TS or 0.0) < 300):
            return
        if os.path.exists(DATASTORE_PATH):
            latest_store = os.path.join(PERSIST_BACKUP_DIR, "datastore_latest.json")
            shutil.copy2(DATASTORE_PATH, latest_store)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            shutil.copy2(DATASTORE_PATH, os.path.join(PERSIST_BACKUP_DIR, f"datastore_{stamp}.json"))
        db_path = os.path.join(app.instance_path, "eabc.db")
        if os.path.exists(db_path):
            latest_db = os.path.join(PERSIST_BACKUP_DIR, "eabc_latest.db")
            shutil.copy2(db_path, latest_db)
        _LAST_PERSIST_BACKUP_TS = now_ts
    except Exception:
        pass


def _report_progress_start(job_id: str | None, label: str = "Initializing report generation") -> str:
    job_id = (job_id or token_urlsafe(12)).strip()
    REPORT_GENERATION_PROGRESS[job_id] = {
        "percent": 3,
        "label": label,
        "status": "running",
        "redirect": "",
        "error": "",
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    return job_id


def _report_progress_update(job_id: str | None, percent: int, label: str, status: str = "running", redirect_url: str = "", error: str = ""):
    job_id = (job_id or "").strip()
    if not job_id:
        return
    row = REPORT_GENERATION_PROGRESS.get(job_id) or {}
    row.update({
        "percent": max(0, min(100, int(percent))),
        "label": label,
        "status": status,
        "redirect": redirect_url or row.get("redirect") or "",
        "error": error or row.get("error") or "",
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    })
    REPORT_GENERATION_PROGRESS[job_id] = row


def _report_progress_finish(job_id: str | None, redirect_url: str = ""):
    _report_progress_update(job_id, 100, "Report package ready", status="complete", redirect_url=redirect_url)


def _report_progress_fail(job_id: str | None, error: str = "Generation failed"):
    _report_progress_update(job_id, 100, error or "Generation failed", status="failed", error=error or "Generation failed")


def _load_store_into_memory():
    global ASSETS, BREAKDOWNS, MAINTENANCE_TASKS, INVENTORY_PARTS, SPARE_PARTS, ASSET_DOCUMENTS, REPORT_EXPORTS, AUDIT_TRAIL, SYSTEM_SETTINGS, SYSTEM_NOTIFICATIONS, TECHNICIAN_DIRECTORY, ADMIN_USERS, INTERNAL_MESSAGES, DRAFT_MESSAGES, OUTBOX_MESSAGES
    try:
        if not os.path.exists(DATASTORE_PATH):
            _save_store_from_memory()
            return
        with open(DATASTORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
        # Backward/forward compatible keys
        ASSETS = list(data.get("ASSETS") or [])
        BREAKDOWNS = list(data.get("BREAKDOWNS") or [])
        MAINTENANCE_TASKS = list(data.get("MAINTENANCE_TASKS") or [])
        INVENTORY_PARTS = list(data.get("INVENTORY_PARTS") or [])
        SPARE_PARTS = list(data.get("SPARE_PARTS") or [])
        ASSET_DOCUMENTS = list(data.get("ASSET_DOCUMENTS") or [])
        REPORT_EXPORTS = list(data.get("REPORT_EXPORTS") or [])
        AUDIT_TRAIL = list(data.get("AUDIT_TRAIL") or [])
        SYSTEM_SETTINGS = dict(default_system_settings())
        SYSTEM_SETTINGS.update(data.get("SYSTEM_SETTINGS") or {})
        SYSTEM_NOTIFICATIONS = list(data.get("SYSTEM_NOTIFICATIONS") or default_notifications())
        TECHNICIAN_DIRECTORY = list(data.get("TECHNICIAN_DIRECTORY") or default_technician_directory())
        ADMIN_USERS = list(data.get("ADMIN_USERS") or default_admin_users())
        INTERNAL_MESSAGES = list(data.get("INTERNAL_MESSAGES") or default_internal_messages())
        DRAFT_MESSAGES = list(data.get("DRAFT_MESSAGES") or default_draft_messages())
        OUTBOX_MESSAGES = list(data.get("OUTBOX_MESSAGES") or default_outbox_messages())
        refresh_technician_names()
    except Exception:
        # If the file is corrupt, keep app running with empty stores.
        # (You can delete data/datastore.json to reset.)
        ASSETS = []
        BREAKDOWNS = []
        MAINTENANCE_TASKS = []
        INVENTORY_PARTS = []
        SPARE_PARTS = []
        ASSET_DOCUMENTS = []
        REPORT_EXPORTS = []
        AUDIT_TRAIL = []
        SYSTEM_SETTINGS = default_system_settings()
        SYSTEM_NOTIFICATIONS = default_notifications()
        TECHNICIAN_DIRECTORY = default_technician_directory()
        ADMIN_USERS = default_admin_users()
        INTERNAL_MESSAGES = default_internal_messages()
        DRAFT_MESSAGES = default_draft_messages()
        OUTBOX_MESSAGES = default_outbox_messages()
        refresh_technician_names()

def _save_store_from_memory():
    payload = {
        "version": 2,
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "ASSETS": ASSETS,
        "BREAKDOWNS": BREAKDOWNS,
        "MAINTENANCE_TASKS": MAINTENANCE_TASKS,
        "INVENTORY_PARTS": INVENTORY_PARTS,
        "SPARE_PARTS": SPARE_PARTS,
        "ASSET_DOCUMENTS": ASSET_DOCUMENTS,
        "REPORT_EXPORTS": REPORT_EXPORTS,
        "AUDIT_TRAIL": AUDIT_TRAIL,
        "SYSTEM_SETTINGS": SYSTEM_SETTINGS,
        "SYSTEM_NOTIFICATIONS": SYSTEM_NOTIFICATIONS,
        "TECHNICIAN_DIRECTORY": TECHNICIAN_DIRECTORY,
        "ADMIN_USERS": ADMIN_USERS,
        "INTERNAL_MESSAGES": INTERNAL_MESSAGES,
        "DRAFT_MESSAGES": DRAFT_MESSAGES,
        "OUTBOX_MESSAGES": OUTBOX_MESSAGES,
    }
    tmp_path = DATASTORE_PATH + ".tmp"
    with _DATASTORE_LOCK:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
        os.replace(tmp_path, DATASTORE_PATH)
    _write_persistence_backups(force=False)

# Load persisted data at import time (startup)
_load_store_into_memory()
atexit.register(_save_store_from_memory)
atexit.register(lambda: _write_persistence_backups(force=True))

@app.after_request
def _persist_datastore_after_request(response):
    try:
        if _should_auto_alert(response):
            _emit_auto_alert()
    except Exception:
        pass
    # Persist the whole in-memory workspace after every successful request.
    # This keeps all modules durable even when a route mutates state during a redirect
    # or through GET-based utility actions, and it minimizes data loss on restarts.
    try:
        if response.status_code < 500:
            _save_store_from_memory()
    except Exception:
        pass
    try:
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.endpoint in AUTH_PUBLIC_ENDPOINTS or request.path.startswith("/login"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        if request.is_secure:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    except Exception:
        pass
    return response

# Asset profile extra tabs
# Keep these stores if they were already loaded from disk at startup.
if "SPARE_PARTS" not in globals():
    SPARE_PARTS: list[dict] = []       # per asset
if "ASSET_DOCUMENTS" not in globals():
    ASSET_DOCUMENTS: list[dict] = []   # per asset


# -------------------------
# Helpers
# -------------------------
def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def allowed_doc(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in DOC_ALLOWED_EXTENSIONS


def _stream_size_ok(file_storage, limit_bytes: int) -> bool:
    """
    Enforce per-file max size using stream seek/tell.
    """
    try:
        stream = file_storage.stream
        pos = stream.tell()
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        stream.seek(pos, os.SEEK_SET)
        return size <= limit_bytes
    except Exception:
        return False


def get_current_department() -> str:
    dep = (session.get("current_department") or "").strip()
    return dep if dep in DEPARTMENTS else "Engineering"


ORG_PARENT_MAP = {
    "Engineering": "Production",
}


def get_parent_department(dept: str | None) -> str:
    return (ORG_PARENT_MAP.get((dept or "").strip()) or "").strip()


def get_department_display(dept: str | None) -> str:
    return (dept or "Engineering").strip() or "Engineering"


def get_report_department_display(dept: str | None) -> str:
    dept = (dept or "Engineering").strip() or "Engineering"
    parent = get_parent_department(dept)
    return parent or dept


def get_scope_unit_display(dept: str | None) -> str:
    dept = (dept or "Engineering").strip() or "Engineering"
    parent = get_parent_department(dept)
    return dept if parent else dept


def format_report_timestamp(raw_created_at: str | None = None, raw_date: str | None = None) -> str:
    for raw in (raw_created_at, raw_date):
        if not raw:
            continue
        try:
            dt = parse_iso_dt(raw) or parse_dt_local(raw)
            if dt:
                return dt.strftime("%d %b %Y %H:%M")
        except Exception:
            pass
        try:
            return datetime.strptime(str(raw).strip(), "%d %b %Y %H:%M").strftime("%d %b %Y %H:%M")
        except Exception:
            pass
        try:
            return datetime.strptime(str(raw).strip(), "%d %b %Y").strftime("%d %b %Y 00:00")
        except Exception:
            pass
        s = str(raw).strip()
        if s:
            return s
    return datetime.now().strftime("%d %b %Y %H:%M")




def _kes_label(v) -> str:
    try:
        return f"KES {float(v or 0):,.2f}"
    except Exception:
        return "KES 0.00"


def report_department_display(dept: str | None) -> str:
    return get_report_department_display((dept or get_current_department() or "Engineering").strip() or "Engineering")



@app.context_processor
def inject_template_helpers():
    return {
        'report_department_display': report_department_display,
        'scope_unit_display': get_scope_unit_display,
        'ultravetis_address_lines': ULTRAVETIS_ADDRESS_LINES,
    }

def base_ctx(active_nav: str) -> dict:
    user = _current_user_record() or {}
    latest_unread = next((n for n in SYSTEM_NOTIFICATIONS if not n.get("is_read") and n.get("should_toast", False)), None)
    return dict(
        active_nav=active_nav,
        current_user_name=user.get("name") or "Guest User",
        current_user_role=user.get("role") or "Viewer",
        current_user_email=user.get("email") or "",
        current_user_permissions=user.get("permissions") or [],
        current_user_signature={
            "name": user.get("signature_name") or SYSTEM_SETTINGS.get("mail_signature_name") or (user.get("name") or ""),
            "title": user.get("signature_title") or SYSTEM_SETTINGS.get("mail_signature_title") or (user.get("role") or ""),
            "font": user.get("signature_font") or SYSTEM_SETTINGS.get("mail_signature_font") or "Inter",
            "color": user.get("signature_color") or SYSTEM_SETTINGS.get("mail_signature_color") or "#1554FF",
            "style": user.get("signature_style") or SYSTEM_SETTINGS.get("mail_signature_style") or "formal",
            "image_url": user.get("signature_image_url") or SYSTEM_SETTINGS.get("mail_signature_image_url") or "",
        },
        unread_notifications_count=unread_notifications_count(),
        unread_messages_count=unread_messages_count(),
        latest_unread_notification=latest_unread,
        departments=DEPARTMENTS,
        current_department=get_current_department(),
        current_department_parent=get_parent_department(get_current_department()),
        current_department_display=get_department_display(get_current_department()),
        current_user_avatar_url=user.get("profile_image_url") or None,
        settings=SYSTEM_SETTINGS,
        permission_presets=ROLE_PERMISSION_PRESETS,
    )


def initials(name: str) -> str:
    if not name:
        return ""
    parts = [p for p in name.replace(".", " ").split() if p.strip()]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[1][0]).upper()


def human_dt_parts(iso_dt: str):
    try:
        dt = datetime.fromisoformat(iso_dt)
        return dt.strftime("%b %d, %Y"), dt.strftime("%H:%M")
    except Exception:
        return "-", "-"


def parse_iso_dt(iso_dt: str) -> Optional[datetime]:
    try:
        iso_dt = (iso_dt or "").strip()
        if not iso_dt:
            return None
        return datetime.fromisoformat(iso_dt)
    except Exception:
        return None


def parse_dt_local(s: str) -> Optional[datetime]:
    try:
        s = (s or "").strip()
        if not s:
            return None
        return datetime.fromisoformat(s)
    except Exception:
        return None


def minutes_between(iso_start: str, iso_end: str) -> Optional[int]:
    try:
        a = datetime.fromisoformat(iso_start)
        b = datetime.fromisoformat(iso_end)
        mins = int((b - a).total_seconds() // 60)
        return max(0, mins)
    except Exception:
        return None


def fmt_hm_from_minutes(mins: Optional[int]) -> str:
    if mins is None or mins < 0:
        return "—"
    h = mins // 60
    m = mins % 60
    return f"{h}h {m}m"


def _breakdown_start_dt(b: dict) -> Optional[datetime]:
    for key in ("reported_dt", "reported_at", "created_at", "created_dt", "start_time", "date"):
        dt = parse_iso_dt(b.get(key) or "")
        if dt:
            return dt
    return None


def _breakdown_end_dt(b: dict, now: Optional[datetime] = None) -> Optional[datetime]:
    now = now or datetime.now()
    for key in ("resolved_at", "closed_at", "end_time"):
        dt = parse_iso_dt(b.get(key) or "")
        if dt:
            return dt
    status = (b.get("status") or "").strip().lower()
    return now if status in ("open", "in_progress", "on_hold") else None


def _breakdown_overlap_minutes(b: dict, period_start: datetime, period_end: datetime, now: Optional[datetime] = None) -> int:
    """Return only the downtime minutes that fall inside the requested period."""
    start = _breakdown_start_dt(b)
    end = _breakdown_end_dt(b, now=now)
    if not start or not end:
        return 0
    if end < start:
        return 0
    overlap_start = max(start, period_start)
    overlap_end = min(end, period_end)
    if overlap_end <= overlap_start:
        return 0
    return max(0, int((overlap_end - overlap_start).total_seconds() // 60))


def next_breakdown_id() -> str:
    year = datetime.now().year
    existing = [b for b in BREAKDOWNS if (b.get("breakdown_id") or "").endswith(str(year))]
    n = len(existing) + 1
    return f"BD-{n:03d}-{year}"


def next_pm_id() -> str:
    year = datetime.now().year
    existing = [t for t in MAINTENANCE_TASKS if (t.get("task_id") or "").endswith(str(year))]
    n = len(existing) + 1
    return f"PM-{n:03d}-{year}"


def build_pagination(page: int, total_pages: int):
    if total_pages <= 7:
        return list(range(1, total_pages + 1))

    pages = [1]
    if page > 4:
        pages.append("…")

    start = max(2, page - 2)
    end = min(total_pages - 1, page + 2)
    pages.extend(range(start, end + 1))

    if page < total_pages - 3:
        pages.append("…")

    pages.append(total_pages)

    out = []
    for p in pages:
        if p not in out:
            out.append(p)
    return out


def paginate_records(items: list[dict], page: int, per_page: int):
    try:
        page = int(page or 1)
    except Exception:
        page = 1
    try:
        per_page = int(per_page or 10)
    except Exception:
        per_page = 10
    per_page = per_page if per_page in (5, 10, 20, 50) else 10
    total = len(items or [])
    total_pages = max(1, ceil(total / per_page)) if per_page else 1
    page = max(1, min(page, total_pages))
    start = (page - 1) * per_page
    end = start + per_page
    showing_start = (start + 1) if total else 0
    showing_end = min(end, total) if total else 0
    return {
        "items": (items or [])[start:end],
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "pages": build_pagination(page, total_pages),
        "showing_start": showing_start,
        "showing_end": showing_end,
    }


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def export_rows_file(fmt: str, filename_root: str, title: str, columns: list[tuple[str, str]], rows: list[dict]):
    fmt = (fmt or "csv").lower()
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", filename_root).strip("_") or "export"
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    if fmt == "csv":
        _report_progress_update(job_id, 55, "Building CSV export")
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([label for label, _ in columns])
        for row in rows:
            writer.writerow([_cell_text(row.get(key)) for _, key in columns])
        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={safe_name}.csv"},
        )

    if fmt == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter

        wb = Workbook()
        ws = wb.active
        ws.title = "Export"
        ws.append([label for label, _ in columns])
        for row in rows:
            ws.append([_cell_text(row.get(key)) for _, key in columns])

        header_fill = PatternFill("solid", fgColor="1554FF")
        header_font = Font(color="FFFFFF", bold=True)
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for idx, (label, key) in enumerate(columns, start=1):
            max_len = len(label)
            for row in rows:
                max_len = max(max_len, len(_cell_text(row.get(key))))
            ws.column_dimensions[get_column_letter(idx)].width = min(max(14, max_len + 2), 40)

        ws.freeze_panes = "A2"
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return send_file(
            buf,
            as_attachment=True,
            download_name=f"{safe_name}.xlsx",
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    if fmt == "pdf":
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

        buf = io.BytesIO()
        page_size = landscape(A4) if len(columns) > 6 else A4
        doc = SimpleDocTemplate(buf, pagesize=page_size, leftMargin=20, rightMargin=20, topMargin=132, bottomMargin=26)
        styles = getSampleStyleSheet()
        label_style = ParagraphStyle("ExportMeta", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5, textColor=colors.HexColor("#475569"), leading=11)

        def draw_export_header(canvas_obj, doc_obj):
            pw, ph = doc_obj.pagesize
            left_margin = 20
            right_margin = 20
            header_bottom_y = _draw_pdf_brand_banner(canvas_obj, pw, ph, left_margin=left_margin, right_margin=right_margin, top_margin=16) - 10
            canvas_obj.setFillColor(colors.HexColor("#0F172A"))
            canvas_obj.setFont("Helvetica-Bold", 12.5)
            canvas_obj.drawString(left_margin, header_bottom_y, title)
            canvas_obj.setFont("Helvetica", 8.8)
            canvas_obj.setFillColor(colors.HexColor("#475569"))
            reporter = base_ctx("reports").get("current_user_name") or "System"
            canvas_obj.drawString(left_margin, header_bottom_y - 12, f"Generated: {stamp}")
            canvas_obj.drawRightString(pw - right_margin, header_bottom_y - 12, f"Reported by: {reporter}")
            canvas_obj.setStrokeColor(colors.HexColor("#CBD5E1"))
            canvas_obj.line(left_margin, header_bottom_y - 18, pw - right_margin, header_bottom_y - 18)
            canvas_obj.setFillColor(colors.black)

        data = [[label for label, _ in columns]]
        for row in rows:
            data.append([_cell_text(row.get(key)) for _, key in columns])
        pw, _ph = page_size
        usable_w = pw - doc.leftMargin - doc.rightMargin
        base_font = 6.6 if len(columns) >= 14 else (7.2 if len(columns) >= 10 else 8)
        col_width = usable_w / max(1, len(columns))
        table = Table(data, repeatRows=1, colWidths=[col_width] * len(columns))
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1554FF")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), base_font),
            ("LEADING", (0, 0), (-1, -1), base_font + 2),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor("#F8FAFC")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story = [Paragraph("Controlled export generated from Opsloom.", label_style), Spacer(1, 14), table]
        doc.build(story, onFirstPage=draw_export_header, onLaterPages=draw_export_header)
        buf.seek(0)
        return send_file(buf, as_attachment=True, download_name=f"{safe_name}.pdf", mimetype="application/pdf")

    abort(400)


def inventory_stock_state(part: dict) -> str:
    qty = int(part.get("qty") or 0)
    min_qty = int(part.get("min_qty") or 0)
    if qty <= 0:
        return "out_of_stock"
    if min_qty > 0 and qty <= min_qty:
        return "low_stock"
    return "healthy"


def safe_status_label(status: str) -> str:
    m = {
        "open": "Open",
        "in_progress": "In Progress",
        "resolved": "Resolved",
        "on_hold": "On Hold",
    }
    return m.get(status or "", (status or "").replace("_", " ").title() or "Queued")


def normalize_severity(sev: str) -> str:
    s = (sev or "").strip().lower()
    if s in ("critical", "medium", "low"):
        return s
    return "medium"


def normalize_status(st: str) -> str:
    s = (st or "").strip().lower()
    if s in ("open", "in_progress", "resolved", "on_hold"):
        return s
    return "open"


def normalize_pm_status(st: str) -> str:
    s = (st or "").strip().lower()
    if s in ("upcoming", "overdue", "completed"):
        return s
    return "upcoming"


def parse_date_only(s: str) -> Optional[date]:
    """Parse a date from common UI formats and return a date object."""
    try:
        if isinstance(s, datetime):
            return s.date()
        if isinstance(s, date):
            return s
        s = (s or "").strip()
        if not s:
            return None
        for parser in (
            lambda v: datetime.fromisoformat(v).date(),
            lambda v: datetime.strptime(v, "%m/%d/%Y").date(),
            lambda v: datetime.strptime(v, "%d/%m/%Y").date(),
            lambda v: datetime.strptime(v, "%Y/%m/%d").date(),
        ):
            try:
                return parser(s)
            except Exception:
                pass
        s2 = re.sub(r"[^0-9]", "-", s)
        try:
            return datetime.fromisoformat(s2).date()
        except Exception:
            return None
    except Exception:
        return None


def _coerce_date(value) -> Optional[date]:
    """Return a plain date object from date/datetime/string inputs."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return parse_date_only(str(value or ""))






def _advance_frequency_date(cur: date, frequency: str) -> date:
    freq = normalize_frequency(frequency or "Monthly")
    if freq == "Daily":
        return cur + timedelta(days=1)
    if freq == "Weekly":
        return cur + timedelta(days=7)
    if freq == "One-time":
        return cur

    month_jump = 1
    if freq == "Quarterly":
        month_jump = 3
    elif freq in ("Bi-Annually", "Biannually"):
        month_jump = 6
    elif freq in ("Annually", "Yearly"):
        month_jump = 12

    m = cur.month + month_jump
    y = cur.year + (m - 1) // 12
    m = ((m - 1) % 12) + 1
    mdays = [31,29 if y%4==0 and (y%100!=0 or y%400==0) else 28,31,30,31,30,31,31,30,31,30,31][m-1]
    day = min(cur.day, mdays)
    return date(y, m, day)


def _maintenance_series_key(task: dict) -> str:
    sid = str(task.get("schedule_group_id") or "").strip()
    if sid:
        return f"series:{sid}"
    freq = normalize_frequency(task.get("frequency") or "")
    if freq == "One-time":
        return f"task:{task.get('task_id') or uuid4().hex}"
    return "fallback:" + "|".join([
        _norm_str(task.get("asset_uid") or task.get("asset_id") or task.get("asset_name")),
        _norm_str(task.get("maintenance_type") or "PM"),
        _norm_str(freq),
        _norm_str(task.get("task_title") or task.get("task_description") or ""),
    ])


def _visible_management_tasks(items: list[dict], status_filter: str = "") -> list[dict]:
    status_filter = (status_filter or "").strip().lower()
    if status_filter == "completed":
        rows = list(items or [])
        rows.sort(key=lambda x: ((parse_date_only(x.get("completed_at") or x.get("due_date") or "9999-12-31") or date.max), x.get("asset_name") or ""), reverse=True)
        return rows

    chosen: dict[str, dict] = {}
    for t in (items or []):
        if (t.get("status") or "").strip().lower() == "completed":
            continue
        key = _maintenance_series_key(t)
        dd = parse_date_only(t.get("due_date") or "") or date.max
        cur = chosen.get(key)
        if cur is None:
            chosen[key] = t
            continue
        cur_dd = parse_date_only(cur.get("due_date") or "") or date.max
        if (dd, t.get("asset_name") or "") < (cur_dd, cur.get("asset_name") or ""):
            chosen[key] = t
    rows = list(chosen.values())
    rows.sort(key=lambda x: ((parse_date_only(x.get("due_date") or "") or date.max), 0 if (x.get("status") or "") == "overdue" else 1, x.get("asset_name") or ""))
    return rows


def _shift_future_schedule_after_completion(task: dict, completion_dt: datetime) -> None:
    freq = normalize_frequency(task.get("frequency") or "")
    if freq == "One-time":
        return
    s_key = _maintenance_series_key(task)
    future = []
    for other in MAINTENANCE_TASKS:
        if other is task:
            continue
        if _maintenance_series_key(other) != s_key:
            continue
        if (other.get("status") or "").strip().lower() == "completed":
            continue
        due = parse_date_only(other.get("due_date") or "")
        if not due:
            continue
        future.append((due, other))
    future.sort(key=lambda x: x[0])
    anchor = completion_dt.date()
    for _old_due, other in future:
        anchor = _advance_frequency_date(anchor, freq)
        other["due_date"] = anchor.isoformat()
        if (other.get("status") or "").strip().lower() != "completed":
            other["status"] = "overdue" if anchor < datetime.now().date() else "upcoming"

def is_overdue(due_date_iso: str) -> bool:
    try:
        if not due_date_iso:
            return False
        due = datetime.fromisoformat(due_date_iso).date()
        return due < datetime.now().date()
    except Exception:
        return False


def save_uploaded_image(file_storage, folder_abs: str, folder_url: str) -> str:
    if not file_storage or not file_storage.filename:
        raise ValueError("No file")
    if not allowed_file(file_storage.filename):
        raise ValueError("Invalid file type")
    if not _stream_size_ok(file_storage, MAX_FILE_BYTES):
        raise ValueError("File too large")

    safe_name = secure_filename(file_storage.filename)
    ext = safe_name.rsplit(".", 1)[1].lower()
    new_name = f"{uuid4().hex}.{ext}"
    save_path = os.path.join(folder_abs, new_name)
    file_storage.save(save_path)

    return url_for("static", filename=f"{folder_url}/{new_name}")


def save_uploaded_doc(file_storage, folder_abs: str, folder_url: str) -> str:
    if not file_storage or not file_storage.filename:
        raise ValueError("No file")
    if not allowed_doc(file_storage.filename):
        raise ValueError("Invalid file type")
    if not _stream_size_ok(file_storage, DOC_MAX_FILE_BYTES):
        raise ValueError("File too large")

    safe_name = secure_filename(file_storage.filename)
    ext = safe_name.rsplit(".", 1)[1].lower()
    new_name = f"{uuid4().hex}.{ext}"
    save_path = os.path.join(folder_abs, new_name)
    file_storage.save(save_path)

    return url_for("static", filename=f"{folder_url}/{new_name}")


# -------------------------
# Asset status + availability helpers
# -------------------------
def _asset_by_uid(asset_uid: str) -> Optional[dict]:
    return next((a for a in ASSETS if a.get("uid") == asset_uid), None)


def _ensure_status_history(asset: dict):
    """
    status_history items:
      {status: 'operational'|'maintenance'|'out_of_service', from: iso, to: iso|None, reason: str}
    """
    if "status_history" in asset and isinstance(asset.get("status_history"), list):
        return

    reg = (asset.get("registered_at") or datetime.now().isoformat(timespec="seconds")).strip()
    st = (asset.get("status") or "operational").strip()

    asset["status_history"] = [
        {"status": st, "from": reg, "to": None, "reason": "registration"}
    ]


def set_asset_status(asset_uid: str, new_status: str, reason: str = "", ts: Optional[datetime] = None):
    """
    Sets asset['status'] and maintains status_history time periods.
    """
    if new_status not in ("operational", "maintenance", "out_of_service"):
        return

    asset = _asset_by_uid(asset_uid)
    if not asset:
        return

    _ensure_status_history(asset)

    ts = ts or datetime.now()
    iso = ts.isoformat(timespec="seconds")
    cur = (asset.get("status") or "operational").strip()

    if cur == new_status:
        return

    # close current period
    hist = asset.get("status_history") or []
    if hist:
        last = hist[0]  # newest-first
        if last.get("to") in (None, ""):
            last["to"] = iso

    # push new period
    hist.insert(0, {"status": new_status, "from": iso, "to": None, "reason": (reason or "").strip()})
    asset["status_history"] = hist
    asset["status"] = new_status


def _has_active_breakdown(asset_uid: str) -> bool:
    for b in BREAKDOWNS:
        if b.get("asset_uid") != asset_uid:
            continue
        if b.get("status") in ("open", "in_progress", "on_hold"):
            return True
    return False


def _maybe_restore_asset_after_resolution(asset_uid: str):
    """
    When a breakdown is resolved, restore an asset back to 'operational' ONLY if:
      - there are no other active breakdowns for that asset
      - current asset status is 'maintenance'
      - last status change reason was breakdown-related (so manual maintenance isn't overridden)
    """
    asset = _asset_by_uid(asset_uid)
    if not asset:
        return

    if _has_active_breakdown(asset_uid):
        return

    if (asset.get("status") or "").strip() != "maintenance":
        return

    _ensure_status_history(asset)
    last_reason = ((asset.get("status_history") or [{}])[0].get("reason") or "").strip().lower()

    if last_reason.startswith("breakdown:") or last_reason == "registration_maintenance":
        set_asset_status(asset_uid, "operational", reason="auto_restore_after_resolution")


# -------------------------
# Analytics helpers (existing + updated uptime calc)
# -------------------------
def compute_asset_breakdown_intelligence(asset_uid: str) -> dict:
    """
    Builds KPI + analytics for ONE asset breakdowns tab:
      - total_breakdowns
      - mttr_hours (avg of resolved durations)
      - last_breakdown_date (latest reported_dt)
      - downtime_mtd_hours (sum of resolved durations this month)
      - root_causes donut distribution (from RCA primary_root_cause else failure_category)
      - top_failure_modes (from incident_title)
    """
    now = datetime.now()
    month_key = now.strftime("%Y-%m")

    items = [b for b in BREAKDOWNS if b.get("asset_uid") == asset_uid]

    total_breakdowns = len(items)

    last_dt = None
    for b in items:
        dt = parse_iso_dt(b.get("reported_dt") or "")
        if dt and (last_dt is None or dt > last_dt):
            last_dt = dt
    last_breakdown_date = last_dt.strftime("%b %d, %Y") if last_dt else None

    resolved_mins = []
    for b in items:
        if (b.get("status") or "") != "resolved":
            continue

        mins = b.get("duration_mins")
        if not isinstance(mins, int):
            rep = (b.get("reported_dt") or "").strip()
            res = (b.get("resolved_at") or "").strip()
            mins = minutes_between(rep, res) if rep and res else None

        if isinstance(mins, int):
            resolved_mins.append(mins)

    mttr_hours = (sum(resolved_mins) / len(resolved_mins) / 60.0) if resolved_mins else None

    downtime_mtd_hours = 0.0
    any_mtd = False
    for b in items:
        if (b.get("status") or "") != "resolved":
            continue
        if not (b.get("resolved_at") or "").startswith(month_key):
            continue

        mins = b.get("duration_mins")
        if not isinstance(mins, int):
            rep = (b.get("reported_dt") or "").strip()
            res = (b.get("resolved_at") or "").strip()
            mins = minutes_between(rep, res) if rep and res else None

        if isinstance(mins, int):
            downtime_mtd_hours += mins / 60.0
            any_mtd = True

    downtime_mtd_hours = downtime_mtd_hours if any_mtd else None

    labels = []
    for b in items:
        rc = (b.get("rca") or {}).get("primary_root_cause")
        if rc and str(rc).strip():
            labels.append(str(rc).strip())
        else:
            fc = (b.get("failure_category") or "").strip()
            labels.append(fc if fc else "Unspecified")

    counts = {}
    for lab in labels:
        counts[lab] = counts.get(lab, 0) + 1

    sorted_rc = sorted(counts.items(), key=lambda x: x[1], reverse=True)

    root_causes = []
    if total_breakdowns > 0:
        palette = ["text-ueal-purple", "text-ueal-gold", "text-indigo-300", "text-slate-400"]
        for i, (lab, cnt) in enumerate(sorted_rc[:4]):
            pct = round((cnt / total_breakdowns) * 100)
            root_causes.append(
                {"label": lab, "count": cnt, "percent": pct, "color": palette[i % len(palette)]}
            )

        drift = 100 - sum(rc["percent"] for rc in root_causes)
        if root_causes:
            root_causes[0]["percent"] = max(0, root_causes[0]["percent"] + drift)

    fm_counts = {}
    for b in items:
        title = (b.get("incident_title") or "").strip()
        if not title:
            title = "Unspecified"
        fm_counts[title] = fm_counts.get(title, 0) + 1

    top = sorted(fm_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    top_failure_modes = []
    if total_breakdowns > 0:
        for lab, cnt in top:
            top_failure_modes.append(
                {"label": lab, "count": cnt, "percent": round((cnt / total_breakdowns) * 100)}
            )

    return dict(
        kpis=dict(
            total_breakdowns=total_breakdowns,
            mttr_hours=mttr_hours,
            last_breakdown_date=last_breakdown_date,
            downtime_mtd_hours=downtime_mtd_hours,
            failure_cost=(round(sum((_safe_float(b.get("cost_total"), 0.0) or 0.0) for b in items), 2) if any((_safe_float(b.get("cost_total"), None) is not None) for b in items) else None),
        ),
        root_causes=root_causes,
        top_failure_modes=top_failure_modes,
    )


def compute_kpi_trends(department: Optional[str] = None):
    now = datetime.now()
    today = now.date()
    yesterday = (now - timedelta(days=1)).date()

    def dt_date(iso_str: str):
        try:
            return datetime.fromisoformat(iso_str).date()
        except Exception:
            return None

    # department-aware breakdowns universe
    universe = BREAKDOWNS
    if department:
        universe = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == department]

    active = sum(1 for b in universe if b.get("status") in ("open", "in_progress"))

    active_today = 0
    active_yesterday = 0
    for b in universe:
        if b.get("status") in ("open", "in_progress"):
            d = dt_date(b.get("reported_dt") or "")
            if d == today:
                active_today += 1
            if d == yesterday:
                active_yesterday += 1
    active_delta = active_today - active_yesterday

    resolved = [b for b in universe if b.get("status") == "resolved" and isinstance(b.get("duration_mins"), int)]
    if resolved:
        avg_mins = sum(b["duration_mins"] for b in resolved) / len(resolved)
        mttr_hours = avg_mins / 60.0
    else:
        mttr_hours = 0.0

    this_month_key = now.strftime("%Y-%m")
    prev_month = (now.replace(day=1) - timedelta(days=1))
    prev_month_key = prev_month.strftime("%Y-%m")

    this_month_resolved = [
        b for b in resolved if (b.get("resolved_at") or b.get("created_at") or "").startswith(this_month_key)
    ]
    prev_month_resolved = [
        b for b in resolved if (b.get("resolved_at") or b.get("created_at") or "").startswith(prev_month_key)
    ]

    def avg_hours(items):
        if not items:
            return None
        return (sum(b["duration_mins"] for b in items) / len(items)) / 60.0

    this_avg = avg_hours(this_month_resolved)
    prev_avg = avg_hours(prev_month_resolved)

    if this_avg is None or prev_avg in (None, 0):
        mttr_trend = 0.0
    else:
        mttr_trend = ((this_avg - prev_avg) / prev_avg) * 100.0

    # True month-to-date downtime: only count the portion of each breakdown interval
    # that overlaps the current month window. Do not dump the full lifetime of a long-open
    # or late-closed breakdown into the current month.
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    period_end = now
    mtd_minutes = 0
    for b in universe:
        mtd_minutes += _breakdown_overlap_minutes(b, period_start, period_end, now=now)
    mtd = mtd_minutes / 60.0

    return dict(
        active=active,
        active_delta=active_delta,
        mttr_hours=mttr_hours,
        mttr_trend=mttr_trend,
        downtime_mtd_hours=mtd,
    )


def merge_intervals(intervals: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    if not intervals:
        return []
    intervals.sort(key=lambda x: x[0])
    merged = [intervals[0]]
    for s, e in intervals[1:]:
        last_s, last_e = merged[-1]
        if s <= last_e:
            merged[-1] = (last_s, max(last_e, e))
        else:
            merged.append((s, e))
    return merged


def _status_history_intervals(asset: dict, now: datetime) -> list[tuple[datetime, datetime]]:
    """
    Downtime intervals based on asset status_history:
      any time NOT operational is treated as downtime.
    """
    _ensure_status_history(asset)
    reg = parse_iso_dt(asset.get("registered_at") or "")
    if not reg:
        return []

    intervals: list[tuple[datetime, datetime]] = []
    for seg in (asset.get("status_history") or []):
        st = (seg.get("status") or "").strip()
        if st == "operational":
            continue

        s = parse_iso_dt(seg.get("from") or "")
        e = parse_iso_dt(seg.get("to") or "") or now
        if not s:
            continue

        if e < reg:
            continue
        if s < reg:
            s = reg
        if e > now:
            e = now
        if e < s:
            continue
        intervals.append((s, e))

    return intervals


def compute_uptime_rate(now: Optional[datetime] = None, department: Optional[str] = None) -> float:
    """
    Uptime rate across registered assets (optionally filtered by department):
      uptime% = (total_time - total_downtime) / total_time * 100

    total_downtime includes:
      - breakdown intervals (reported_dt to resolved_at/now)
      - any non-operational status intervals from status_history (maintenance/out_of_service)

    Intervals are merged per asset to avoid overlaps/double-counting.
    """
    now = now or datetime.now()

    assets_universe = ASSETS
    if department:
        assets_universe = [a for a in ASSETS if (a.get("department") or "Engineering") == department]

    if not assets_universe:
        return 0.0

    total_seconds = 0.0
    total_downtime_seconds = 0.0

    for a in assets_universe:
        reg = parse_iso_dt(a.get("registered_at") or "")
        if not reg:
            continue

        asset_life = (now - reg).total_seconds()
        if asset_life <= 0:
            continue

        total_seconds += asset_life

        intervals: list[tuple[datetime, datetime]] = []
        intervals.extend(_status_history_intervals(a, now))

        # breakdown-based downtime
        for b in BREAKDOWNS:
            if b.get("asset_uid") != a.get("uid"):
                continue

            # if dept is specified, only include breakdowns belonging to that dept
            if department and (b.get("department") or "Engineering") != department:
                continue

            start = parse_iso_dt(b.get("reported_dt") or "")
            if not start:
                continue

            if b.get("status") == "resolved":
                end = parse_iso_dt(b.get("resolved_at") or "") or start
            else:
                end = now

            if end < reg:
                continue
            if start < reg:
                start = reg
            if end > now:
                end = now
            if end < start:
                continue

            intervals.append((start, end))

        merged = merge_intervals(intervals)
        for s, e in merged:
            total_downtime_seconds += (e - s).total_seconds()

    if total_seconds <= 0:
        return 0.0

    uptime_seconds = max(0.0, total_seconds - total_downtime_seconds)
    return (uptime_seconds / total_seconds) * 100.0


# -------------------------
# 3.3 Executive dashboard intelligence helpers (paste below analytics helpers)
# -------------------------
def _in_current_month(iso_dt: str) -> bool:
    if not iso_dt:
        return False
    return iso_dt.startswith(datetime.now().strftime("%Y-%m"))


def _breakdown_duration_hours(b: dict) -> float:
    """
    Returns downtime hours.
    - If resolved: use duration_mins if present, else compute from reported->resolved.
    - If not resolved: compute from reported->now (live downtime).
    """
    rep = (b.get("reported_dt") or "").strip()
    if not rep:
        return 0.0

    if (b.get("status") or "") == "resolved":
        mins = b.get("duration_mins")
        if not isinstance(mins, int):
            res = (b.get("resolved_at") or "").strip()
            mins = minutes_between(rep, res) if res else 0
        return max(0.0, float(mins or 0) / 60.0)

    mins = minutes_between(rep, datetime.now().isoformat(timespec="seconds")) or 0
    return max(0.0, float(mins) / 60.0)


def compute_dashboard_intelligence(department: str) -> dict:
    """
    Department-aware exec dashboard.
    NOTE: department filtering only works if assets/breakdowns/tasks store 'department'.
    """
    # Filter universe
    assets = [a for a in ASSETS if (a.get("department") or "Engineering") == department]
    asset_uids = {a.get("uid") for a in assets if a.get("uid")}

    breakdowns = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == department]
    tasks = [t for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == department]
    parts = INVENTORY_PARTS[:]  # keep global unless you add department to parts too

    # KPIs (dept-aware)
    k = compute_kpi_trends(department=department)
    uptime_rate = compute_uptime_rate(department=department)
    downtime_mtd_hours = float(k.get("downtime_mtd_hours") or 0.0)
    downtime_financial_mtd = downtime_mtd_hours * DOWNTIME_COST_PER_HOUR

    # Asset health
    total_assets = len(assets)
    operational = sum(1 for a in assets if a.get("status") == "operational")
    in_maint = sum(1 for a in assets if a.get("status") == "maintenance")
    oos = sum(1 for a in assets if a.get("status") == "out_of_service")

    # Critical risks
    critical_open = [
        b for b in breakdowns
        if (b.get("severity") == "critical") and (b.get("status") in ("open", "in_progress", "on_hold"))
    ]

    # PM compliance MTD (simplified, aligns with your maintenance_list logic)
    now = datetime.now()
    today = now.date()
    month_key = now.strftime("%Y-%m")

    due_mtd = 0
    on_time = 0
    for t in [enrich_pm_task(x) for x in tasks]:
        dd = parse_date_only(t.get("due_date") or "")
        if not dd:
            continue
        if dd.strftime("%Y-%m") != month_key:
            continue
        if dd > today:
            continue
        due_mtd += 1
        if (t.get("status") or "") == "completed":
            ca = _coerce_date(t.get("completed_at") or "")
            if ca and ca <= dd:
                on_time += 1
    pm_compliance = (on_time / due_mtd * 100.0) if due_mtd > 0 else None

    overdue_pm = sum(1 for t in [enrich_pm_task(x) for x in tasks] if t.get("status") == "overdue")

    # Inventory KPIs (global)
    critical_spares = sum(1 for p in parts if (p.get("is_critical") is True))
    low_stock = sum(1 for p in parts if (p.get("qty") or 0) <= (p.get("min_qty") or 0) and (p.get("qty") or 0) > 0)
    out_of_stock = sum(1 for p in parts if (p.get("qty") or 0) <= 0)
    inv_value = 0.0
    for p in parts:
        inv_value += float(p.get("qty") or 0) * float(p.get("unit_price") or 0)

    maintenance_cost_total = round(sum((_safe_float(t.get("cost_total"), 0.0) or 0.0) for t in tasks), 2)
    breakdown_cost_total = round(sum((_safe_float(b.get("cost_total"), 0.0) or 0.0) for b in breakdowns), 2)
    combined_cost_total = round(maintenance_cost_total + breakdown_cost_total, 2)
    reports_count = len([r for r in REPORT_EXPORTS if (r.get("department") or "Engineering") == department])

    # Worst performing assets (MTD)
    mtd_breakdowns = []
    for b in breakdowns:
        # MTD by resolved_at if resolved, else by reported_dt for live incidents this month
        if b.get("status") == "resolved":
            if not _in_current_month(b.get("resolved_at") or ""):
                continue
        else:
            if not _in_current_month(b.get("reported_dt") or ""):
                continue
        mtd_breakdowns.append(b)

    by_asset = {}
    for b in mtd_breakdowns:
        uid = b.get("asset_uid")
        if uid not in asset_uids:
            continue
        by_asset.setdefault(uid, {"asset_name": b.get("asset_name"), "section": b.get("section"), "downtime_hours": 0.0, "count": 0})
        by_asset[uid]["downtime_hours"] += _breakdown_duration_hours(b)
        by_asset[uid]["count"] += 1

    worst_assets = sorted(by_asset.values(), key=lambda x: x["downtime_hours"], reverse=True)[:6]

    # Root cause / failure category distribution
    labels = []
    for b in breakdowns:
        rc = (b.get("rca") or {}).get("primary_root_cause")
        if rc and str(rc).strip():
            labels.append(str(rc).strip())
        else:
            fc = (b.get("failure_category") or "").strip()
            labels.append(fc if fc else "Unspecified")

    counts = {}
    for lab in labels:
        counts[lab] = counts.get(lab, 0) + 1
    top_rc = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:4]
    total_bd = max(1, len(breakdowns))
    root_causes = [{"label": lab, "count": cnt, "percent": round(cnt / total_bd * 100)} for lab, cnt in top_rc]

    # Strategic action feed (simple rules)
    action_feed = []

    if worst_assets:
        top = worst_assets[0]
        action_feed.append({
            "icon": "history_toggle_off",
            "title": f"Downtime Driver: {top['asset_name']}",
            "meta": "This month",
            "body": f"Highest downtime at {top['downtime_hours']:.1f} hrs across {top['count']} incidents. Recommend reliability review + spares readiness.",
            "cta": "Review breakdowns",
            "href": url_for("breakdowns_management")
        })

    if out_of_stock > 0 or low_stock > 0:
        action_feed.append({
            "icon": "inventory_2",
            "title": "Spares Risk: Low / Out of stock",
            "meta": "Inventory",
            "body": f"{out_of_stock} out-of-stock items and {low_stock} low-stock alerts. Prioritize critical spares first.",
            "cta": "Open Inventory",
            "href": url_for("inventory_management", stock_state="low_stock")
        })

    if len(critical_open) > 0:
        action_feed.append({
            "icon": "warning",
            "title": "Critical Incidents Open",
            "meta": "Act now",
            "body": f"{len(critical_open)} critical breakdown(s) still open/in progress. Escalate and enforce closure dates + RCA capture.",
            "cta": "View critical list",
            "href": url_for("breakdowns_management")
        })

    return dict(
        kpi_uptime_rate=uptime_rate,
        kpi_uptime_target=UPTIME_TARGET,

        kpi_active_breakdowns=k["active"],
        kpi_active_delta=k["active_delta"],
        kpi_mttr_hours=k["mttr_hours"],
        kpi_mttr_trend=k["mttr_trend"],
        kpi_downtime_mtd_hours=downtime_mtd_hours,
        kpi_downtime_financial_mtd=downtime_financial_mtd,

        total_assets=total_assets,
        operational_assets=operational,
        maintenance_assets=in_maint,
        oos_assets=oos,

        pm_compliance=pm_compliance,
        overdue_pm=overdue_pm,

        critical_risks=len(critical_open),

        inventory_value=inv_value,
        inventory_critical_spares=critical_spares,
        inventory_low_stock=low_stock,
        inventory_out_of_stock=out_of_stock,
        maintenance_cost_total=maintenance_cost_total,
        breakdown_cost_total=breakdown_cost_total,
        combined_cost_total=combined_cost_total,
        reports_count=reports_count,

        root_causes=root_causes,
        action_feed=action_feed,
        worst_assets=worst_assets,
        critical_open=critical_open[:6],
    )

def compute_maintenance_management_kpis(department=None):
    """Return live KPI snapshot for Maintenance Management."""
    dept = department or get_current_department()
    today = date.today()
    month_key = today.strftime("%Y-%m")
    current_year = today.year

    pm_month = 0
    overdue_total = 0
    upcoming_7 = 0
    due_mtd_total = 0
    on_time_completed = 0
    actual_cost_total = 0.0
    estimated_cost_total = 0.0

    for t in (MAINTENANCE_TASKS or []):
        if dept and (t.get("department") or "") != dept:
            continue

        dd = parse_iso_dt(
            t.get("due_date")
            or t.get("scheduled_date")
            or t.get("planned_date")
            or t.get("next_due")
            or t.get("start_date")
            or t.get("date")
            or ""
        )
        if not dd:
            continue

        status = (t.get("status") or "").strip().lower()
        maint_type = (t.get("maintenance_type") or "").strip().upper()
        if dd.year == current_year:
            estimated_cost_total += float(_task_cost_value(t, "cost_total", 0.0) or 0.0)
        if status in {"completed", "done", "closed"} and bool(t.get("cost_collected")):
            actual_cost_total += float(_task_cost_value(t, "cost_total", 0.0) or 0.0)

        if maint_type == "PM" and dd.strftime("%Y-%m") == month_key:
            pm_month += 1

        if dd < today and status not in {"completed", "done", "closed"}:
            overdue_total += 1

        days_ahead = (dd - today).days
        if 0 <= days_ahead <= 7:
            upcoming_7 += 1

        if maint_type == "PM" and dd.strftime("%Y-%m") == month_key and dd <= today:
            due_mtd_total += 1
            completed_at = parse_iso_dt(t.get("completed_at") or t.get("closed_at") or t.get("resolved_at") or "")
            if status in {"completed", "done", "closed"}:
                if completed_at is None or completed_at.date() <= dd:
                    on_time_completed += 1

    compliance = round((on_time_completed / due_mtd_total * 100.0), 1) if due_mtd_total > 0 else 0.0
    return {
        "kpi_total_pm_month": int(pm_month),
        "kpi_overdue": int(overdue_total),
        "kpi_upcoming_7": int(upcoming_7),
        "kpi_compliance_rate": float(compliance),
        "kpi_cost_total": round(actual_cost_total, 2),
        "kpi_estimated_cost_total": round(estimated_cost_total, 2),
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }


def compute_reports_center_kpis(department: str) -> dict:
    """
    LIVE KPIs for Reports Center (dept-aware).

    NOTE:
    - True OEE needs production data (ideal cycle time, total count, good count, planned time).
      Until you add that, we use uptime_rate as an OEE proxy (Availability).
    - "MTD Spend" in your screenshot: you currently don't store spend transactions.
      We use Downtime Cost MTD (based on DOWNTIME_COST_PER_HOUR) as a realistic proxy.
    """
    k = compute_kpi_trends(department=department)
    uptime_rate = compute_uptime_rate(department=department)

    # OEE proxy = uptime rate (availability)
    oee_score = uptime_rate

    # Month-over-month delta for uptime proxy (simple approximation):
    # Compare average uptime of assets registered before prev month? You don't store enough history for precise MoM.
    # We'll compute delta from MTTR trend direction instead (signal), or show "—" if insufficient.
    # Keep it honest:
    oee_delta = "—"

    # PM compliance (same logic as dashboard intelligence)
    intel = compute_dashboard_intelligence(department)
    pm_compliance = intel.get("pm_compliance")  # float or None

    # progress ring offset for pm compliance (stroke-dasharray 125.6)
    # offset = circumference * (1 - pct/100)
    ring_circ = 125.6
    pm_ring_offset = None
    if isinstance(pm_compliance, (int, float)):
        pm_ring_offset = ring_circ * (1.0 - (float(pm_compliance) / 100.0))

    # MTTR trend
    mttr_trend = float(k.get("mttr_trend") or 0.0)
    mttr_label = "IMPROVING" if mttr_trend < 0 else ("WORSENING" if mttr_trend > 0 else "STABLE")

    # MTTR avg hours
    mttr_avg = float(k.get("mttr_hours") or 0.0)

    # "Spend" proxy = downtime cost MTD
    downtime_mtd_hours = float(k.get("downtime_mtd_hours") or 0.0)
    mtd_spend = downtime_mtd_hours * float(DOWNTIME_COST_PER_HOUR)

    # budget proxy (optional) – if you later add a real budget per department, plug it here
    budget_limit = float(os.environ.get("REPORTS_BUDGET_LIMIT", "25600"))  # example default
    budget_pct = 0
    if budget_limit > 0:
        budget_pct = max(0, min(100, int(round((mtd_spend / budget_limit) * 100))))

    return dict(
        oee_score=f"{oee_score:.1f}%",
        oee_delta=oee_delta,

        pm_compliance=(f"{pm_compliance:.1f}%" if isinstance(pm_compliance, (int, float)) else "—"),
        pm_target="95.0%",
        pm_ring_offset=(f"{pm_ring_offset:.1f}" if pm_ring_offset is not None else "125.6"),

        mttr_trend=f"{mttr_trend:.0f}%",
        mttr_label=mttr_label,
        mttr_avg=f"{mttr_avg:.1f} Hours",

        mtd_spend=f"KES {mtd_spend:,.0f}",
        budget_pct=str(budget_pct),
        budget_limit=f"KES {budget_limit:,.0f} LIMIT",
    )


# -------------------------
# Preventive Maintenance helpers
# -------------------------
def _generate_maintenance_due_dates(first_date_iso: str, frequency: str) -> list[str]:
    """Generate future due dates so the calendar actually shows the schedule.

    Business rule: generate a practical horizon (caps per frequency) to avoid flooding the system.
    """
    d0 = parse_date_only(first_date_iso or "")
    if not d0:
        return []
    freq = normalize_frequency(frequency or "Monthly")

    # caps
    caps = {
        "Daily": 60,
        "Weekly": 52,
        "Monthly": 24,
        "Quarterly": 12,
        "Biannually": 6,
        "Yearly": 3,
    }
    n = caps.get(freq, 24)

    out = []
    cur = d0
    for _ in range(n):
        out.append(cur.strftime("%Y-%m-%d"))
        if freq == "Daily":
            cur = cur + timedelta(days=1)
        elif freq == "Weekly":
            cur = cur + timedelta(days=7)
        elif freq == "Monthly":
            # advance 1 month, keep day where possible
            m = cur.month + 1
            y = cur.year + (m - 1) // 12
            m = ((m - 1) % 12) + 1
            day = min(cur.day, [31,29 if y%4==0 and (y%100!=0 or y%400==0) else 28,31,30,31,30,31,31,30,31,30,31][m-1])
            cur = date(y, m, day)
        elif freq == "Quarterly":
            m = cur.month + 3
            y = cur.year + (m - 1) // 12
            m = ((m - 1) % 12) + 1
            day = min(cur.day, [31,29 if y%4==0 and (y%100!=0 or y%400==0) else 28,31,30,31,30,31,31,30,31,30,31][m-1])
            cur = date(y, m, day)
        elif freq == "Biannually":
            m = cur.month + 6
            y = cur.year + (m - 1) // 12
            m = ((m - 1) % 12) + 1
            day = min(cur.day, [31,29 if y%4==0 and (y%100!=0 or y%400==0) else 28,31,30,31,30,31,31,30,31,30,31][m-1])
            cur = date(y, m, day)
        else:  # Yearly
            y = cur.year + 1
            m = cur.month
            day = min(cur.day, [31,29 if y%4==0 and (y%100!=0 or y%400==0) else 28,31,30,31,30,31,31,30,31,30,31][m-1])
            cur = date(y, m, day)

    return out


def normalize_frequency(freq: str) -> str:
    s = (freq or "").strip().lower()
    mapping = {
        "daily": "Daily",
        "weekly": "Weekly",
        "monthly": "Monthly",
        "quarterly": "Quarterly",
        "bi-annually": "Bi-Annually",
        "biannually": "Bi-Annually",
        "annually": "Annually",
        "one-time": "One-time",
        "one time": "One-time",
    }
    for k, v in mapping.items():
        if s == k.lower():
            return v
    for v in mapping.values():
        if (freq or "").strip() == v:
            return v
    return "Monthly"


def normalize_priority(p: str) -> str:
    s = (p or "").strip().lower()
    if s in ("low", "medium", "high", "critical"):
        if s == "critical":
            return "high"
        return s
    return "medium"


def safe_date_str(d: str) -> str:
    return (d or "").strip()


def distinct_sections_from_assets(department: Optional[str] = None) -> list[str]:
    """Return distinct sections for the given department.

    Reports UI must never hard-fail due to missing DB tables (common on fresh setups where a
    new sqlite file gets created in the wrong working directory). The app already persists
    data in `data/datastore.json`, so we use the in-memory ASSETS list as the primary source.
    """
    items = ASSETS or []
    if department:
        items = [a for a in items if (a.get("department") or "Engineering") == department]
    ds = sorted({(a.get("section") or "").strip() for a in items if (a.get("section") or "").strip()})
    return ds if ds else SECTIONS


def build_tech_list() -> list[str]:
    techs = sorted({t for t in ([x.get("technician") for x in MAINTENANCE_TASKS] + TECHNICIANS) if t})
    return techs if techs else TECHNICIANS[:]


def task_title_from_description(desc: str) -> str:
    d = (desc or "").strip()
    if not d:
        return ""
    return d.splitlines()[0].strip()


def enrich_pm_task(t: dict) -> dict:
    t2 = dict(t)
    if t2.get("status") != "completed" and is_overdue(t2.get("due_date") or ""):
        t2["status"] = "overdue"
    t2["technician_initials"] = initials(t2.get("technician") or "") or "NA"
    t2["task_title"] = task_title_from_description(t2.get("task_description") or "")
    return t2


# -------------------------
# Error handlers
# -------------------------
@app.errorhandler(413)
def too_large(_e):
    return "Upload too large. Max 5MB per image, 10MB per document, and 30MB total request.", 413


@app.errorhandler(404)
def not_found(_e):
    return "Not found.", 404


# -------------------------
# Routes
# -------------------------
@app.before_request
def require_login_for_private_routes():
    endpoint = (request.endpoint or "").strip()
    if endpoint in AUTH_PUBLIC_ENDPOINTS:
        return None
    if request.path.startswith("/static/"):
        return None
    if not session.get("user_id"):
        return redirect(url_for("login", next=request.path))
    return None


@app.get("/")
def home():
    if not session.get("user_id"):
        return redirect(url_for("login"))
    return redirect(url_for("dashboard"))


@app.get("/login")
def login():
    active_users = [_normalize_user_record(u) for u in ADMIN_USERS if u.get("active", True)] or [_normalize_user_record(default_admin_users()[0])]
    preferred_department = (request.args.get("department") or session.get("current_department") or get_current_department() or "Engineering").strip()
    return render_template(
        "auth/login.html",
        departments=DEPARTMENTS,
        selected_department=preferred_department if preferred_department in DEPARTMENTS else "Engineering",
        remembered_email=(request.args.get("email") or session.get("user_email") or "").strip(),
        known_users=[],
        demo_admin_email="",
        password_reset_help=SYSTEM_SETTINGS.get("password_reset_help") or "Contact your administrator for help.",
        company_contact_email=SYSTEM_SETTINGS.get("company_contact_email") or "opsloom.ke@gmail.com",
    )


@app.post("/login", endpoint="login_submit")
def login_submit():
    email = (request.form.get("email") or "").strip().lower()
    password = (request.form.get("password") or "").strip()
    department = (request.form.get("department") or "Engineering").strip()
    next_url = _safe_next_url(request.form.get("next") or "")
    if _login_locked(email):
        flash("Too many failed sign-in attempts. Wait a few minutes and try again.", "error")
        return redirect(url_for("login", email=email, department=department))
    row = next((u for u in ADMIN_USERS if (u.get("email") or "").strip().lower() == email and u.get("active", True)), None)
    password_ok = False
    if row and password:
        stored_hash = (row.get("password_hash") or "").strip()
        if stored_hash:
            try:
                password_ok = check_password_hash(stored_hash, password)
            except Exception:
                password_ok = False
        else:
            password_ok = True
    if not email or not password or not row or not password_ok:
        _record_login_failure(email)
        flash("Login failed. Use an active company account and valid password.", "error")
        return redirect(url_for("login", email=email, department=department))
    _clear_login_failures(email)
    session.clear()
    session["user_id"] = row.get("id")
    session["user_email"] = row.get("email")
    session["current_department"] = department if department in DEPARTMENTS else "Engineering"
    log_audit("User login", f"{row.get('name')} signed in to the Opsloom workspace.", module="security", href=url_for("dashboard"), severity="info")
    return redirect(next_url or url_for("dashboard"))


@app.get("/login/google")
def login_google():
    email = (request.args.get("email") or session.get("user_email") or "").strip().lower()
    department = (request.args.get("department") or session.get("current_department") or "Engineering").strip()
    if not email:
        flash("Enter your company email before using Google sign-in.", "error")
        return redirect(url_for("login", department=department))
    row = next((u for u in ADMIN_USERS if (u.get("email") or "").strip().lower() == email and u.get("active", True)), None)
    if not row:
        flash("Google sign-in is only available for active registered users.", "error")
        return redirect(url_for("login", email=email, department=department))
    session["user_id"] = row.get("id")
    session["user_email"] = row.get("email")
    session["current_department"] = department if department in DEPARTMENTS else "Engineering"
    log_audit("Google sign-in", f"{row.get('name')} accessed the system using Google sign-in.", module="security", href=url_for("dashboard"), severity="success")
    return redirect(url_for("dashboard"))


@app.post("/login/request-credentials")
def request_credentials():
    email = (request.form.get("email") or "").strip()
    department = (request.form.get("department") or "Engineering").strip()
    if not email:
        flash("Enter your company email to request credentials.", "error")
        return redirect(url_for("login", department=department))
    push_notification("Credential request", f"Credential request captured for {email} ({department}).", "info", href=url_for("admin_users_page"))
    flash("Credential request captured for admin review.", "success")
    return redirect(url_for("login", email=email, department=department))


@app.post("/login/forgot-password")
def forgot_password():
    email = (request.form.get("email") or "").strip()
    department = (request.form.get("department") or "Engineering").strip()
    if not email:
        flash("Enter your company email before requesting password recovery.", "error")
        return redirect(url_for("login", department=department))
    push_notification("Password reset requested", f"Password reset request captured for {email}.", "warning", href=url_for("admin_users_page"), module="security")
    flash(f"Password reset request captured. {SYSTEM_SETTINGS.get('password_reset_help') or 'Contact the administrator for help.'}", "success")
    return redirect(url_for("login", email=email, department=department))


# -------------------------
# ASSET REGISTER (LIST + FILTERS + PAGINATION) - department aware
# -------------------------
@app.get("/assets")
def assets_master_list():
    ctx = base_ctx("assets")
    # Pre-compute upload URL so templates never break if endpoint names change
    try:
        ctx["documents_upload_url"] = url_for("assets_documents_upload_get", asset_uid=asset_uid)
    except Exception:
        try:
            ctx["documents_upload_url"] = url_for("assets_documents_upload_get", asset_uid=asset_uid)
        except Exception:
            ctx["documents_upload_url"] = "#"

    ctx["sections"] = SECTIONS

    dept = get_current_department()

    q = (request.args.get("q") or "").strip()
    section = (request.args.get("section") or "").strip()
    status = (request.args.get("status") or "").strip()
    criticality = (request.args.get("criticality") or "").strip()

    try:
        per_page = int(request.args.get("per_page") or 10)
    except ValueError:
        per_page = 10
    per_page = per_page if per_page in (5, 10, 20, 50) else 10

    try:
        page = int(request.args.get("page") or 1)
    except ValueError:
        page = 1
    page = max(page, 1)

    # department filter as default
    filtered = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]

    if q:
        ql = q.lower()

        def match(a):
            return (
                ql in (a.get("asset_id") or "").lower()
                or ql in (a.get("asset_name") or "").lower()
                or ql in (a.get("serial_no") or "").lower()
                or ql in (a.get("manufacturer") or "").lower()
                or ql in (a.get("model_number") or "").lower()
                or ql in (a.get("supplier") or "").lower()
            )

        filtered = [a for a in filtered if match(a)]

    if section:
        filtered = [a for a in filtered if (a.get("section") or "") == section]
    if status:
        filtered = [a for a in filtered if (a.get("status") or "") == status]
    if criticality:
        filtered = [a for a in filtered if (a.get("criticality") or "") == criticality]

    filtered = _visible_management_tasks(filtered, status)

    total = len(filtered)
    total_all = len([a for a in ASSETS if (a.get("department") or "Engineering") == dept])

    operational_count = sum(1 for a in ASSETS if (a.get("department") or "Engineering") == dept and a.get("status") == "operational")
    maintenance_count = sum(1 for a in ASSETS if (a.get("department") or "Engineering") == dept and a.get("status") == "maintenance")
    oos_count = sum(1 for a in ASSETS if (a.get("department") or "Engineering") == dept and a.get("status") == "out_of_service")

    availability = (operational_count / total_all * 100.0) if total_all > 0 else 0.0

    start = (page - 1) * per_page
    end = start + per_page
    page_assets = filtered[start:end]

    total_pages = max(1, (total + per_page - 1) // per_page)
    if page > total_pages:
        page = total_pages
        start = (page - 1) * per_page
        end = start + per_page
        page_assets = filtered[start:end]

    showing_from = 0 if total == 0 else start + 1
    showing_to = min(end, total)

    ctx.update(
        assets=page_assets,
        kpi_total=total_all,
        kpi_operational=operational_count,
        kpi_maintenance=maintenance_count,
        kpi_oos=oos_count,
        kpi_availability=availability,
        q=q,
        selected_section=section,
        selected_status=status,
        selected_criticality=criticality,
        per_page=per_page,
        page=page,
        total=total,
        total_pages=total_pages,
        showing_from=showing_from,
        showing_to=showing_to,
        pages=build_pagination(page, total_pages),
    )
    return render_template("assets/assets_master_list.html", **ctx)


@app.get("/assets/export/<fmt>")
def assets_export(fmt):
    dept = get_current_department()
    q = (request.args.get("q") or "").strip()
    section = (request.args.get("section") or "").strip()
    status = (request.args.get("status") or "").strip()
    criticality = (request.args.get("criticality") or "").strip()

    filtered = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]
    if q:
        ql = q.lower()
        filtered = [
            a for a in filtered
            if ql in (a.get("asset_id") or "").lower()
            or ql in (a.get("asset_name") or "").lower()
            or ql in (a.get("serial_no") or "").lower()
            or ql in (a.get("manufacturer") or "").lower()
            or ql in (a.get("model_number") or "").lower()
            or ql in (a.get("supplier") or "").lower()
        ]
    if section:
        filtered = [a for a in filtered if (a.get("section") or "") == section]
    if status:
        filtered = [a for a in filtered if (a.get("status") or "") == status]
    if criticality:
        filtered = [a for a in filtered if (a.get("criticality") or "") == criticality]

    rows = [
        {
            "asset_id": a.get("asset_id") or "",
            "asset_name": a.get("asset_name") or "",
            "section": a.get("section") or "",
            "serial_no": a.get("serial_no") or "",
            "status": (a.get("status") or "").replace("_", " ").title(),
            "criticality": a.get("criticality") or "",
            "manufacturer": a.get("manufacturer") or "",
            "model_number": a.get("model_number") or "",
            "supplier": a.get("supplier") or "",
        }
        for a in filtered
    ]
    return export_rows_file(
        fmt,
        "asset_register",
        "Asset Register",
        [
            ("Asset ID", "asset_id"),
            ("Asset Name", "asset_name"),
            ("Section", "section"),
            ("Serial No.", "serial_no"),
            ("Status", "status"),
            ("Criticality", "criticality"),
            ("Manufacturer", "manufacturer"),
            ("Model Number", "model_number"),
            ("Supplier", "supplier"),
        ],
        rows,
    )


# -------------------------
# ASSETS: STEP 1/2/3 + SUCCESS + DELETE + EDIT
# -------------------------
@app.get("/assets/new/step-1")
def assets_add_step1_get():
    ctx = base_ctx("assets")
    saved = session.get("asset_step1", {})
    ctx.update(dict(sections=SECTIONS, form=saved or {}, error=None))
    return render_template("assets/assets_add_step1.html", **ctx)


@app.post("/assets/new/step-1")
def assets_add_step1_post():
    asset_name = request.form.get("asset_name", "").strip()
    asset_id = request.form.get("asset_id", "").strip()
    section = request.form.get("section", "").strip()
    serial_no = request.form.get("serial_no", "").strip()
    manufacturer = request.form.get("manufacturer", "").strip()

    # 3.2 Add department field (store on asset step1)
    department = (request.form.get("department") or get_current_department()).strip()
    if department not in DEPARTMENTS:
        department = "Engineering"

    form = dict(
        asset_name=asset_name,
        asset_id=asset_id,
        section=section,
        serial_no=serial_no,
        manufacturer=manufacturer,
        department=department,
    )

    if not asset_name or not asset_id or not section:
        ctx = base_ctx("assets")
        ctx.update(dict(sections=SECTIONS, form=form, error="Please fill all required fields."))
        return render_template("assets/assets_add_step1.html", **ctx), 400

    session["asset_step1"] = form
    return redirect(url_for("assets_add_step2_get"))


@app.get("/assets/new/step-2")
def assets_add_step2_get():
    if not session.get("asset_step1"):
        return redirect(url_for("assets_add_step1_get"))

    ctx = base_ctx("assets")
    form = session.get("asset_step2", {})
    ctx.update(dict(form=form, error=None))
    return render_template("assets/assets_add_step2.html", **ctx)


@app.post("/assets/new/step-2")
def assets_add_step2_post():
    if not session.get("asset_step1"):
        return redirect(url_for("assets_add_step1_get"))

    data = {
        "model_number": request.form.get("model_number", "").strip(),
        "power_rating": request.form.get("power_rating", "").strip(),
        "supplier": request.form.get("supplier", "").strip(),
        "installation_date": request.form.get("installation_date", "").strip(),
        "year_of_manufacture": request.form.get("year_of_manufacture", "").strip(),
        "warranty_expiry": request.form.get("warranty_expiry", "").strip(),
        "technical_notes": request.form.get("technical_notes", "").strip(),
    }

    session["asset_step2"] = data
    return redirect(url_for("assets_add_step3_get"))


@app.get("/assets/new/step-3")
def assets_add_step3_get():
    if not session.get("asset_step1") or not session.get("asset_step2"):
        return redirect(url_for("assets_add_step1_get"))

    ctx = base_ctx("assets")
    form = session.get("asset_step3", {})
    ctx.update(dict(form=form, error=None))
    return render_template("assets/assets_add_step3.html", **ctx)


@app.post("/assets/new/step-3")
def assets_add_step3_post():
    if not session.get("asset_step1") or not session.get("asset_step2"):
        return redirect(url_for("assets_add_step1_get"))

    status = request.form.get("status", "operational").strip()
    criticality = request.form.get("criticality", "A").strip()

    previous = session.get("asset_step3", {})
    photo_url = previous.get("photo_url")

    file = request.files.get("asset_photo")
    if file and file.filename:
        try:
            photo_url = save_uploaded_image(file, ASSET_UPLOAD_DIR, "uploads/assets")
        except ValueError as e:
            ctx = base_ctx("assets")
            ctx.update(
                dict(
                    form={"status": status, "criticality": criticality, "photo_url": photo_url},
                    error=str(e) if str(e) else "Invalid upload.",
                )
            )
            return render_template("assets/assets_add_step3.html", **ctx), 400

    session["asset_step3"] = {"status": status, "criticality": criticality, "photo_url": photo_url}

    registered_at = datetime.now().isoformat(timespec="seconds")
    asset_payload = {
        "uid": uuid4().hex,
        "registered_at": registered_at,
        **session.get("asset_step1", {}),
        **session.get("asset_step2", {}),
        **session.get("asset_step3", {}),
    }

    _ensure_status_history(asset_payload)

    if (asset_payload.get("status") or "").strip() == "maintenance":
        asset_payload["status_history"][0]["reason"] = "registration_maintenance"

    ASSETS.insert(0, asset_payload)
    push_notification("Asset added", f"{asset_payload.get('asset_name') or 'Asset'} was registered successfully.", "success", href=url_for("assets_profile_get", asset_uid=asset_payload["uid"]), module="assets")

    session.pop("asset_step1", None)
    session.pop("asset_step2", None)
    session.pop("asset_step3", None)

    prompt = "1" if (asset_payload.get("status") or "").strip() == "maintenance" else "0"
    return redirect(url_for("assets_success", asset_uid=asset_payload["uid"], prompt_wo=prompt))


@app.get("/assets/success/<asset_uid>")
def assets_success(asset_uid):
    ctx = base_ctx("assets")
    asset = next((a for a in ASSETS if a.get("uid") == asset_uid), None)
    if not asset:
        abort(404)

    prompt_wo = (request.args.get("prompt_wo") or "0").strip() == "1"

    ctx.update(
        asset=asset,
        show_workorder_prompt=prompt_wo,
        link_log_breakdown=url_for(
            "breakdowns_new_step1_get",
            section=(asset.get("section") or "").strip(),
            asset_uid=asset_uid,
            from_asset="1",
        ),
        link_open_work_order=url_for(
            "maintenance_schedule_step1",
            section=(asset.get("section") or "").strip(),
            asset_uid=asset_uid,
            from_asset="1",
        ),
    )
    return render_template("assets/assets_success.html", **ctx)


@app.get("/assets/<asset_uid>/action/log-breakdown")
def asset_action_log_breakdown(asset_uid):
    a = _asset_by_uid(asset_uid)
    if not a:
        abort(404)
    return redirect(url_for("breakdowns_new_step1_get", section=(a.get("section") or ""), asset_uid=asset_uid, from_asset="1"))


@app.get("/assets/<asset_uid>/action/open-work-order")
def asset_action_open_work_order(asset_uid):
    a = _asset_by_uid(asset_uid)
    if not a:
        abort(404)
    return redirect(url_for("maintenance_schedule_step1", section=(a.get("section") or ""), asset_uid=asset_uid, from_asset="1"))


@app.post("/assets/<asset_uid>/delete")
def assets_delete(asset_uid):
    idx = next((i for i, a in enumerate(ASSETS) if a.get("uid") == asset_uid), None)
    if idx is None:
        abort(404)

    deleted = ASSETS.pop(idx)
    push_notification("Asset deleted", f"{deleted.get('asset_name') or deleted.get('asset_id') or 'Asset'} was removed from the register.", "warning", href=url_for("assets_master_list"), module="assets")
    next_url = request.form.get("next") or url_for("assets_master_list")
    return redirect(next_url)


@app.get("/assets/<asset_uid>/edit")
def assets_edit_get(asset_uid):
    ctx = base_ctx("assets")
    asset = next((a for a in ASSETS if a.get("uid") == asset_uid), None)
    if not asset:
        abort(404)
    ctx.update(asset=asset, sections=SECTIONS, departments=DEPARTMENTS, error=None)
    return render_template("assets/assets_edit.html", **ctx)


@app.post("/assets/<asset_uid>/edit")
def assets_edit_post(asset_uid):
    asset = next((a for a in ASSETS if a.get("uid") == asset_uid), None)
    if not asset:
        abort(404)

    asset_name = (request.form.get("asset_name") or "").strip()
    asset_id = (request.form.get("asset_id") or "").strip()
    section = (request.form.get("section") or "").strip()
    scope_mode = (request.form.get("scope_mode") or "assets").strip().lower()
    if scope_mode not in ("assets", "section", "department"):
        scope_mode = "assets"

    department = (request.form.get("department") or asset.get("department") or get_current_department()).strip()
    if department not in DEPARTMENTS:
        department = "Engineering"

    if not asset_name or not asset_id or not section:
        ctx = base_ctx("assets")
        ctx.update(asset=asset, sections=SECTIONS, departments=DEPARTMENTS, error="Asset Name, Asset ID and Section are required.")
        return render_template("assets/assets_edit.html", **ctx), 400

    asset.update(
        asset_name=asset_name,
        asset_id=asset_id,
        section=section,
        department=department,
        serial_no=(request.form.get("serial_no") or "").strip(),
        manufacturer=(request.form.get("manufacturer") or "").strip(),
        model_number=(request.form.get("model_number") or "").strip(),
        power_rating=(request.form.get("power_rating") or "").strip(),
        supplier=(request.form.get("supplier") or "").strip(),
        installation_date=(request.form.get("installation_date") or "").strip(),
        year_of_manufacture=(request.form.get("year_of_manufacture") or "").strip(),
        warranty_expiry=(request.form.get("warranty_expiry") or "").strip(),
        technical_notes=(request.form.get("technical_notes") or "").strip(),
        category=(request.form.get("category") or "").strip(),
        location=(request.form.get("location") or "").strip(),
        service_provider=(request.form.get("service_provider") or "").strip(),
        asset_value=(request.form.get("asset_value") or "").strip(),
        oem=(request.form.get("oem") or "").strip(),
    )

    push_notification("Asset updated", f"{asset.get('asset_name') or asset.get('asset_id') or 'Asset'} details were updated.", "success", href=url_for("assets_profile_get", asset_uid=asset_uid), module="assets")
    return redirect(url_for("assets_profile_get", asset_uid=asset_uid))


# -------------------------
# ASSET PROFILE: NEW TAB ROUTES
# -------------------------
def _asset_or_404(asset_uid: str) -> dict:
    asset = next((a for a in ASSETS if a.get("uid") == asset_uid), None)
    if not asset:
        abort(404)
    return asset


def _asset_identity_tokens(asset: dict) -> set[str]:
    tokens = set()
    for key in ("uid", "asset_uid", "asset_id", "asset_name", "machine_name", "name", "serial_number"):
        val = (asset or {}).get(key)
        if val is None:
            continue
        s = str(val).strip().lower()
        if s:
            tokens.add(s)
    return tokens


def _part_linked_to_asset(part: dict, asset: dict) -> bool:
    if not part or not asset:
        return False
    asset_tokens = _asset_identity_tokens(asset)
    linked = set()
    raw_multi = part.get("compatible_assets") or []
    if isinstance(raw_multi, str):
        raw_multi = [raw_multi]
    for item in raw_multi:
        s = str(item).strip().lower()
        if s:
            linked.add(s)
    for key in ("asset_uid", "asset_id", "asset_name", "machine_name", "name"):
        val = part.get(key)
        if val is None:
            continue
        s = str(val).strip().lower()
        if s:
            linked.add(s)
    return bool(asset_tokens & linked)


def _inventory_part_to_asset_spare(part: dict, asset: dict) -> dict:
    return {
        "id": part.get("uid") or part.get("id") or uuid4().hex,
        "uid": part.get("uid") or part.get("id") or uuid4().hex,
        "asset_uid": asset.get("uid"),
        "part_name": part.get("part_name"),
        "part_no": part.get("part_no") or part.get("sku"),
        "sku": part.get("sku") or part.get("part_no"),
        "qty": _safe_int(part.get("qty"), 0) or 0,
        "vendor": part.get("vendor") or part.get("supplier"),
        "supplier": part.get("supplier") or part.get("vendor"),
        "category": part.get("category"),
        "min_qty": _safe_int(part.get("min_qty"), 0) or 0,
        "target_qty": _safe_int(part.get("target_qty"), None),
        "lead_time_days": _safe_int(part.get("lead_time_days"), None),
        "photo_url": part.get("photo_url"),
        "is_critical": bool(part.get("is_critical")),
        "unit_cost": _safe_float(part.get("unit_cost") if part.get("unit_cost") is not None else part.get("unit_price"), None),
        "cost": _safe_float(part.get("cost"), None),
        "storage_location": part.get("storage_location"),
        "manufacturer": part.get("manufacturer"),
        "model_number": part.get("model_number"),
        "tech_specs": part.get("tech_specs"),
        "doc_url": part.get("doc_url"),
        "created_at": part.get("created_at"),
        "created_by": part.get("created_by"),
        "source": part.get("source") or "inventory",
    }


def _asset_linked_spare_parts(asset: dict, q: str = "", category: str = "", stock_state: str = ""):
    linked_parts = []
    seen = set()
    asset_uid = asset.get("uid")

    for p in SPARE_PARTS:
        if p.get("asset_uid") == asset_uid:
            mapped = dict(p)
            mapped.setdefault("id", p.get("uid") or p.get("id") or uuid4().hex)
            mapped.setdefault("uid", p.get("uid") or p.get("id") or mapped.get("id"))
            key = (str(mapped.get("sku") or mapped.get("part_no") or mapped.get("uid") or mapped.get("id") or "").strip().lower(), asset_uid)
            if key not in seen:
                linked_parts.append(mapped)
                seen.add(key)

    for p in INVENTORY_PARTS:
        if _part_linked_to_asset(p, asset):
            mapped = _inventory_part_to_asset_spare(p, asset)
            key = (str(mapped.get("sku") or mapped.get("part_no") or mapped.get("uid") or mapped.get("id") or "").strip().lower(), asset_uid)
            if key not in seen:
                linked_parts.append(mapped)
                seen.add(key)

    categories = sorted({str(p.get("category") or "").strip() for p in linked_parts if str(p.get("category") or "").strip()})

    ql = (q or "").strip().lower()
    selected_category = (category or "").strip().lower()
    selected_stock_state = (stock_state or "").strip().lower()

    def _match_text(p: dict) -> bool:
        if not ql:
            return True
        hay = " ".join(
            [
                str(p.get("part_name") or ""),
                str(p.get("sku") or ""),
                str(p.get("part_no") or ""),
                str(p.get("category") or ""),
                str(p.get("supplier") or p.get("vendor") or ""),
                str(p.get("storage_location") or ""),
            ]
        ).lower()
        return ql in hay

    def _match_category(p: dict) -> bool:
        if not selected_category:
            return True
        return str(p.get("category") or "").strip().lower() == selected_category

    def _match_stock(p: dict) -> bool:
        if not selected_stock_state:
            return True
        return inventory_stock_state(p) == selected_stock_state

    linked_parts = [p for p in linked_parts if _match_text(p) and _match_category(p) and _match_stock(p)]
    linked_parts = sorted(
        linked_parts,
        key=lambda p: (
            inventory_stock_state(p) != "out_of_stock",
            inventory_stock_state(p) != "low_stock",
            str(p.get("part_name") or "").lower(),
        ),
    )
    return linked_parts, categories


def _sync_inventory_part_links_to_spares(part: dict):
    raw_multi = part.get("compatible_assets") or []
    if isinstance(raw_multi, str):
        raw_multi = [raw_multi]
    wanted = {str(x).strip() for x in raw_multi if str(x).strip()}
    if not wanted:
        return
    existing = {(str(s.get("asset_uid") or ""), str(s.get("sku") or s.get("part_no") or "").lower()): i for i, s in enumerate(SPARE_PARTS)}
    for asset_uid in wanted:
        asset = next((a for a in ASSETS if a.get("uid") == asset_uid), None)
        if not asset:
            continue
        spare = _inventory_part_to_asset_spare(part, asset)
        key = (asset_uid, str(spare.get("sku") or spare.get("part_no") or "").lower())
        idx = existing.get(key)
        if idx is not None:
            SPARE_PARTS[idx].update(spare)
        else:
            SPARE_PARTS.insert(0, spare)



def _compute_asset_overview(asset_uid: str):
    asset_tasks = [t for t in MAINTENANCE_TASKS if t.get("asset_uid") == asset_uid]
    asset_tasks_sorted = sorted(asset_tasks, key=lambda x: (x.get("due_date") or "9999-12-31"), reverse=True)
    recent_maintenance = [enrich_pm_task(t) for t in asset_tasks_sorted[:3]]

    asset_breakdowns = [b for b in BREAKDOWNS if b.get("asset_uid") == asset_uid]
    asset_breakdowns_sorted = sorted(asset_breakdowns, key=lambda x: (x.get("reported_dt") or ""), reverse=True)

    recent_breakdowns = []
    for b in asset_breakdowns_sorted[:3]:
        reported_date, _reported_time = human_dt_parts(b.get("reported_dt") or "")
        status = b.get("status") or "open"
        if status == "resolved":
            mins = b.get("duration_mins")
            downtime = fmt_hm_from_minutes(mins if isinstance(mins, int) else 0)
        else:
            mins = minutes_between(b.get("reported_dt") or "", datetime.now().isoformat(timespec="seconds"))
            downtime = fmt_hm_from_minutes(mins or 0)

        recent_breakdowns.append(
            dict(
                breakdown_id=b.get("breakdown_id"),
                incident_title=b.get("incident_title") or "",
                reported_date=reported_date,
                downtime=downtime,
                status_label=safe_status_label(status),
            )
        )

    mtbf_hours = None
    reported_times = []
    for b in asset_breakdowns:
        dt = parse_iso_dt(b.get("reported_dt") or "")
        if dt:
            reported_times.append(dt)
    reported_times.sort()
    if len(reported_times) >= 2:
        gaps = []
        for i in range(1, len(reported_times)):
            gaps.append((reported_times[i] - reported_times[i - 1]).total_seconds() / 3600.0)
        if gaps:
            mtbf_hours = int(round(sum(gaps) / len(gaps)))

    return recent_maintenance, recent_breakdowns, mtbf_hours


@app.get("/assets/<asset_uid>")
def assets_profile_get(asset_uid):
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)

    recent_maintenance, recent_breakdowns, mtbf_hours = _compute_asset_overview(asset_uid)
    asset_tasks = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if _norm_str(t.get("asset_uid")) == _norm_str(asset_uid)]
    asset_breakdowns = [b for b in BREAKDOWNS if _norm_str(b.get("asset_uid")) == _norm_str(asset_uid)]
    maintenance_cost_subtotal = round(sum((_safe_float(t.get("cost_subtotal"), 0.0) or 0.0) for t in asset_tasks), 2)
    breakdown_cost_subtotal = round(sum((_safe_float(b.get("cost_subtotal"), 0.0) or 0.0) for b in asset_breakdowns), 2)
    maintenance_cost_total = round(sum((_safe_float(t.get("cost_total"), 0.0) or 0.0) for t in asset_tasks), 2)
    breakdown_cost_total = round(sum((_safe_float(b.get("cost_total"), 0.0) or 0.0) for b in asset_breakdowns), 2)
    maintenance_vat_total = round(sum((_safe_float(t.get("cost_vat_amount"), 0.0) or 0.0) for t in asset_tasks), 2)
    breakdown_vat_total = round(sum((_safe_float(b.get("cost_vat_amount"), 0.0) or 0.0) for b in asset_breakdowns), 2)
    vat_rates = sorted({round(_safe_float(x.get("cost_vat_pct"), 0.0) or 0.0, 2) for x in (asset_tasks + asset_breakdowns) if (_safe_float(x.get("cost_vat_pct"), None) is not None)})
    vat_rate_label = ", ".join((f"{r:g}%" for r in vat_rates if r > 0)) or "No VAT applied"

    ctx.update(
        asset=asset,
        current_tab="overview",
        recent_maintenance=recent_maintenance,
        recent_breakdowns=recent_breakdowns,
        mtbf_hours=mtbf_hours,
        maintenance_cost_subtotal=maintenance_cost_subtotal,
        breakdown_cost_subtotal=breakdown_cost_subtotal,
        maintenance_cost_total=maintenance_cost_total,
        breakdown_cost_total=breakdown_cost_total,
        maintenance_vat_total=maintenance_vat_total,
        breakdown_vat_total=breakdown_vat_total,
        vat_rate_label=vat_rate_label,
        total_vat=round(maintenance_vat_total + breakdown_vat_total, 2),
        total_cost=round(maintenance_cost_total + breakdown_cost_total, 2),
        print_mode=((request.args.get("print") or "").strip().lower() in ("1", "true", "yes")),
    )
    if ctx["print_mode"]:
        return render_template("assets/assets_profile_print.html", **ctx)
    return render_template("assets/assets_profile.html", **ctx)




@app.get("/assets/<asset_uid>/profile.pdf", endpoint="assets_profile_pdf")
def assets_profile_pdf(asset_uid):
    if not REPORTLAB_AVAILABLE:
        return ("PDF export requires ReportLab. Install it with: python -m pip install reportlab", 503)

    asset = _asset_or_404(asset_uid)
    recent_maintenance, recent_breakdowns, mtbf_hours = _compute_asset_overview(asset_uid)
    asset_tasks = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if _norm_str(t.get("asset_uid")) == _norm_str(asset_uid)]
    asset_breakdowns = [b for b in BREAKDOWNS if _norm_str(b.get("asset_uid")) == _norm_str(asset_uid)]
    maintenance_cost_total = round(sum((_safe_float(t.get("cost_total"), 0.0) or 0.0) for t in asset_tasks), 2)
    breakdown_cost_total = round(sum((_safe_float(b.get("cost_total"), 0.0) or 0.0) for b in asset_breakdowns), 2)

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    top_y = H - 24
    header_path = ULTRAVETIS_HEADER if os.path.exists(ULTRAVETIS_HEADER) else None
    logo_path = ULTRAVETIS_LOGO if os.path.exists(ULTRAVETIS_LOGO) else None
    if header_path:
        try:
            c.drawImage(header_path, 18, top_y - 58, width=W - 36, height=46, preserveAspectRatio=True, mask="auto")
        except Exception:
            header_path = None
    if not header_path and logo_path and os.path.exists(logo_path):
        try:
            c.drawImage(logo_path, 22, top_y - 42, width=100, height=34, mask="auto")
        except Exception:
            pass
        c.setFont("Helvetica", 8)
        for i, line in enumerate(ULTRAVETIS_ADDRESS_LINES):
            c.drawCentredString(W/2, top_y - 10 - (i * 10), line)

    c.setFont("Helvetica-Bold", 18)
    c.drawString(22*mm, H - 38*mm, "Asset Profile Report")
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.HexColor("#475569"))
    c.drawString(22*mm, H - 44*mm, "Formal asset master record for engineering review, audit filing, and reliability planning.")
    c.setFillColor(colors.black)

    def draw_kv(title, rows, x, y, width_mm=84):
        data = [[title, ""]] + [[a,b] for a,b in rows]
        t = Table(data, colWidths=[30*mm, width_mm*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#F8FAFC")),
            ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTNAME", (0,1), (0,-1), "Helvetica-Bold"),
            ("FONTNAME", (1,1), (-1,-1), "Helvetica"),
            ("FONTSIZE", (0,0), (-1,-1), 9),
            ("GRID", (0,0), (-1,-1), 0.3, colors.HexColor("#CBD5E1")),
            ("VALIGN", (0,0), (-1,-1), "TOP"),
            ("TOPPADDING", (0,0), (-1,-1), 5),
            ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ]))
        t.wrapOn(c, 0, 0)
        t.drawOn(c, x, y - t._height)
        return y - t._height - 8

    y = H - 54*mm
    summary_rows = [
        ("Asset", asset.get("asset_name") or "—"),
        ("Asset ID", asset.get("asset_id") or "—"),
        ("Section", asset.get("section") or "—"),
        ("Status", safe_status_label(asset.get("status") or "operational")),
        ("Criticality", asset.get("criticality") or "—"),
        ("MTBF", (f"{mtbf_hours} hrs" if mtbf_hours else "—")),
    ]
    y_left = draw_kv("Asset Snapshot", summary_rows, 18*mm, y, width_mm=60)
    finance_rows = [
        ("Asset Value", str(asset.get("asset_value") or "—")),
        ("Maintenance Cost", f"KES {maintenance_cost_total:,.2f}"),
        ("Breakdown Cost", f"KES {breakdown_cost_total:,.2f}"),
        ("VAT Total", f"KES {maintenance_vat_total + breakdown_vat_total:,.2f}"),
        ("Combined Cost", f"KES {maintenance_cost_total + breakdown_cost_total:,.2f}"),
        ("Supplier", asset.get("supplier") or "—"),
        ("OEM", asset.get("oem") or "—"),
    ]
    y_right = draw_kv("Commercial & Cost", finance_rows, 112*mm, y, width_mm=62)
    y = min(y_left, y_right) - 4

    recent_maint_rows = []
    for t in asset_tasks[:6]:
        recent_maint_rows.append(((t.get("due_date") or "—"), f"{(t.get('maintenance_type') or 'PM')} • {(t.get('frequency') or '—')} • {(t.get('status') or '—').replace('_',' ').title()}"))
    if not recent_maint_rows:
        recent_maint_rows = [("No maintenance", "No maintenance activity logged for this asset.")]
    y = draw_kv("Maintenance Activity", recent_maint_rows, 18*mm, y, width_mm=156)

    br_rows = []
    for b in asset_breakdowns[:6]:
        when = (parse_iso_dt(b.get("reported_dt") or "") or datetime.now()).strftime("%Y-%m-%d %H:%M") if b.get("reported_dt") else "—"
        br_rows.append((when, f"{b.get('incident_title') or 'Incident'} • {(b.get('status') or 'open').replace('_',' ').title()} • KES {(_safe_float(b.get('cost_total'),0.0) or 0.0):,.2f}"))
    if not br_rows:
        br_rows = [("No breakdowns", "No breakdown activity logged for this asset.")]
    y = draw_kv("Breakdown Activity", br_rows, 18*mm, y, width_mm=156)

    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#64748B"))
    c.drawRightString(W - 18*mm, 12*mm, f"Generated {datetime.now().strftime('%d %b %Y %H:%M')}")
    c.save()
    pdf = buf.getvalue(); buf.close()
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": f"attachment; filename=asset_profile_{(asset.get('asset_id') or asset_uid)}.pdf"})
@app.get("/assets/<asset_uid>/spare-parts")
def assets_spare_parts_get(asset_uid):
    """Asset-linked spare parts view."""
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)

    page = request.args.get("page", default=1, type=int)
    per_page = request.args.get("per_page", default=10, type=int)
    per_page = 10 if per_page < 1 else min(per_page, 100)
    page = 1 if page < 1 else page

    q = (request.args.get("q") or "").strip()
    selected_category = (request.args.get("category") or "").strip()
    selected_stock_state = (request.args.get("stock_state") or "").strip()

    linked_parts, categories = _asset_linked_spare_parts(asset, q=q, category=selected_category, stock_state=selected_stock_state)

    total = len(linked_parts)
    critical_spares = sum(1 for p in linked_parts if p.get("is_critical"))
    out_of_stock = sum(1 for p in linked_parts if inventory_stock_state(p) == "out_of_stock")
    low_stock = sum(1 for p in linked_parts if inventory_stock_state(p) == "low_stock")

    inv_value = 0.0
    has_any_cost = False
    for p in linked_parts:
        qty = float(p.get("qty") or 0)
        unit_cost = p.get("unit_cost") if p.get("unit_cost") is not None else p.get("cost")
        try:
            if unit_cost is not None:
                has_any_cost = True
                inv_value += qty * float(unit_cost)
        except Exception:
            pass
    total_inventory_value = kes0(inv_value) if has_any_cost else "—"

    in_stock = max(0, total - low_stock - out_of_stock)
    donut = {
        "total": total,
        "in_stock": in_stock,
        "low_stock": low_stock,
        "out_stock": out_of_stock,
        "in_pct": int(round((in_stock / total) * 100)) if total else 0,
        "low_pct": int(round((low_stock / total) * 100)) if total else 0,
        "out_pct": int(round((out_of_stock / total) * 100)) if total else 0,
    }

    urgent = []
    for p in linked_parts:
        qty = _safe_int(p.get("qty"), 0) or 0
        minq = _safe_int(p.get("min_qty"), 0) or 0
        is_out = qty <= 0
        is_low = (not is_out) and (minq > 0) and (qty <= minq)
        if is_out or is_low:
            urgent.append(
                {
                    "part_name": p.get("part_name") or "Part",
                    "qty": qty,
                    "min_qty": minq,
                    "lead_time_days": p.get("lead_time_days"),
                    "urgent_reason": p.get("urgent_reason"),
                }
            )
    urgent_count = len(urgent)

    total_pages = max(1, ceil(total / per_page)) if per_page else 1
    page = min(page, total_pages)
    start = (page - 1) * per_page
    end = start + per_page
    paged_parts = linked_parts[start:end]
    showing_from = 0 if total == 0 else (start + 1)
    showing_to = min(end, total)

    ctx.update({
        "asset": asset,
        "linked_parts": paged_parts,
        "categories": categories,
        "selected_category": selected_category,
        "selected_stock_state": selected_stock_state,
        "kpis": {
            "total_linked_parts": total,
            "critical_spares": critical_spares,
            "low_stock_alerts": low_stock,
            "out_of_stock": out_of_stock,
            "total_inventory_value": total_inventory_value,
        },
        "donut": donut,
        "urgent": urgent[:10],
        "urgent_count": urgent_count,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "pages": build_pagination(page, total_pages),
        "showing_from": showing_from,
        "showing_to": showing_to,
        "q": q,
    })

    return render_template("assets/assets_spare_parts.html", **ctx)


@app.get("/assets/<asset_uid>/spare-parts/link")
def assets_spare_parts_link_get(asset_uid):
    """
    Keep this route so the 'LINK NEW PART' button never 404s.
    If you later add a dedicated linking UI, swap the redirect with render_template(...).
    """
    return redirect(url_for("assets_spare_parts_get", asset_uid=asset_uid))


@app.get("/assets/<asset_uid>/spare-parts/export/<fmt>")
def assets_spare_parts_export(asset_uid, fmt):
    asset = _asset_or_404(asset_uid)
    q = (request.args.get("q") or "").strip()
    selected_category = (request.args.get("category") or "").strip()
    selected_stock_state = (request.args.get("stock_state") or "").strip()
    linked_parts, _categories = _asset_linked_spare_parts(asset, q=q, category=selected_category, stock_state=selected_stock_state)

    columns = [
        ("Part Name", "part_name"),
        ("SKU", "sku"),
        ("Category", "category"),
        ("Current Stock", "current_stock"),
        ("Minimum Stock", "minimum_stock"),
        ("Lead Time (Days)", "lead_time_days"),
        ("Supplier", "supplier"),
        ("Stock Status", "stock_status"),
        ("Critical", "critical"),
        ("Storage Location", "storage_location"),
    ]
    rows = []
    for part in linked_parts:
        rows.append(
            {
                "part_name": part.get("part_name") or "—",
                "sku": part.get("sku") or part.get("part_no") or "—",
                "category": part.get("category") or "—",
                "current_stock": _safe_int(part.get("qty"), 0) or 0,
                "minimum_stock": _safe_int(part.get("min_qty"), 0) or 0,
                "lead_time_days": part.get("lead_time_days") or "—",
                "supplier": part.get("supplier") or part.get("vendor") or "—",
                "stock_status": inventory_stock_state(part).replace("_", " ").title(),
                "critical": "Yes" if part.get("is_critical") else "No",
                "storage_location": part.get("storage_location") or "—",
            }
        )
    filename_root = 'asset_spare_parts_' + re.sub(r'[^a-z0-9]+', '_', str(asset.get('asset_id') or asset.get('asset_name') or asset_uid).lower()).strip('_')
    return export_rows_file(fmt, filename_root, f"Asset Spare Parts - {asset.get('asset_name') or asset_uid}", columns, rows)


@app.get("/assets/<asset_uid>/spare-parts/<part_uid>")
def asset_spare_part_view(asset_uid, part_uid):
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)
    linked_parts, _categories = _asset_linked_spare_parts(asset)
    part_uid_norm = str(part_uid or "").strip().lower()

    part = next(
        (
            p
            for p in linked_parts
            if str(p.get("uid") or p.get("id") or "").strip().lower() == part_uid_norm
            or str(p.get("sku") or p.get("part_no") or "").strip().lower() == part_uid_norm
        ),
        None,
    )
    if not part:
        abort(404)

    linked_assets = [asset]
    for raw in INVENTORY_PARTS:
        same_uid = str(raw.get("uid") or raw.get("id") or "").strip().lower() == part_uid_norm
        same_sku = str(raw.get("sku") or raw.get("part_no") or "").strip().lower() == str(part.get("sku") or part.get("part_no") or "").strip().lower()
        if same_uid or same_sku:
            raw_links = raw.get("compatible_assets") or []
            if isinstance(raw_links, str):
                raw_links = [raw_links]
            linked_assets = [a for a in ASSETS if a.get("uid") in raw_links] or [asset]
            break

    min_qty = _safe_int(part.get("min_qty"), 0) or 0
    target_qty = _safe_int(part.get("target_qty"), None)
    current_qty = _safe_int(part.get("qty"), 0) or 0
    target_qty = target_qty or (min_qty * 2 if min_qty > 0 else max(current_qty, 1))
    stock_percent = max(0, min(100, int(round((current_qty / target_qty) * 100)))) if target_qty else 0
    stock_state = inventory_stock_state(part)

    ctx.update(
        part=part,
        linked_assets=linked_assets,
        source_asset=asset,
        stock_state=stock_state,
        min_qty=min_qty,
        target_qty=target_qty,
        stock_percent=stock_percent,
    )
    return render_template("inventory/part_view.html", **ctx)


@app.get("/assets/<asset_uid>/maintenance-history")
def assets_maintenance_history_get(asset_uid):
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)

    tasks = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if t.get("asset_uid") == asset_uid]
    q = (request.args.get("q") or "").strip()
    selected_status = (request.args.get("status") or "").strip()
    selected_type = (request.args.get("type") or "").strip()

    def _match_task(t: dict) -> bool:
        hay = " ".join(
            [
                str(t.get("task_id") or ""),
                str(t.get("task_title") or ""),
                str(t.get("task_description") or ""),
                str(t.get("technician") or ""),
                str(t.get("maintenance_type") or t.get("service_type") or ""),
                str(t.get("status") or ""),
            ]
        ).lower()
        if q and q.lower() not in hay:
            return False
        if selected_status and str(t.get("status") or "").strip().lower() != selected_status.lower():
            return False
        task_type = str(t.get("maintenance_type") or t.get("service_type") or "").strip().lower()
        if selected_type and task_type != selected_type.lower():
            return False
        return True

    tasks_sorted = sorted([t for t in tasks if _match_task(t)], key=lambda x: (x.get("due_date") or "0000-00-00"), reverse=True)
    statuses = sorted({str(t.get("status") or "").strip() for t in tasks if str(t.get("status") or "").strip()})
    maintenance_types = sorted({str(t.get("maintenance_type") or t.get("service_type") or "").strip() for t in tasks if str(t.get("maintenance_type") or t.get("service_type") or "").strip()})

    page = request.args.get("page", default=1, type=int)
    per_page = request.args.get("per_page", default=10, type=int)
    per_page = 10 if per_page < 1 else min(per_page, 100)
    page = 1 if page < 1 else page

    total = len(tasks_sorted)
    total_pages = max(1, ceil(total / per_page)) if per_page else 1
    page = min(page, total_pages)

    start = (page - 1) * per_page
    end = start + per_page
    page_items = tasks_sorted[start:end]

    showing_from = 0 if total == 0 else start + 1
    showing_to = min(end, total)

    intel = compute_asset_maintenance_intelligence(asset_uid)

    ctx.update(
        asset=asset,
        current_tab="maintenance_history",
        maintenance_rows=page_items,
        q=q,
        selected_status=selected_status,
        selected_type=selected_type,
        statuses=statuses,
        maintenance_types=maintenance_types,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=total_pages,
        showing_from=showing_from,
        showing_to=showing_to,
        pages=build_pagination(page, total_pages),
        kpi_total_events=total,
        kpi_pm_compliance=intel["kpi_pm_compliance"],
        kpi_last_service=intel["kpi_last_service"],
        kpi_next_service=intel["kpi_next_service"],
        kpi_cost=(kes0(sum((_safe_float(t.get("cost_total"), 0.0) or 0.0) for t in tasks_sorted)) if any((_safe_float(t.get("cost_total"), None) is not None) for t in tasks_sorted) else "—"),
        monthly_bars=intel["monthly_bars"],
        technician_note=intel["technician_note"],
        top_spares=[],
    )
    return render_template("assets/assets_maintenance_history.html", **ctx)


@app.get("/assets/<asset_uid>/maintenance-history/export/<fmt>")
def assets_maintenance_history_export(asset_uid, fmt):
    asset = _asset_or_404(asset_uid)
    tasks = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if t.get("asset_uid") == asset_uid]
    q = (request.args.get("q") or "").strip().lower()
    selected_status = (request.args.get("status") or "").strip().lower()
    selected_type = (request.args.get("type") or "").strip().lower()

    columns = [
        ("Service Date", "service_date"),
        ("Maintenance Type", "maintenance_type"),
        ("Task", "task"),
        ("Technician", "technician"),
        ("Status", "status"),
        ("Due Date", "due_date"),
        ("Priority", "priority"),
    ]
    rows = []
    for t in tasks:
        task_type = str(t.get("maintenance_type") or t.get("service_type") or "").strip().lower()
        hay = " ".join([str(t.get("task_id") or ""), str(t.get("task_title") or ""), str(t.get("task_description") or ""), str(t.get("technician") or ""), task_type, str(t.get("status") or "")]).lower()
        if q and q not in hay:
            continue
        if selected_status and str(t.get("status") or "").strip().lower() != selected_status:
            continue
        if selected_type and task_type != selected_type:
            continue
        rows.append(
            {
                "service_date": t.get("service_date") or t.get("due_date") or "—",
                "maintenance_type": (t.get("maintenance_type") or t.get("service_type") or "—"),
                "task": t.get("task_title") or t.get("task_description") or "—",
                "technician": t.get("technician") or t.get("lead_technician") or "—",
                "status": str(t.get("status") or "—").replace("_", " ").title(),
                "due_date": t.get("due_date") or "—",
                "priority": str(t.get("priority") or "—").upper(),
            }
        )
    filename_root = 'asset_maintenance_history_' + re.sub(r'[^a-z0-9]+', '_', str(asset.get('asset_id') or asset.get('asset_name') or asset_uid).lower()).strip('_')
    return export_rows_file(fmt, filename_root, f"Asset Maintenance History - {asset.get('asset_name') or asset_uid}", columns, rows)


def compute_asset_maintenance_intelligence(asset_uid: str):
    tasks = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if t.get("asset_uid") == asset_uid]

    due_dates = [_coerce_date(t.get("due_date") or "") for t in tasks]
    due_dates = [d for d in due_dates if d]

    last_service = None
    next_service = None
    today_local = date.today()

    past = sorted([d for d in due_dates if d <= today_local])
    future = sorted([d for d in due_dates if d >= today_local])

    if past:
        last_service = past[-1].strftime("%d %b %Y")
    if future:
        next_service = future[0].strftime("%d %b %Y")

    month_key = today_local.strftime("%Y-%m")
    due_mtd = 0
    on_time = 0
    for t in tasks:
        dd = safe_date(t.get("due_date") or "")
        if not dd:
            continue
        if dd.strftime("%Y-%m") != month_key:
            continue
        if dd > today_local:
            continue
        due_mtd += 1
        if (t.get("status") or "") == "completed":
            ca = _coerce_date(t.get("completed_at") or "")
            if ca and ca <= dd:
                on_time += 1

    compliance = (on_time / due_mtd * 100.0) if due_mtd > 0 else None
    compliance_label = f"{compliance:.1f}%" if compliance is not None else "—"

    months = []
    cursor = datetime.combine(today_local, datetime.min.time()).replace(day=1)
    for _ in range(5):
        months.append(cursor.strftime("%b").upper())
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    months = list(reversed(months))

    buckets = {m: {"preventive": 0, "corrective": 0} for m in months}

    def month_label(d) -> str:
        return d.strftime("%b").upper()

    for t in tasks:
        dd = _coerce_date(t.get("due_date") or "")
        if not dd:
            continue
        m = month_label(dd)
        if m not in buckets:
            continue
        mtype = (t.get("maintenance_type") or "").upper()
        if mtype in ("PM", "PREVENTIVE"):
            buckets[m]["preventive"] += 1
        else:
            buckets[m]["corrective"] += 1

    monthly_bars = [
        {"month": m, "preventive": buckets[m]["preventive"], "corrective": buckets[m]["corrective"]}
        for m in months
    ]

    technician_note = None
    if tasks:
        technician_note = (
            "Asset reliability is trending based on recent maintenance patterns. "
            "Monitor recurring issues and confirm next scheduled service readiness."
        )

    return dict(
        kpi_pm_compliance=compliance_label,
        kpi_last_service=last_service,
        kpi_next_service=next_service,
        monthly_bars=monthly_bars,
        technician_note=technician_note,
    )


@app.get("/assets/<asset_uid>/documents")
def assets_documents_get(asset_uid):
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)

    asset_docs = [d for d in ASSET_DOCUMENTS if d.get("asset_uid") == asset_uid]

    # --- Normalize statuses and compute repository insights ---
    today = date.today()
    soon_days = 30
    soon_date = today + timedelta(days=soon_days)

    def _parse_date(val):
        """Best-effort parse for yyyy-mm-dd / dd/mm/yyyy / datetime/date."""
        if not val:
            return None
        if isinstance(val, date) and not isinstance(val, datetime):
            return val
        if isinstance(val, datetime):
            return val.date()
        s = str(val).strip()
        if not s:
            return None
        # try ISO first
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%m-%d-%Y"):
            try:
                return datetime.strptime(s, fmt).date()
            except Exception:
                pass
        return None

    approved = draft = expired = 0
    critical_alerts = []

    for d in asset_docs:
        exp_d = _parse_date(d.get("expiry_date"))
        rev_d = _parse_date(d.get("review_date"))
        raw_status = (d.get("status") or "").strip().lower()

        # expiry drives EXPIRED regardless of stored status
        if exp_d and exp_d < today:
            status = "expired"
        else:
            if raw_status in ("approved", "publish", "published"):
                status = "approved"
            elif raw_status in ("draft", "in draft"):
                status = "draft"
            elif raw_status in ("expired",):
                status = "expired"
            else:
                # safe fallback
                status = "draft"

        d["status"] = status  # keep template consistent

        if status == "approved":
            approved += 1
        elif status == "expired":
            expired += 1
        else:
            draft += 1

        doc_name = d.get("doc_name") or d.get("name") or d.get("filename") or "Document"

        # Critical Alerts (show what matters)
        if status == "expired":
            critical_alerts.append({
                "severity": "danger",
                "title": f"Expired document: {doc_name}",
                "message": "This document is expired and should be reviewed, replaced, or removed from use.",
                "doc_uid": d.get("uid"),
            })
        elif exp_d and today <= exp_d <= soon_date:
            days_left = (exp_d - today).days
            critical_alerts.append({
                "severity": "warning",
                "title": f"Expiry approaching: {doc_name}",
                "message": f"Expires in {days_left} day(s). Plan review and replacement to avoid using an outdated document.",
                "doc_uid": d.get("uid"),
            })

        if rev_d and today <= rev_d <= soon_date:
            days_left = (rev_d - today).days
            critical_alerts.append({
                "severity": "warning",
                "title": f"Review due soon: {doc_name}",
                "message": f"Review is due in {days_left} day(s).",
                "doc_uid": d.get("uid"),
            })

    total = approved + draft + expired

    def _pct(n, denom):
        return int(round((n / denom) * 100)) if denom else 0

    approved_pct = _pct(approved, total)
    draft_pct = _pct(draft, total)
    expired_pct = _pct(expired, total)

    # Make sure the ring sums cleanly to 100 (avoid 99/101 due to rounding)
    remainder = 100 - (approved_pct + draft_pct + expired_pct)
    if remainder != 0 and total:
        # push remainder into the largest bucket (business-friendly)
        bucket = max(
            [("approved", approved_pct), ("draft", draft_pct), ("expired", expired_pct)],
            key=lambda x: x[1],
        )[0]
        if bucket == "approved":
            approved_pct += remainder
        elif bucket == "draft":
            draft_pct += remainder
        else:
            expired_pct += remainder

    donut = {
        "total": total,
        "approved": approved,
        "draft": draft,
        "expired": expired,
        "approved_pct": approved_pct,
        "draft_pct": draft_pct,
        "expired_pct": expired_pct,
    }

    # Sort docs by uploaded_at (newest first) - keep existing behavior
    asset_docs_sorted = sorted(asset_docs, key=lambda x: (x.get("uploaded_at") or ""), reverse=True)

    # Sort alerts: danger first, then warning
    sev_rank = {"danger": 0, "warning": 1, "info": 2}
    critical_alerts = sorted(critical_alerts, key=lambda a: (sev_rank.get(a.get("severity","info"), 9), a.get("title","")))

    ctx.update(
        asset=asset,
        current_tab="documents",
        documents=asset_docs_sorted,
        documents_count=len(asset_docs_sorted),
        donut=donut,
        approved_count=approved,
        draft_count=draft,
        expired_count=expired,
        approved_pct=approved_pct,
        draft_pct=draft_pct,
        expired_pct=expired_pct,
        critical_alerts=critical_alerts,
        critical_alert_count=len(critical_alerts),
        alerts=critical_alerts,
        alerts_count=len(critical_alerts),
    )
    return render_template("assets/assets_documents.html", **ctx)

@app.get("/assets/<asset_uid>/documents/upload")
def assets_documents_upload_get(asset_uid):
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)

    ctx.update(
        asset=asset,
        current_tab="documents",
        document_categories=["OEM MANUAL","DRAWING","CERTIFICATION","INTERNAL SOP","VENDOR DOCUMENT","GENERAL"],
        doc_max_mb=int(DOC_MAX_FILE_BYTES / (1024 * 1024)),
    )
    return render_template("assets/assets_documents_upload.html", **ctx)

@app.post("/assets/<asset_uid>/documents/upload")
def assets_documents_upload_post(asset_uid):
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)

    file = request.files.get("document_file")
    if not file or not file.filename:
        flash("Please select a document file.", "error")
        return redirect(url_for("assets_documents_upload_get", asset_uid=asset_uid))

    if not allowed_doc(file.filename):
        flash("Unsupported file type.", "error")
        return redirect(url_for("assets_documents_upload_get", asset_uid=asset_uid))

    if not _stream_size_ok(file, DOC_MAX_FILE_BYTES):
        flash("File is too large for upload.", "error")
        return redirect(url_for("assets_documents_upload_get", asset_uid=asset_uid))

    doc_name = (request.form.get("doc_name") or "").strip()
    category = (request.form.get("category") or "GENERAL").strip()
    version = (request.form.get("version") or "").strip()
    owner = (request.form.get("owner") or ctx.get("current_user_name") or "—").strip()
    description = (request.form.get("description") or "").strip()
    expiry_date = (request.form.get("expiry_date") or "").strip()
    review_date = (request.form.get("review_date") or "").strip()
    publish_now = bool(request.form.get("publish_now"))

    if not doc_name:
        flash("Document name is required.", "error")
        return redirect(url_for("assets_documents_upload_get", asset_uid=asset_uid))

    original = secure_filename(file.filename)
    ext = (original.rsplit(".", 1)[1].lower() if "." in original else "")
    uid = uuid4().hex[:12]

    # This is already inside: EABC/static/uploads/asset_docs  ✅
    # (Your requirement was: inside static/uploads. This satisfies it.)
    saved_name = f"{asset_uid}_{uid}_{original}"
    save_path = os.path.join(ASSET_DOC_UPLOAD_DIR, saved_name)
    file.save(save_path)

    # Size label (rough)
    try:
        size_bytes = os.path.getsize(save_path)
        size_mb = size_bytes / (1024 * 1024)
        size_label = f"{size_mb:.1f} MB • {ext.upper() if ext else 'FILE'}"
    except Exception:
        size_label = f"— • {ext.upper() if ext else 'FILE'}"

    # Status logic:
    # - If expiry date is in the past => EXPIRED
    # - Else if publish_now => APPROVED
    # - Else => DRAFT
    status = "draft"
    try:
        if expiry_date:
            ed = datetime.strptime(expiry_date, "%Y-%m-%d").date()
            if ed < datetime.now().date():
                status = "expired"
            else:
                status = "approved" if publish_now else "draft"
        else:
            status = "approved" if publish_now else "draft"
    except Exception:
        status = "approved" if publish_now else "draft"

    ASSET_DOCUMENTS.append({
        "uid": uid,
        "asset_uid": asset_uid,
        "asset_uids": asset_uids,
        "name": doc_name,
        "category": category,
        "version": version or "—",
        "status": status,
        "uploaded_at": datetime.now().strftime("%d %b %Y"),
        "uploaded_by": owner,
        "description": description,
        "expiry_date": expiry_date,
        "review_date": review_date,
        "file_ext": ext,
        "file_path": f"/static/uploads/asset_docs/{saved_name}",
        "size_label": size_label,
    })

    flash("Document uploaded successfully.", "success")
    return redirect(url_for("assets_documents_upload_success_get", asset_uid=asset_uid, doc_uid=uid))

@app.get("/assets/<asset_uid>/documents/upload/success/<doc_uid>")
def assets_documents_upload_success_get(asset_uid, doc_uid):
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)

    doc = next((d for d in ASSET_DOCUMENTS if d.get("asset_uid") == asset_uid and d.get("uid") == doc_uid), None)
    if not doc:
        abort(404)

    ctx.update(
        asset=asset,
        current_tab="documents",
        doc=doc,
    )
    return render_template("assets/assets_documents_upload_success.html", **ctx)



@app.post("/assets/<asset_uid>/documents/<doc_uid>/delete")
def assets_document_delete(asset_uid: str, doc_uid: str):
    """Delete a document record + its uploaded file (if present)."""
    global ASSET_DOCUMENTS

    doc = next(
        (d for d in ASSET_DOCUMENTS if d.get("asset_uid") == asset_uid and d.get("uid") == doc_uid),
        None,
    )
    if not doc:
        flash("Document not found.", "error")
        return redirect(url_for("assets_documents_get", asset_uid=asset_uid))

    # remove file from disk (best effort)
    file_path = (doc.get("file_path") or "").lstrip("/")
    if file_path:
        fs_path = os.path.join(app.root_path, file_path)
        try:
            if os.path.exists(fs_path):
                os.remove(fs_path)
        except Exception:
            # Don't crash on Windows file locks etc.
            pass

    # remove from in-memory store
    ASSET_DOCUMENTS = [
        d for d in ASSET_DOCUMENTS
        if not (d.get("asset_uid") == asset_uid and d.get("uid") == doc_uid)
    ]

    flash("Document deleted.", "success")
    return redirect(url_for("assets_documents_get", asset_uid=asset_uid))


@app.get("/assets/<asset_uid>/breakdowns")
def assets_breakdowns_get(asset_uid):
    ctx = base_ctx("assets")
    asset = _asset_or_404(asset_uid)

    try:
        rows_per_page = int(request.args.get("per_page") or request.args.get("rows") or 10)
    except ValueError:
        rows_per_page = 10
    rows_per_page = rows_per_page if rows_per_page in (5, 10, 20, 50) else 10

    try:
        page = int(request.args.get("page") or 1)
    except ValueError:
        page = 1
    page = max(page, 1)

    q = (request.args.get("q") or "").strip().lower()
    selected_status = (request.args.get("status") or "").strip()
    selected_type = (request.args.get("type") or "").strip()

    asset_breakdowns = [b for b in BREAKDOWNS if b.get("asset_uid") == asset_uid]

    def _match_breakdown(b: dict) -> bool:
        hay = " ".join(
            [
                str(b.get("breakdown_id") or ""),
                str(b.get("incident_title") or ""),
                str(b.get("failure_category") or ""),
                str(b.get("technician_name") or ""),
                str(b.get("status") or ""),
            ]
        ).lower()
        if q and q not in hay:
            return False
        if selected_status and str(b.get("status") or "").strip().lower() != selected_status.lower():
            return False
        if selected_type and str(b.get("failure_category") or "").strip().lower() != selected_type.lower():
            return False
        return True

    asset_breakdowns_sorted = sorted([b for b in asset_breakdowns if _match_breakdown(b)], key=lambda x: (x.get("reported_dt") or ""), reverse=True)
    statuses = sorted({str(b.get("status") or "").strip() for b in asset_breakdowns if str(b.get("status") or "").strip()})
    failure_types = sorted({str(b.get("failure_category") or "").strip() for b in asset_breakdowns if str(b.get("failure_category") or "").strip()})

    total_records = len(asset_breakdowns_sorted)
    total_pages = max(1, (total_records + rows_per_page - 1) // rows_per_page)
    page = min(page, total_pages)

    start = (page - 1) * rows_per_page
    end = start + rows_per_page
    page_items = asset_breakdowns_sorted[start:end]
    showing_from = 0 if total_records == 0 else start + 1
    showing_to = min(end, total_records)

    rows = []
    for b in page_items:
        reported_date, reported_time = human_dt_parts(b.get("reported_dt") or "")
        status = b.get("status") or "open"
        if status == "resolved":
            mins = b.get("duration_mins")
            if not isinstance(mins, int):
                mins = minutes_between(b.get("reported_dt") or "", b.get("resolved_at") or "")
            downtime = fmt_hm_from_minutes(mins if isinstance(mins, int) else 0)
        else:
            mins = minutes_between(b.get("reported_dt") or "", datetime.now().isoformat(timespec="seconds"))
            downtime = fmt_hm_from_minutes(mins or 0)
        rows.append(
            dict(
                breakdown_id=b.get("breakdown_id"),
                incident_title=b.get("incident_title") or "",
                incident_type=(b.get("failure_category") or "General").strip(),
                reported_date=reported_date,
                reported_time=reported_time,
                downtime=downtime,
                status=b.get("status"),
                status_label=safe_status_label(status),
                technician_name=b.get("technician_name") or "Unassigned",
            )
        )

    intel = compute_asset_breakdown_intelligence(asset_uid)

    ctx.update(
        asset=asset,
        current_tab="breakdowns",
        breakdowns=rows,
        breakdowns_count=total_records,
        q=request.args.get("q", ""),
        selected_status=selected_status,
        selected_type=selected_type,
        statuses=statuses,
        failure_types=failure_types,
        page=page,
        pages=build_pagination(page, total_pages),
        total_pages=total_pages,
        per_page=rows_per_page,
        rows_per_page=rows_per_page,
        total_records=total_records,
        showing_from=showing_from,
        showing_to=showing_to,
        kpis=intel["kpis"],
        root_causes=intel["root_causes"],
        top_failure_modes=intel["top_failure_modes"],
        monthly_bars=[],
        technician_note=None,
    )
    return render_template("assets/assets_breakdowns.html", **ctx)


@app.get("/assets/<asset_uid>/breakdowns/export/<fmt>")
def assets_breakdowns_export(asset_uid, fmt):
    asset = _asset_or_404(asset_uid)
    q = (request.args.get("q") or "").strip().lower()
    selected_status = (request.args.get("status") or "").strip().lower()
    selected_type = (request.args.get("type") or "").strip().lower()
    columns = [
        ("Breakdown ID", "breakdown_id"),
        ("Incident Title", "incident_title"),
        ("Failure Category", "failure_category"),
        ("Reported Date", "reported_date"),
        ("Reported Time", "reported_time"),
        ("Technician", "technician"),
        ("Status", "status"),
    ]
    rows = []
    for b in sorted([x for x in BREAKDOWNS if x.get("asset_uid") == asset_uid], key=lambda x: (x.get("reported_dt") or ""), reverse=True):
        hay = " ".join([str(b.get("breakdown_id") or ""), str(b.get("incident_title") or ""), str(b.get("failure_category") or ""), str(b.get("technician_name") or ""), str(b.get("status") or "")]).lower()
        if q and q not in hay:
            continue
        if selected_status and str(b.get("status") or "").strip().lower() != selected_status:
            continue
        if selected_type and str(b.get("failure_category") or "").strip().lower() != selected_type:
            continue
        reported_date, reported_time = human_dt_parts(b.get("reported_dt") or "")
        rows.append(
            {
                "breakdown_id": b.get("breakdown_id") or "—",
                "incident_title": b.get("incident_title") or "—",
                "failure_category": b.get("failure_category") or "—",
                "reported_date": reported_date or "—",
                "reported_time": reported_time or "—",
                "technician": b.get("technician_name") or "—",
                "status": safe_status_label(b.get("status") or "open"),
            }
        )
    filename_root = 'asset_breakdowns_' + re.sub(r'[^a-z0-9]+', '_', str(asset.get('asset_id') or asset.get('asset_name') or asset_uid).lower()).strip('_')
    return export_rows_file(fmt, filename_root, f"Asset Breakdowns - {asset.get('asset_name') or asset_uid}", columns, rows)


# -------------------------
# Asset profile actions (Spare parts / Documents)
# -------------------------
@app.post("/assets/<asset_uid>/spareparts/add")
def asset_sparepart_add(asset_uid):
    part_name = request.form.get("part_name", "").strip()
    part_no = request.form.get("part_no", "").strip()
    qty = request.form.get("qty", "0").strip()
    vendor = request.form.get("vendor", "").strip()

    if not part_name:
        flash("Part name is required", "error")
        return redirect(url_for("assets_spare_parts_get", asset_uid=asset_uid))

    # Optional extended fields (safe defaults; older forms won't send these)
    category = (request.form.get("category") or "").strip()
    min_qty = (request.form.get("min_qty") or "").strip()
    target_qty = (request.form.get("target_qty") or "").strip()
    lead_time_days = (request.form.get("lead_time_days") or "").strip()
    photo_url = (request.form.get("photo_url") or "").strip()
    is_critical = (request.form.get("is_critical") or "").strip()
    unit_cost = (request.form.get("unit_cost") or "").strip()

    spare_payload = dict(
        id=uuid4().hex,
        asset_uid=asset_uid,
        part_name=part_name,
        part_no=part_no,
        sku=part_no,
        qty=_safe_int(qty, 0) or 0,
        vendor=vendor,
        supplier=vendor,
        category=category or None,
        min_qty=_safe_int(min_qty, 0) if str(min_qty).strip() else None,
        target_qty=_safe_int(target_qty, None) if str(target_qty).strip() else None,
        lead_time_days=_safe_int(lead_time_days, None) if str(lead_time_days).strip() else None,
        photo_url=photo_url or None,
        is_critical=True if str(is_critical).lower() in ("1", "true", "yes", "on") else False,
        unit_cost=_safe_float(unit_cost, None) if str(unit_cost).strip() else None,
        created_at=datetime.now().isoformat(timespec="seconds"),
        created_by=base_ctx("assets")["current_user_name"],
        source="asset_profile",
    )
    SPARE_PARTS.insert(0, spare_payload)

    inventory_payload = dict(
        uid=uuid4().hex,
        created_at=spare_payload["created_at"],
        part_name=part_name,
        sku=part_no or uuid4().hex[:8].upper(),
        category=category or "Mechanical",
        compatible_assets=[asset_uid],
        qty=spare_payload["qty"],
        min_qty=spare_payload["min_qty"] or 0,
        storage_location=(request.form.get("storage_location") or "").strip(),
        unit_price=spare_payload["unit_cost"] or 0.0,
        supplier=vendor,
        lead_time_days=spare_payload["lead_time_days"],
        is_critical=spare_payload["is_critical"],
        manufacturer=(request.form.get("manufacturer") or "").strip(),
        model_number=(request.form.get("model_number") or "").strip(),
        tech_specs=(request.form.get("tech_specs") or "").strip(),
        photo_url=photo_url or None,
        doc_url=(request.form.get("doc_url") or "").strip() or None,
        source="asset_profile",
    )
    INVENTORY_PARTS.insert(0, inventory_payload)
    _sync_inventory_part_links_to_spares(inventory_payload)

    flash("Spare part added", "success")
    return redirect(url_for("assets_spare_parts_get", asset_uid=asset_uid))


@app.post("/assets/<asset_uid>/spareparts/<spare_id>/delete")
def asset_sparepart_delete(asset_uid, spare_id):
    _asset_or_404(asset_uid)

    idx = next(
        (i for i, s in enumerate(SPARE_PARTS) if s.get("id") == spare_id and s.get("asset_uid") == asset_uid),
        None,
    )
    if idx is not None:
        removed = SPARE_PARTS.pop(idx)
        removed_sku = str(removed.get("sku") or removed.get("part_no") or "").strip().lower()
        for i in range(len(INVENTORY_PARTS) - 1, -1, -1):
            p = INVENTORY_PARTS[i]
            p_sku = str(p.get("sku") or p.get("part_no") or "").strip().lower()
            links = p.get("compatible_assets") or []
            if isinstance(links, str):
                links = [links]
            if removed_sku and p_sku == removed_sku and asset_uid in links:
                links = [x for x in links if x != asset_uid]
                if links:
                    p["compatible_assets"] = links
                else:
                    INVENTORY_PARTS.pop(i)
    return redirect(url_for("assets_spare_parts_get", asset_uid=asset_uid))





@app.post("/assets/<asset_uid>/documents/<doc_id>/delete")
def asset_document_delete(asset_uid, doc_id):
    _asset_or_404(asset_uid)

    idx = next(
        (i for i, d in enumerate(ASSET_DOCUMENTS) if d.get("id") == doc_id and d.get("asset_uid") == asset_uid),
        None,
    )
    if idx is not None:
        ASSET_DOCUMENTS.pop(idx)
    return redirect(url_for("assets_documents_get", asset_uid=asset_uid))

@app.get("/api/assets/dashboard")
def assets_dashboard_api():
    dept = get_current_department()
    # dept-scoped assets (full list, not paginated)
    items = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]

    out = []
    for a in items:
        out.append({
            "uid": a.get("uid"),
            "asset_id": a.get("asset_id"),
            "asset_name": a.get("asset_name"),
            "section": a.get("section"),
            "status": a.get("status"),
            "criticality": a.get("criticality"),
            "serial_no": a.get("serial_no") or "",
            "manufacturer": a.get("manufacturer") or "",
        })
    return jsonify(assets=out)

# Optional dependency (PDF export)
REPORTLAB_AVAILABLE = True
try:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
except ModuleNotFoundError:
    REPORTLAB_AVAILABLE = False

WEASYPRINT_AVAILABLE = True
try:
    from weasyprint import HTML as WeasyHTML
except ModuleNotFoundError:
    WEASYPRINT_AVAILABLE = False


@app.get("/assets/report/pdf")
def assets_report_pdf():
    if not REPORTLAB_AVAILABLE:
        return ("PDF export requires ReportLab. Install it with: python -m pip install reportlab", 503)

    dept = get_current_department()
    sections = request.args.getlist("section")
    status = (request.args.get("status") or "").strip()
    criticality = (request.args.get("criticality") or "").strip()

    items = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]
    if sections:
        items = [a for a in items if (a.get("section") or "") in sections]
    if status:
        items = [a for a in items if (a.get("status") or "") == status]
    if criticality:
        items = [a for a in items if (a.get("criticality") or "") == criticality]

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(A4))
    width, height = landscape(A4)
    body_top = _draw_pdf_header(c, width, height, department=dept, start_date="Current Register", end_date=datetime.now().strftime("%Y-%m-%d"), report_title="Asset Register", page_title="Asset Master List", reported_by=base_ctx("assets")["current_user_name"])

    left_margin = 30
    right_margin = 30
    table_width = width - left_margin - right_margin
    headers = ["Asset ID", "Asset Name", "Section", "Status", "Criticality", "Serial"]
    col_widths = [92, 210, 98, 92, 84, 145]
    xs = [left_margin]
    for wcol in col_widths[:-1]:
        xs.append(xs[-1] + wcol)

    y = body_top - 2
    c.setFont("Helvetica-Bold", 16)
    c.setFillColorRGB(0.08, 0.1, 0.16)
    c.drawString(left_margin, y, "Asset Register Report")
    y -= 20
    c.setFont("Helvetica", 9)
    c.setFillColorRGB(0.32, 0.32, 0.32)
    meta = f"Sections: {', '.join(sections) if sections else 'All'} | Status: {status or 'All'} | Criticality: {criticality or 'All'} | Count: {len(items)}"
    c.drawString(left_margin, y, meta)
    c.setFillColorRGB(0, 0, 0)
    y -= 22

    def draw_table_header(ypos):
        c.setFillColorRGB(0.95, 0.95, 0.98)
        c.roundRect(left_margin - 6, ypos - 11, table_width + 12, 20, 6, fill=1, stroke=0)
        c.setFillColorRGB(0.1, 0.1, 0.12)
        c.setFont("Helvetica-Bold", 9)
        for i, h in enumerate(headers):
            c.drawString(xs[i], ypos, h)
        c.setFont("Helvetica", 9)
        c.setFillColorRGB(0, 0, 0)

    draw_table_header(y)
    y -= 18

    def status_label(st):
        return "Operational" if st == "operational" else ("Maintenance" if st == "maintenance" else "Out of Service")

    for a in items:
        if y < 52:
            c.showPage()
            body_top = _draw_pdf_header(c, width, height, department=dept, start_date="Current Register", end_date=datetime.now().strftime("%Y-%m-%d"), report_title="Asset Register", page_title="Asset Master List (cont.)", reported_by=base_ctx("assets")["current_user_name"])
            y = body_top - 2
            c.setFont("Helvetica-Bold", 14)
            c.setFillColorRGB(0.08, 0.1, 0.16)
            c.drawString(left_margin, y, "Asset Register Report (continued)")
            c.setFillColorRGB(0, 0, 0)
            y -= 22
            draw_table_header(y)
            y -= 18
        row = [
            (a.get("asset_id") or ""),
            (a.get("asset_name") or ""),
            (a.get("section") or ""),
            status_label(a.get("status") or ""),
            (a.get("criticality") or ""),
            (a.get("serial_no") or "—"),
        ]
        limits = [18, 34, 14, 16, 10, 24]
        for i, val in enumerate(row):
            cell_text = str(val)
            if len(cell_text) > limits[i]:
                cell_text = cell_text[: max(0, limits[i] - 1)] + "…"
            c.drawString(xs[i], y, cell_text)
        y -= 12

    c.showPage()
    c.save()
    pdf = buf.getvalue()
    buf.close()
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": "attachment; filename=assets_report.pdf"})




# -------------------------
# AJAX endpoints for assets by section (department-aware)
# -------------------------
@app.get("/breakdowns/assets")
def breakdowns_assets_by_section():
    section = (request.args.get("section") or "").strip()
    if not section:
        return jsonify({"assets": []})

    dept = get_current_department()
    items = [
        a for a in ASSETS
        if (a.get("department") or "Engineering") == dept and (a.get("section") or "") == section
    ]
    items.sort(key=lambda x: (x.get("asset_name") or "").lower())

    out = [{"uid": a.get("uid"), "asset_name": a.get("asset_name"), "asset_id": a.get("asset_id")} for a in items]
    return jsonify({"assets": out})


@app.get("/maintenance/assets")
def maintenance_assets_by_section():
    section = (request.args.get("section") or "").strip()
    if not section:
        return jsonify({"assets": []})

    dept = get_current_department()
    items = [
        a for a in ASSETS
        if (a.get("department") or "Engineering") == dept and (a.get("section") or "") == section
    ]
    items.sort(key=lambda x: (x.get("asset_name") or "").lower())
    out = [{"uid": a.get("uid"), "asset_name": a.get("asset_name"), "asset_id": a.get("asset_id")} for a in items]
    return jsonify({"assets": out})


# -------------------------
# Real-time KPI endpoint (department-aware)
# -------------------------
@app.get("/api/breakdowns/kpi")
def breakdowns_kpi_api():
    dept = get_current_department()
    k = compute_kpi_trends(department=dept)
    uptime_rate = compute_uptime_rate(department=dept)
    return jsonify(
        active=k["active"],
        active_delta=k["active_delta"],
        mttr_hours=k["mttr_hours"],
        mttr_trend=k["mttr_trend"],
        downtime_mtd_hours=k["downtime_mtd_hours"],
        uptime_rate=uptime_rate,
        now=datetime.now().isoformat(timespec="seconds"),
    )

def _range_bounds(range_key: str):
    now = datetime.now()
    key = (range_key or "7d").strip().lower()

    if key == "7d":
        return now - timedelta(days=6), now, "day"
    if key == "30d":
        return now - timedelta(days=29), now, "day"
    if key == "mtd":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return start, now, "day"
    if key == "ytd":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        return start, now, "month"

    # quarter support: q1/q2/q3/q4 (current year)
    if key in ("q1", "q2", "q3", "q4"):
        q = int(key[1])
        start_month = 1 + (q - 1) * 3
        start = now.replace(month=start_month, day=1, hour=0, minute=0, second=0, microsecond=0)
        end_month = start_month + 2
        # end = first day of next month after quarter end, minus a second
        quarter_end_first_next = (start.replace(month=end_month, day=28) + timedelta(days=4)).replace(day=1)
        quarter_end = (quarter_end_first_next.replace(month=end_month) if quarter_end_first_next.month == end_month else quarter_end_first_next)  # safe-ish
        # safer: compute first day of month after end_month
        if end_month == 12:
            next_m = start.replace(year=start.year + 1, month=1, day=1)
        else:
            next_m = start.replace(month=end_month + 1, day=1)
        end = min(now, next_m - timedelta(seconds=1))
        return start, end, "week"

    # fallback
    return now - timedelta(days=6), now, "day"


def _bucket_label(dt: datetime, granularity: str) -> str:
    if granularity == "month":
        return dt.strftime("%b")
    if granularity == "week":
        # ISO week label
        y, w, _ = dt.isocalendar()
        return f"W{w:02d}"
    return dt.strftime("%b %d")

from datetime import datetime, timedelta, date
from flask import jsonify, request

def _safe_parse_iso_dt(s: str):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None

def _breakdown_reported_dt(b: dict):
    """
    Ensure we can always get a datetime for charting.
    Priority:
      1) b['reported_dt'] (ISO)  e.g. 2026-02-23T18:00:00
      2) build from reported_date + reported_time if present
      3) fallback to created_at if present
    """
    # 1) reported_dt
    dt = _safe_parse_iso_dt((b.get("reported_dt") or "").strip())
    if dt:
        return dt

    # 2) reported_date + reported_time
    rd = (b.get("reported_date") or "").strip()   # e.g. 2026-02-23
    rt = (b.get("reported_time") or "").strip()   # e.g. 18:00
    if rd:
        try:
            if rt:
                return datetime.fromisoformat(f"{rd}T{rt}:00" if len(rt) == 5 else f"{rd}T{rt}")
            return datetime.fromisoformat(f"{rd}T00:00:00")
        except Exception:
            pass

    # 3) created_at
    dt = _safe_parse_iso_dt((b.get("created_at") or "").strip())
    if dt:
        return dt

    return None

def _date_range_from_mode(mode: str, now_dt: datetime, year: int | None, quarter: int | None, dfrom: str | None, dto: str | None):
    today = now_dt.date()

    if mode == "30d":
        start = today - timedelta(days=29)
        end = today
        return start, end

    if mode == "qtr":
        # default to current quarter if not provided
        y = year or now_dt.year
        q = quarter or ((now_dt.month - 1) // 3 + 1)
        q = max(1, min(4, int(q)))

        q_start_month = (q - 1) * 3 + 1
        start = date(y, q_start_month, 1)
        # next quarter start - 1 day
        if q == 4:
            end = date(y, 12, 31)
        else:
            end = date(y, q_start_month + 3, 1) - timedelta(days=1)
        return start, end

    if mode == "custom":
        # expects YYYY-MM-DD
        try:
            start = datetime.fromisoformat(dfrom).date() if dfrom else today - timedelta(days=6)
        except Exception:
            start = today - timedelta(days=6)
        try:
            end = datetime.fromisoformat(dto).date() if dto else today
        except Exception:
            end = today
        if end < start:
            start, end = end, start
        return start, end

    # default 7d
    start = today - timedelta(days=6)
    end = today
    return start, end

@app.get("/api/breakdowns/frequency")
def api_breakdowns_frequency():
    dept = get_current_department()
    now_dt = datetime.now()

    mode = (request.args.get("range") or "7d").strip().lower()
    year = request.args.get("year")
    quarter = request.args.get("quarter")
    dfrom = (request.args.get("from") or "").strip() or None
    dto = (request.args.get("to") or "").strip() or None

    try:
        year_i = int(year) if year else None
    except ValueError:
        year_i = None
    try:
        quarter_i = int(quarter) if quarter else None
    except ValueError:
        quarter_i = None

    start_d, end_d = _date_range_from_mode(mode, now_dt, year_i, quarter_i, dfrom, dto)

    # department-aware universe
    universe = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept]

    # count per day
    counts = {}
    total = 0

    for b in universe:
        dt = _breakdown_reported_dt(b)
        if not dt:
            continue
        dd = dt.date()
        if dd < start_d or dd > end_d:
            continue
        key = dd.isoformat()
        counts[key] = counts.get(key, 0) + 1
        total += 1

    # build ordered labels/values across the whole range (so you never get “missing days”)
    labels = []
    values = []

    cur = start_d
    while cur <= end_d:
        iso = cur.isoformat()
        labels.append(cur.strftime("%b %d").upper())  # e.g. FEB 23
        values.append(int(counts.get(iso, 0)))
        cur += timedelta(days=1)

    return jsonify({
        "range": mode,
        "start": start_d.isoformat(),
        "end": end_d.isoformat(),
        "labels": labels,
        "values": values,
        "total": total,
    })


@app.get("/api/breakdowns/frequency")
def breakdowns_frequency_api():
    dept = get_current_department()
    range_key = (request.args.get("range") or "7d").strip().lower()
    start, end, granularity = _range_bounds(range_key)

    universe = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept]

    # filter by reported_dt within range
    items = []
    for b in universe:
        dt = parse_iso_dt(b.get("reported_dt") or "")
        if not dt:
            continue
        if dt < start or dt > end:
            continue
        items.append((dt, b))

    # pick top 2 sections for split series (to mimic “Production / Packaging” style)
    section_counts = {}
    for _dt, b in items:
        sec = (b.get("section") or "Unspecified").strip() or "Unspecified"
        section_counts[sec] = section_counts.get(sec, 0) + 1
    top_sections = [s for s, _c in sorted(section_counts.items(), key=lambda x: x[1], reverse=True)[:2]]

    # build buckets
    buckets = {}
    for dt, b in items:
        k = _bucket_label(dt, granularity)
        if k not in buckets:
            buckets[k] = {"total": 0, "s1": 0, "s2": 0}
        buckets[k]["total"] += 1
        sec = (b.get("section") or "Unspecified").strip() or "Unspecified"
        if len(top_sections) > 0 and sec == top_sections[0]:
            buckets[k]["s1"] += 1
        if len(top_sections) > 1 and sec == top_sections[1]:
            buckets[k]["s2"] += 1

    # stable ordering of labels
    # rebuild by iterating through timeline so chart doesn't “jump”
    labels = []
    cursor = start
    step = timedelta(days=1)
    if granularity == "month":
        # monthly steps
        cursor = start.replace(day=1)
        while cursor <= end:
            labels.append(_bucket_label(cursor, "month"))
            cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    elif granularity == "week":
        # weekly steps (7 days)
        while cursor <= end:
            labels.append(_bucket_label(cursor, "week"))
            cursor += timedelta(days=7)
    else:
        while cursor <= end:
            labels.append(_bucket_label(cursor, "day"))
            cursor += step

    total_series = [buckets.get(l, {}).get("total", 0) for l in labels]
    s1_series = [buckets.get(l, {}).get("s1", 0) for l in labels]
    s2_series = [buckets.get(l, {}).get("s2", 0) for l in labels]

    return jsonify(
        range=range_key,
        labels=labels,
        series={
            "total": total_series,
            "s1": {"name": (top_sections[0] if len(top_sections) > 0 else None), "data": s1_series},
            "s2": {"name": (top_sections[1] if len(top_sections) > 1 else None), "data": s2_series},
        },
    )


def _breakdown_frequency_payload(dept: str, mode: str, year: int | None, quarter: int | None, dfrom: str | None, dto: str | None):
    now_dt = datetime.now()
    start_d, end_d = _date_range_from_mode(mode, now_dt, year, quarter, dfrom, dto)
    universe = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept]
    counts = {}
    subtotal_buckets = {}
    vat_buckets = {}
    total_cost_buckets = {}
    filtered_items = []
    for b in universe:
        dt = _breakdown_reported_dt(b)
        if not dt:
            continue
        dd = dt.date()
        if dd < start_d or dd > end_d:
            continue
        filtered_items.append(b)
        key = dd.isoformat()
        counts[key] = counts.get(key, 0) + 1
        subtotal_buckets[key] = round(float(subtotal_buckets.get(key, 0.0) or 0.0) + float(_safe_float(b.get("cost_subtotal"), 0.0) or 0.0), 2)
        vat_buckets[key] = round(float(vat_buckets.get(key, 0.0) or 0.0) + float(_safe_float(b.get("cost_vat_amount"), 0.0) or 0.0), 2)
        total_cost_buckets[key] = round(float(total_cost_buckets.get(key, 0.0) or 0.0) + float(_safe_float(b.get("cost_total"), 0.0) or 0.0), 2)
    labels, values, cost_subtotals, vat_values, total_cost_values, rows = [], [], [], [], [], []
    cur = start_d
    while cur <= end_d:
        iso = cur.isoformat()
        label = cur.strftime("%b %d")
        value = int(counts.get(iso, 0))
        subtotal = round(float(subtotal_buckets.get(iso, 0.0) or 0.0), 2)
        vat_amount = round(float(vat_buckets.get(iso, 0.0) or 0.0), 2)
        total_line = round(float(total_cost_buckets.get(iso, 0.0) or 0.0), 2)
        labels.append(label)
        values.append(value)
        cost_subtotals.append(subtotal)
        vat_values.append(vat_amount)
        total_cost_values.append(total_line)
        rows.append({
            "period": label,
            "value": value,
            "cost_subtotal": subtotal,
            "vat_amount": vat_amount,
            "total_cost": total_line,
        })
        cur += timedelta(days=1)
    peak_label, peak_value = _series_peak_label([{"label": l, "value": v} for l, v in zip(labels, values)])
    total_cost_subtotal = round(sum((_safe_float(x.get("cost_subtotal"), 0.0) or 0.0) for x in filtered_items), 2)
    total_vat = round(sum((_safe_float(x.get("cost_vat_amount"), 0.0) or 0.0) for x in filtered_items), 2)
    total_cost = round(sum((_safe_float(x.get("cost_total"), 0.0) or 0.0) for x in filtered_items), 2)
    vat_rates = sorted({round(_safe_float(x.get("cost_vat_pct"), 0.0) or 0.0, 2) for x in filtered_items if (_safe_float(x.get("cost_vat_pct"), None) is not None)})
    severity_counts = {}
    for b in filtered_items:
        sev = ((b.get("severity") or "medium").strip().lower() or "medium").title()
        severity_counts[sev] = severity_counts.get(sev, 0) + 1
    top_severity = max(severity_counts.items(), key=lambda x: x[1])[0] if severity_counts else "—"
    insights = []
    if not filtered_items:
        insights.append("No breakdown incidents were recorded in the selected reporting period.")
    else:
        insights.append(f"{len(filtered_items)} breakdown incident(s) were logged in the selected reporting period.")
        insights.append(f"Peak incident load occurred on {peak_label} with {int(peak_value)} incident(s).")
        insights.append(f"Most common severity in this view is {top_severity}.")
    return {
        "title": "Breakdown Frequency Report",
        "subtitle": f"{dept} incident pattern by day",
        "period_label": _range_label_for_chart_report(start_d.isoformat(), end_d.isoformat()),
        "labels": labels,
        "values": values,
        "cost_subtotals": cost_subtotals,
        "vat_values": vat_values,
        "total_cost_values": total_cost_values,
        "rows": rows,
        "insights": insights,
        "cost_subtotal": total_cost_subtotal,
        "vat_amount": total_vat,
        "vat_rate_label": ", ".join((f"{r:g}%" for r in vat_rates if r > 0)) or "No VAT applied",
        "total_cost": total_cost,
        "record_count": len(filtered_items),
        "department": dept,
        "department_display": report_department_display(dept),
        "scope_label": get_scope_unit_display(dept),
    }


def _maintenance_distribution_payload(dept: str, range_key: str, section: str, asset_uid: str):
    start, end, granularity = _range_bounds(range_key)
    universe = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]
    if section:
        universe = [t for t in universe if (t.get("section") or "") == section]
    if asset_uid:
        universe = [t for t in universe if (t.get("asset_uid") or "") == asset_uid]
    items = []
    for t in universe:
        dd = parse_date_only(t.get("due_date") or "")
        if not dd or dd < start.date() or dd > end.date():
            continue
        items.append((dd, t))
    buckets = {}
    for dd, t in items:
        lab = _bucket_label(dd, granularity)
        if lab not in buckets:
            buckets[lab] = {"pm": 0, "cm": 0, "cost_subtotal": 0.0, "vat_amount": 0.0, "total_cost": 0.0, "estimated_cost_subtotal": 0.0, "estimated_vat_amount": 0.0, "estimated_total_cost": 0.0}
        if (t.get("maintenance_type") or "PM").strip().upper() == "CM":
            buckets[lab]["cm"] += 1
        else:
            buckets[lab]["pm"] += 1
        buckets[lab]["estimated_cost_subtotal"] = round(float(buckets[lab].get("estimated_cost_subtotal", 0.0) or 0.0) + float(_task_cost_value(t, "cost_subtotal", 0.0) or 0.0), 2)
        buckets[lab]["estimated_vat_amount"] = round(float(buckets[lab].get("estimated_vat_amount", 0.0) or 0.0) + float(_task_cost_value(t, "cost_vat_amount", 0.0) or 0.0), 2)
        buckets[lab]["estimated_total_cost"] = round(float(buckets[lab].get("estimated_total_cost", 0.0) or 0.0) + float(_task_cost_value(t, "cost_total", 0.0) or 0.0), 2)
        if (t.get("status") or "").strip().lower() == "completed" and bool(t.get("cost_collected")):
            buckets[lab]["cost_subtotal"] = round(float(buckets[lab].get("cost_subtotal", 0.0) or 0.0) + float(_task_cost_value(t, "cost_subtotal", 0.0) or 0.0), 2)
            buckets[lab]["vat_amount"] = round(float(buckets[lab].get("vat_amount", 0.0) or 0.0) + float(_task_cost_value(t, "cost_vat_amount", 0.0) or 0.0), 2)
            buckets[lab]["total_cost"] = round(float(buckets[lab].get("total_cost", 0.0) or 0.0) + float(_task_cost_value(t, "cost_total", 0.0) or 0.0), 2)
    labels = []
    cursor = start
    if granularity == "month":
        cursor = start.replace(day=1)
        while cursor <= end:
            labels.append(_bucket_label(cursor, "month"))
            cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    elif granularity == "week":
        while cursor <= end:
            labels.append(_bucket_label(cursor, "week"))
            cursor += timedelta(days=7)
    else:
        while cursor <= end:
            labels.append(_bucket_label(cursor, "day"))
            cursor += timedelta(days=1)
    pm_series = [buckets.get(l, {}).get("pm", 0) for l in labels]
    cm_series = [buckets.get(l, {}).get("cm", 0) for l in labels]
    cost_subtotals = [round(float(buckets.get(l, {}).get("cost_subtotal", 0.0) or 0.0), 2) for l in labels]
    vat_values = [round(float(buckets.get(l, {}).get("vat_amount", 0.0) or 0.0), 2) for l in labels]
    total_cost_values = [round(float(buckets.get(l, {}).get("total_cost", 0.0) or 0.0), 2) for l in labels]
    estimated_total_cost_values = [round(float(buckets.get(l, {}).get("estimated_total_cost", 0.0) or 0.0), 2) for l in labels]
    rows = [{
        "period": labels[i],
        "pm": pm_series[i],
        "cm": cm_series[i],
        "total": pm_series[i] + cm_series[i],
        "cost_subtotal": cost_subtotals[i],
        "vat_amount": vat_values[i],
        "total_cost": total_cost_values[i],
        "estimated_total_cost": estimated_total_cost_values[i],
    } for i in range(len(labels))]
    total_tasks = sum(r["total"] for r in rows) if rows else 0
    peak_label, peak_value = _series_peak_label([{"label": r["period"], "value": r["total"]} for r in rows])
    filtered_tasks = [t for _dd, t in items]
    estimated_cost_subtotal = round(sum((_task_cost_value(x, "cost_subtotal", 0.0) or 0.0) for x in filtered_tasks), 2)
    estimated_vat = round(sum((_task_cost_value(x, "cost_vat_amount", 0.0) or 0.0) for x in filtered_tasks), 2)
    estimated_cost_total = round(sum((_task_cost_value(x, "cost_total", 0.0) or 0.0) for x in filtered_tasks), 2)
    collected_tasks = [x for x in filtered_tasks if (x.get("status") or "").strip().lower() == "completed" and bool(x.get("cost_collected"))]
    total_cost_subtotal = round(sum((_task_cost_value(x, "cost_subtotal", 0.0) or 0.0) for x in collected_tasks), 2)
    total_vat = round(sum((_task_cost_value(x, "cost_vat_amount", 0.0) or 0.0) for x in collected_tasks), 2)
    total_cost = round(sum((_task_cost_value(x, "cost_total", 0.0) or 0.0) for x in collected_tasks), 2)
    vat_rates = sorted({round(_safe_float(x.get("cost_vat_pct"), 0.0) or 0.0, 2) for x in filtered_tasks if (_safe_float(x.get("cost_vat_pct"), None) is not None)})
    insights = []
    if total_tasks == 0:
        insights.append("No maintenance tasks were scheduled in the selected reporting period.")
    else:
        insights.append(f"{total_tasks} task(s) were scheduled in the selected view.")
        insights.append(f"Preventive maintenance accounts for {sum(pm_series)} task(s) while corrective work accounts for {sum(cm_series)} task(s).")
        insights.append(f"Peak workload occurred in {peak_label} with {int(peak_value)} task(s).")
    scope_label = section or (next((a.get("asset_name") for a in ASSETS if (a.get("uid") or "") == asset_uid), "") if asset_uid else get_scope_unit_display(dept))
    return {
        "title": "Maintenance Distribution Report",
        "subtitle": f"{dept} PM vs CM distribution",
        "period_label": _range_label_for_chart_report(start.date().isoformat(), end.date().isoformat()),
        "labels": labels,
        "pm_values": pm_series,
        "cm_values": cm_series,
        "cost_subtotals": cost_subtotals,
        "vat_values": vat_values,
        "total_cost_values": total_cost_values,
        "estimated_total_cost_values": estimated_total_cost_values,
        "rows": rows,
        "insights": insights,
        "cost_subtotal": total_cost_subtotal,
        "vat_amount": total_vat,
        "vat_rate_label": ", ".join((f"{r:g}%" for r in vat_rates if r > 0)) or "No VAT applied",
        "total_cost": total_cost,
        "estimated_cost_subtotal": estimated_cost_subtotal,
        "estimated_vat_amount": estimated_vat,
        "estimated_total_cost": estimated_cost_total,
        "record_count": total_tasks,
        "department": dept,
        "department_display": report_department_display(dept),
        "scope_label": scope_label or report_department_display(dept),
    }


def _chart_report_xlsx(payload: dict, fmt: str = "breakdown"):
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, Reference
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Report", payload.get("title") or "Chart Report"])
    ws.append(["Department", payload.get("department_display") or report_department_display(payload.get("department") or "Engineering")])
    ws.append(["Period", payload.get("period_label") or "Selected period"])
    ws.append(["Records", payload.get("record_count") or 0])
    ws.append(["Amount Before VAT", payload.get("cost_subtotal") or 0])
    ws.append(["VAT", payload.get("vat_amount") or 0])
    ws.append(["VAT Rate(s)", payload.get("vat_rate_label") or "No VAT applied"])
    ws.append(["Total", payload.get("total_cost") or 0])
    ws.append([])
    ws.append(["Executive Insights"])
    for line in payload.get("insights") or []:
        ws.append([line])
    data_ws = wb.create_sheet("Data")
    if fmt == "maintenance":
        data_ws.append(["Period", "PM", "CM", "Total", "Actual Before VAT", "VAT Amount", "Actual Total", "Estimated Total"])
        for row in payload.get("rows") or []:
            data_ws.append([row.get("period"), row.get("pm"), row.get("cm"), row.get("total"), row.get("cost_subtotal") or 0, row.get("vat_amount") or 0, row.get("total_cost") or 0, row.get("estimated_total_cost") or 0])
        chart = BarChart()
        chart.type = "col"
        chart.style = 10
        chart.title = payload.get("title") or "Maintenance Distribution"
        chart.y_axis.title = "Tasks"
        chart.x_axis.title = "Period"
        data = Reference(data_ws, min_col=2, max_col=3, min_row=1, max_row=max(2, data_ws.max_row))
        cats = Reference(data_ws, min_col=1, min_row=2, max_row=max(2, data_ws.max_row))
        chart.add_data(data, titles_from_data=True)
        chart.set_categories(cats)
        data_ws.add_chart(chart, "F2")
    else:
        data_ws.append(["Period", "Value", "Amount Before VAT", "VAT Amount", "Total Cost"])
        for row in payload.get("rows") or []:
            data_ws.append([row.get("period"), row.get("value"), row.get("cost_subtotal") or 0, row.get("vat_amount") or 0, row.get("total_cost") or 0])
        chart = BarChart()
        chart.type = "col"
        chart.style = 10
        chart.title = payload.get("title") or "Trend"
        chart.y_axis.title = "Count"
        chart.x_axis.title = "Period"
        data = Reference(data_ws, min_col=2, min_row=1, max_row=max(2, data_ws.max_row))
        cats = Reference(data_ws, min_col=1, min_row=2, max_row=max(2, data_ws.max_row))
        chart.add_data(data, titles_from_data=True)
        chart.set_categories(cats)
        data_ws.add_chart(chart, "D2")
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def _chart_report_csv(payload: dict, fmt: str = "breakdown"):
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([payload.get("title") or "Chart Report"])
    writer.writerow(["Department", payload.get("department_display") or report_department_display(payload.get("department") or "Engineering")])
    writer.writerow(["Period", payload.get("period_label") or "Selected period"])
    writer.writerow(["Records", payload.get("record_count") or 0])
    writer.writerow(["Amount Before VAT", payload.get("cost_subtotal") or 0])
    writer.writerow(["VAT", payload.get("vat_amount") or 0])
    writer.writerow(["VAT Rate(s)", payload.get("vat_rate_label") or "No VAT applied"])
    writer.writerow(["Total", payload.get("total_cost") or 0])
    writer.writerow([])
    writer.writerow(["Executive Insights"])
    for line in payload.get("insights") or []:
        writer.writerow([line])
    writer.writerow([])
    if fmt == "maintenance":
        writer.writerow(["Period", "PM", "CM", "Total", "Actual Before VAT", "VAT Amount", "Actual Total", "Estimated Total"])
        for row in payload.get("rows") or []:
            writer.writerow([row.get("period"), row.get("pm"), row.get("cm"), row.get("total"), row.get("cost_subtotal") or 0, row.get("vat_amount") or 0, row.get("total_cost") or 0, row.get("estimated_total_cost") or 0])
    else:
        writer.writerow(["Period", "Value", "Amount Before VAT", "VAT Amount", "Total Cost"])
        for row in payload.get("rows") or []:
            writer.writerow([row.get("period"), row.get("value"), row.get("cost_subtotal") or 0, row.get("vat_amount") or 0, row.get("total_cost") or 0])
    return out.getvalue()


def table_kv_for_chart_report(c, title: str, rows: list[tuple[str, str]], x: float, y: float, width: float):
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors
    data = [[title, ""]] + [[k, v] for k, v in rows]
    t = Table(data, colWidths=[width * 0.45, width * 0.55])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    t.wrapOn(c, 0, 0)
    t.drawOn(c, x, y - t._height)
    return y - t._height - 10


def table_exec_summary_for_chart_report(c, title: str, bullets: list[str], x: float, y: float, width: float):
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors
    data = [[title]] + [[b] for b in bullets]
    t = Table(data, colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEADING", (0, 1), (-1, -1), 11),
    ]))
    t.wrapOn(c, 0, 0)
    t.drawOn(c, x, y - t._height)
    return y - t._height - 10


def _chart_report_pdf(payload: dict, notes: str = "", fmt: str = "breakdown"):
    if not REPORTLAB_AVAILABLE:
        return None
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    def _money(v):
        try:
            return f"KES {float(v or 0):,.2f}"
        except Exception:
            return "KES 0.00"
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(A4))
    W, H = landscape(A4)
    body_top = _draw_pdf_header(c, W, H, department=payload.get("department_display") or report_department_display(payload.get("department") or "Engineering"), start_date=(payload.get("period_label") or "Selected period"), end_date="", report_title=payload.get("title") or "Chart Report", page_title="Executive View", reported_by=payload.get("reported_by") or base_ctx("reports")["current_user_name"])
    y = body_top - 6
    c.setFont("Helvetica-Bold", 16)
    c.drawString(30, y, payload.get("title") or "Chart Report")
    y -= 18
    c.setFont("Helvetica", 9)
    c.setFillColorRGB(0.3,0.3,0.3)
    c.drawString(30, y, payload.get("subtitle") or "")
    c.drawRightString(W - 30, y, f"Records: {payload.get('record_count') or 0}")
    c.setFillColorRGB(0,0,0)
    y -= 16
    labels = payload.get("labels") or []
    if fmt == "maintenance":
        values = [((payload.get("pm_values") or [0]*len(labels))[i] + (payload.get("cm_values") or [0]*len(labels))[i]) for i in range(len(labels))]
    else:
        values = payload.get("values") or []
    y = _draw_simple_series_chart(c, labels[:18], values[:18], 30, y, W - 60, 170, title=(payload.get("subtitle") or payload.get("title") or "Trend"))
    if fmt == "maintenance":
        summary_rows = [("Period", payload.get("period_label") or "Selected period"), ("Department", payload.get("department_display") or report_department_display(payload.get("department") or "Engineering")), ("Actual Before VAT", _money(payload.get("cost_subtotal"))), ("Actual VAT Amount", _money(payload.get("vat_amount"))), ("VAT Rate(s)", payload.get("vat_rate_label") or "No VAT applied"), ("Actual Total", _money(payload.get("total_cost"))), ("Estimated Total", _money(payload.get("estimated_total_cost")))]
    else:
        summary_rows = [("Period", payload.get("period_label") or "Selected period"), ("Department", payload.get("department_display") or report_department_display(payload.get("department") or "Engineering")), ("Amount Before VAT", _money(payload.get("cost_subtotal"))), ("VAT Amount", _money(payload.get("vat_amount"))), ("VAT Rate(s)", payload.get("vat_rate_label") or "No VAT applied"), ("Total Cost", _money(payload.get("total_cost")))]
    left_y = table_kv_for_chart_report(c, "Report Summary", summary_rows, 30, y, 250)
    insight_rows = [line for line in (payload.get("insights") or []) if str(line).strip()]
    if notes:
        insight_rows.append(f"Management Notes: {notes}")
    table_exec_summary_for_chart_report(c, "Executive Insights", insight_rows or ["No executive insights available."], 300, y, W - 330)
    c.showPage()
    c.save()
    buf.seek(0)
    return buf


@app.get("/breakdowns/frequency/export")
def breakdown_frequency_export():
    dept = get_current_department()
    fmt = (request.args.get("format") or "pdf").strip().lower()
    mode = (request.args.get("range") or "7d").strip().lower()
    year_raw = (request.args.get("year") or "").strip()
    quarter_raw = (request.args.get("quarter") or "").strip()
    notes = (request.args.get("notes") or "").strip()
    dfrom = (request.args.get("from") or "").strip() or None
    dto = (request.args.get("to") or "").strip() or None
    try:
        year = int(year_raw) if year_raw else None
    except Exception:
        year = None
    try:
        quarter = int(quarter_raw) if quarter_raw else None
    except Exception:
        quarter = None
    payload = _breakdown_frequency_payload(dept, mode, year, quarter, dfrom, dto)
    payload["reported_by"] = base_ctx("reports")["current_user_name"]
    payload["generated_label"] = datetime.now().strftime("%d %b %Y %H:%M")
    if fmt == "csv":
        return Response(_chart_report_csv(payload, fmt="breakdown"), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=breakdown_frequency_report.csv"})
    if fmt in ("xlsx", "excel"):
        out = _chart_report_xlsx(payload, fmt="breakdown")
        return send_file(out, as_attachment=True, download_name="breakdown_frequency_report.xlsx", mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    payload = _attach_chart_export_svgs(payload, report_kind="breakdown")
    if fmt == "html":
        pdf_url = url_for("breakdown_frequency_export", format="pdf", range=mode, year=year, quarter=quarter, **({"from": dfrom} if dfrom else {}), **({"to": dto} if dto else {}), **({"notes": notes} if notes else {}), inline=1)
        return render_template("reports/chart_export_print.html", report=payload, report_kind="breakdown", notes=notes, auto_print=((request.args.get("autoprint") or "").lower() in ("1","true","yes")), pdf_url=pdf_url, current_department_display=report_department_display(dept))
    html_content = render_template("reports/chart_export_print.html", report=payload, report_kind="breakdown", notes=notes, auto_print=False, pdf_url="", current_department_display=report_department_display(dept))
    pdf = _render_pdf_from_html(html_content, base_url=request.url_root) or _chart_report_pdf(payload, notes=notes, fmt="breakdown")
    inline = (request.args.get("inline") or "").strip().lower() in ("1", "true", "yes")
    return send_file(pdf, as_attachment=not inline, download_name="breakdown_frequency_report.pdf", mimetype="application/pdf")


@app.get("/maintenance/distribution/export")
def maintenance_distribution_export():
    dept = get_current_department()
    fmt = (request.args.get("format") or "pdf").strip().lower()
    range_key = (request.args.get("range") or "mtd").strip().lower()
    section = (request.args.get("section") or "").strip()
    asset_uid = (request.args.get("asset_uid") or "").strip()
    notes = (request.args.get("notes") or "").strip()
    payload = _maintenance_distribution_payload(dept, range_key, section, asset_uid)
    payload["reported_by"] = base_ctx("reports")["current_user_name"]
    payload["generated_label"] = datetime.now().strftime("%d %b %Y %H:%M")
    if fmt == "csv":
        return Response(_chart_report_csv(payload, fmt="maintenance"), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=maintenance_distribution_report.csv"})
    if fmt in ("xlsx", "excel"):
        out = _chart_report_xlsx(payload, fmt="maintenance")
        return send_file(out, as_attachment=True, download_name="maintenance_distribution_report.xlsx", mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    payload = _attach_chart_export_svgs(payload, report_kind="maintenance")
    if fmt == "html":
        pdf_url = url_for("maintenance_distribution_export", format="pdf", range=range_key, section=section, asset_uid=asset_uid, **({"notes": notes} if notes else {}), inline=1)
        return render_template("reports/chart_export_print.html", report=payload, report_kind="maintenance", notes=notes, auto_print=((request.args.get("autoprint") or "").lower() in ("1","true","yes")), pdf_url=pdf_url, current_department_display=report_department_display(dept))
    html_content = render_template("reports/chart_export_print.html", report=payload, report_kind="maintenance", notes=notes, auto_print=False, pdf_url="", current_department_display=report_department_display(dept))
    pdf = _render_pdf_from_html(html_content, base_url=request.url_root) or _chart_report_pdf(payload, notes=notes, fmt="maintenance")
    inline = (request.args.get("inline") or "").strip().lower() in ("1", "true", "yes")
    return send_file(pdf, as_attachment=not inline, download_name="maintenance_distribution_report.pdf", mimetype="application/pdf")


@app.get("/api/technicians/workload")
def technicians_workload_api():
    dept = get_current_department()
    rows = technician_workload_snapshot(dept)
    payload = []
    for row in rows:
        payload.append({
            "id": row.get("id"),
            "name": row.get("name"),
            "initials": initials(row.get("name") or "") or "NA",
            "active": int(row.get("active_breakdowns") or 0),
            "open_pm": int(row.get("open_pm") or 0),
            "due_soon": int(row.get("due_soon") or 0),
            "availability_score": int(row.get("availability_score") or 0),
            "on_time_rate": row.get("on_time_rate"),
            "avg_completion_days": row.get("avg_completion_days"),
        })
    payload.sort(key=lambda x: (x.get("active", 0), x.get("open_pm", 0)), reverse=True)
    return jsonify(rows=payload, note="Live workload across active breakdowns and scheduled PM tasks.")


# -------------------------
# Maintenance analytics APIs (department-aware)
# -------------------------

@app.get("/api/maintenance/distribution")
def maintenance_distribution_api():
    """
    Returns PM vs CM counts grouped by time buckets for charting.
    Filters: range, section, asset_uid
    Uses due_date as the event date (simple and consistent with schedules).
    """
    dept = get_current_department()

    range_key = (request.args.get("range") or "30d").strip().lower()
    section = (request.args.get("section") or "").strip()
    asset_uid = (request.args.get("asset_uid") or "").strip()

    start, end, granularity = _range_bounds(range_key)
    start_date = start.date() if hasattr(start, "date") else start
    end_date = end.date() if hasattr(end, "date") else end

    # universe is dept-scoped
    universe = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]

    if section:
        universe = [t for t in universe if (t.get("section") or "") == section]
    if asset_uid:
        universe = [t for t in universe if (t.get("asset_uid") or "") == asset_uid]

    items = []
    for t in universe:
        dd = parse_date_only(t.get("due_date") or "")
        if not dd:
            continue
        # treat due date as the plotted date
        if dd < start_date or dd > end_date:
            continue
        items.append((dd, t))

    # build buckets map
    buckets = {}  # label -> {"pm":0,"cm":0}
    for dd, t in items:
        lab = _bucket_label(dd, granularity)
        if lab not in buckets:
            buckets[lab] = {"pm": 0, "cm": 0}
        mtype = (t.get("maintenance_type") or "PM").strip().upper()
        if mtype == "CM":
            buckets[lab]["cm"] += 1
        else:
            buckets[lab]["pm"] += 1

    # stable timeline label generation (same idea as breakdown frequency API)
    labels = []
    cursor = start
    if granularity == "month":
        cursor = start.replace(day=1)
        while cursor <= end:
            labels.append(_bucket_label(cursor, "month"))
            cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    elif granularity == "week":
        while cursor <= end:
            labels.append(_bucket_label(cursor, "week"))
            cursor += timedelta(days=7)
    else:
        while cursor <= end:
            labels.append(_bucket_label(cursor, "day"))
            cursor += timedelta(days=1)

    pm_series = [buckets.get(l, {}).get("pm", 0) for l in labels]
    cm_series = [buckets.get(l, {}).get("cm", 0) for l in labels]

    return jsonify(
        range=range_key,
        labels=labels,
        series={
            "pm": pm_series,
            "cm": cm_series,
            "total": [pm_series[i] + cm_series[i] for i in range(len(labels))],
        },
        filters={"section": section or None, "asset_uid": asset_uid or None},
    )


@app.get("/api/maintenance/technicians")
def maintenance_technicians_api():
    """Technician availability/workload for Maintenance."""
    dept = get_current_department()
    range_key = (request.args.get("range") or "30d").strip().lower()
    section = (request.args.get("section") or "").strip()
    asset_uid = (request.args.get("asset_uid") or "").strip()
    start, end, _granularity = _range_bounds(range_key)
    start_date = start.date() if hasattr(start, "date") else start
    end_date = end.date() if hasattr(end, "date") else end
    rows = []
    for row in technician_workload_snapshot(dept):
        active = 0
        due_soon = 0
        for t in [enrich_pm_task(x) for x in MAINTENANCE_TASKS if (x.get("department") or "Engineering") == dept and ((x.get("technician") or "").strip() == (row.get("name") or ""))]:
            if section and (t.get("section") or "") != section:
                continue
            if asset_uid and (t.get("asset_uid") or "") != asset_uid:
                continue
            dd = _dateish(t.get("due_date"))
            if not dd or dd < start_date or dd > end_date:
                continue
            if (t.get("status") or "upcoming").strip().lower() == "completed":
                continue
            active += 1
            if dd <= (datetime.now().date() + timedelta(days=7)):
                due_soon += 1
        rows.append({
            "id": row.get("id"), "name": row.get("name"), "initials": initials(row.get("name") or "") or "NA",
            "active": int(active), "due_soon": int(due_soon), "availability_score": int(row.get("availability_score") or 0),
            "on_time_rate": row.get("on_time_rate"), "avg_completion_days": row.get("avg_completion_days"),
        })
    rows.sort(key=lambda x: (x["active"], -(x.get("availability_score") or 0)), reverse=True)
    return jsonify(range=range_key, filters={"section": section or None, "asset_uid": asset_uid or None}, rows=rows,
                   note="Active = upcoming and overdue PM tasks. Recommendations use workload, overdue exposure, and completion performance.")



# -------------------------
# BREAKDOWNS: MANAGEMENT (department-aware)
# -------------------------
@app.get("/breakdowns", endpoint="breakdowns")
@app.get("/breakdowns/management", endpoint="breakdowns_management")
def breakdowns_list():
    ctx = base_ctx("breakdowns")
    dept = get_current_department()

    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip().lower()
    severity = (request.args.get("severity") or "").strip().lower()
    technician = (request.args.get("technician") or "").strip()
    dt_from_raw = (request.args.get("dt_from") or "").strip()
    dt_to_raw = (request.args.get("dt_to") or "").strip()

    status = status if status in ("", "open", "in_progress", "resolved", "on_hold") else ""
    severity = severity if severity in ("", "critical", "medium", "low") else ""

    dt_from = parse_dt_local(dt_from_raw)
    dt_to = parse_dt_local(dt_to_raw)

    try:
        per_page = int(request.args.get("per_page") or 10)
    except ValueError:
        per_page = 10
    per_page = per_page if per_page in (5, 10, 20, 50) else 10

    try:
        page = int(request.args.get("page") or 1)
    except ValueError:
        page = 1
    page = max(page, 1)

    filtered = [b for b in BREAKDOWNS if (b.get('department') or 'Engineering') == dept]

    if q:
        ql = q.lower()

        def match(b):
            return (
                ql in (b.get("breakdown_id") or "").lower()
                or ql in (b.get("asset_name") or "").lower()
                or ql in (b.get("asset_id") or "").lower()
                or ql in (b.get("technician_name") or "").lower()
                or ql in (b.get("failure_category") or "").lower()
                or ql in (b.get("incident_title") or "").lower()
            )

        filtered = [b for b in filtered if match(b)]

    if status:
        filtered = [b for b in filtered if (b.get("status") or "") == status]
    if severity:
        filtered = [b for b in filtered if (b.get("severity") or "") == severity]

    if technician:
        filtered = [b for b in filtered if (b.get("technician_name") or "") == technician]

    if dt_from or dt_to:
        out = []
        for b in filtered:
            rdt = parse_dt_local(b.get("reported_dt") or "")
            if not rdt:
                continue
            if dt_from and rdt < dt_from:
                continue
            if dt_to and rdt > dt_to:
                continue
            out.append(b)
        filtered = out

    total = len(filtered)

    start = (page - 1) * per_page
    end = start + per_page
    page_items = filtered[start:end]

    total_pages = max(1, (total + per_page - 1) // per_page)
    if page > total_pages:
        page = total_pages
        start = (page - 1) * per_page
        end = start + per_page
        page_items = visible_rows[start:end]

    showing_from = 0 if total == 0 else start + 1
    showing_to = min(end, total)

    k = compute_kpi_trends(department=dept)
    uptime_rate = compute_uptime_rate(department=dept)

    rows = []
    for b in page_items:
        reported_date, reported_time = human_dt_parts(b.get("reported_dt") or "")
        rows.append(
            dict(
                breakdown_id=b.get("breakdown_id"),
                incident_title=b.get("incident_title") or "",
                asset_name=b.get("asset_name"),
                asset_id=b.get("asset_id"),
                reported_date=reported_date,
                reported_time=reported_time,
                severity=b.get("severity"),
                status=b.get("status"),
                technician_name=b.get("technician_name"),
                technician_initials=initials(b.get("technician_name") or ""),
            )
        )

    techs = sorted({t for t in ([b.get("technician_name") for b in filtered] + TECHNICIANS) if t})

    ctx.update(
        breakdowns=rows,
        q=q,
        selected_status=status,
        selected_severity=severity,
        selected_technician=technician,
        selected_dt_from=dt_from_raw,
        selected_dt_to=dt_to_raw,
        technicians=techs,
        per_page=per_page,
        page=page,
        total=total,
        total_pages=total_pages,
        showing_from=showing_from,
        showing_to=showing_to,
        pages=build_pagination(page, total_pages),
        kpi_active_breakdowns=k["active"],
        kpi_active_delta=k["active_delta"],
        kpi_mttr_hours=k["mttr_hours"],
        kpi_mttr_trend=k["mttr_trend"],
        kpi_downtime_mtd_hours=k["downtime_mtd_hours"],
        kpi_facilities=5,
        kpi_uptime_rate=uptime_rate,
        kpi_uptime_target=UPTIME_TARGET,
        kpi_cost_total=round(sum((_safe_float((b.get("cost_total")), 0.0) or 0.0) for b in filtered), 2),
    )
    return render_template("breakdowns/breakdowns_management.html", **ctx)


@app.post("/breakdowns/<breakdown_id>/delete")
def breakdowns_delete(breakdown_id):
    idx = next((i for i, b in enumerate(BREAKDOWNS) if b.get("breakdown_id") == breakdown_id), None)
    if idx is None:
        abort(404)
    b = BREAKDOWNS.pop(idx)

    if b.get("asset_uid"):
        _maybe_restore_asset_after_resolution(b.get("asset_uid"))

    next_url = request.form.get("next") or url_for("breakdowns")
    push_notification("Breakdown deleted", f"{b.get('incident_title') or b.get('breakdown_id') or 'Incident'} was removed.", "warning", href=url_for("breakdowns"), module="breakdowns")
    return redirect(next_url)


@app.get("/breakdowns/export")
def breakdowns_export():
    dept = get_current_department()
    fmt = (request.args.get("format") or "csv").strip().lower()

    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip().lower()
    severity = (request.args.get("severity") or "").strip().lower()
    technician = (request.args.get("technician") or "").strip()
    dt_from_raw = (request.args.get("dt_from") or "").strip()
    dt_to_raw = (request.args.get("dt_to") or "").strip()

    status = status if status in ("", "open", "in_progress", "resolved", "on_hold") else ""
    severity = severity if severity in ("", "critical", "medium", "low") else ""

    dt_from = parse_dt_local(dt_from_raw)
    dt_to = parse_dt_local(dt_to_raw)

    filtered = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept]

    if q:
        ql = q.lower()

        def match(b):
            return (
                ql in (b.get("breakdown_id") or "").lower()
                or ql in (b.get("asset_name") or "").lower()
                or ql in (b.get("asset_id") or "").lower()
                or ql in (b.get("technician_name") or "").lower()
                or ql in (b.get("failure_category") or "").lower()
                or ql in (b.get("incident_title") or "").lower()
            )

        filtered = [b for b in filtered if match(b)]

    if status:
        filtered = [b for b in filtered if (b.get("status") or "") == status]
    if severity:
        filtered = [b for b in filtered if (b.get("severity") or "") == severity]
    if technician:
        filtered = [b for b in filtered if (b.get("technician_name") or "") == technician]

    if dt_from or dt_to:
        out = []
        for b in filtered:
            rdt = parse_dt_local(b.get("reported_dt") or "")
            if not rdt:
                continue
            if dt_from and rdt < dt_from:
                continue
            if dt_to and rdt > dt_to:
                continue
            out.append(b)
        filtered = out

    rows = []
    for b in filtered:
        rows.append(
            {
                "breakdown_id": b.get("breakdown_id") or "",
                "incident_title": b.get("incident_title") or "",
                "asset_name": b.get("asset_name") or "",
                "asset_id": b.get("asset_id") or "",
                "reported_dt": b.get("reported_dt") or "",
                "severity": (b.get("severity") or "").title(),
                "status": safe_status_label(b.get("status") or ""),
                "technician_name": b.get("technician_name") or "",
                "technician_phone": b.get("technician_phone") or "",
                "technician_email": b.get("technician_email") or "",
                "failure_category": b.get("failure_category") or "",
                "department": b.get("department") or "",
            }
        )

    return export_rows_file(
        fmt,
        "breakdowns_export",
        "Breakdowns Management",
        [
            ("Breakdown ID", "breakdown_id"),
            ("Incident Title", "incident_title"),
            ("Asset Name", "asset_name"),
            ("Asset ID", "asset_id"),
            ("Reported", "reported_dt"),
            ("Severity", "severity"),
            ("Status", "status"),
            ("Technician", "technician_name"),
            ("Technician Phone", "technician_phone"),
            ("Technician Email", "technician_email"),
            ("Failure Category", "failure_category"),
            ("Department", "department"),
        ],
        rows,
    )



# -------------------------
# BREAKDOWNS: LOG FLOW STEP 1 (GET/POST)
# -------------------------
@app.get("/breakdowns/new/step1")
def breakdowns_new_step1_get():
    ref = request.referrer or ""
    coming_from_step2 = ("/breakdowns/new/step-2" in ref)

    if not request.args and not coming_from_step2:
        session.pop("breakdown_step1", None)
        session.pop("breakdown_step2", None)

    ctx = base_ctx("breakdowns")
    dept = get_current_department()

    selected_section = (request.args.get("section") or "").strip()
    pre_asset_uid = (request.args.get("asset_uid") or "").strip()

    distinct_sections = distinct_sections_from_assets(department=dept)
    sections = distinct_sections if distinct_sections else SECTIONS

    assets = []
    if selected_section:
        assets = [
            a for a in ASSETS
            if (a.get("department") or "Engineering") == dept and (a.get("section") or "") == selected_section
        ]
        assets.sort(key=lambda x: (x.get("asset_name") or "").lower())

    form = session.get("breakdown_step1", {}) or {}
    if pre_asset_uid:
        asset = _asset_by_uid(pre_asset_uid)
        if asset and (asset.get("department") or "Engineering") == dept:
            form = dict(form)
            form["section"] = selected_section or (asset.get("section") or "")
            form["asset_uid"] = pre_asset_uid

    tech_rows = technician_workload_snapshot(dept)
    ctx.update(
        sections=sections,
        selected_section=selected_section or (form.get("section") or ""),
        assets=assets,
        failure_categories=FAILURE_CATEGORIES,
        form=form,
        technician_directory=tech_rows,
        error=None,
    )
    return render_template("breakdowns/log_breakdown_step1.html", **ctx)


@app.post("/breakdowns/new/step1")
def breakdowns_new_step1_post():
    dept = get_current_department()

    incident_title = (request.form.get("incident_title") or "").strip()
    section = (request.form.get("section") or "").strip()
    scope_mode = (request.form.get("scope_mode") or "assets").strip().lower()
    if scope_mode not in ("assets", "section", "department"):
        scope_mode = "assets"
    asset_uids = [x.strip() for x in request.form.getlist("asset_uids") if (x or "").strip()]
    asset_uid = (request.form.get("asset_uid") or "").strip() or (asset_uids[0] if len(asset_uids) == 1 else "")
    incident_dt = (request.form.get("incident_dt") or "").strip()
    failure_category = (request.form.get("failure_category") or FAILURE_CATEGORIES[0]).strip()
    severity = normalize_severity(request.form.get("severity") or "medium")
    symptoms = (request.form.get("symptoms") or "").strip()
    assigned_technician_name = (request.form.get("assigned_technician_name") or "").strip()

    form = dict(
        incident_title=incident_title,
        section=section,
        asset_uid=asset_uid,
        incident_dt=incident_dt,
        failure_category=failure_category,
        severity=severity,
        symptoms=symptoms,
        assigned_technician_name=assigned_technician_name,
    )

    ctx = base_ctx("breakdowns")
    sections = distinct_sections_from_assets(department=dept)

    assets = []
    if section:
        assets = [
            a for a in ASSETS
            if (a.get("department") or "Engineering") == dept and (a.get("section") or "") == section
        ]
        assets.sort(key=lambda x: (x.get("asset_name") or "").lower())

    asset = next((a for a in ASSETS if a.get("uid") == asset_uid), None)

    if not incident_title:
        ctx.update(sections=sections, selected_section=section, assets=assets, failure_categories=FAILURE_CATEGORIES, form=form, technician_directory=technician_workload_snapshot(dept), error="Incident title is required.")
        return render_template("breakdowns/log_breakdown_step1.html", **ctx), 400

    if not section:
        ctx.update(sections=sections, selected_section=section, assets=assets, failure_categories=FAILURE_CATEGORIES, form=form, technician_directory=technician_workload_snapshot(dept), error="Please select a section.")
        return render_template("breakdowns/log_breakdown_step1.html", **ctx), 400

    if not asset_uid or not asset or (asset.get("department") or "Engineering") != dept:
        ctx.update(sections=sections, selected_section=section, assets=assets, failure_categories=FAILURE_CATEGORIES, form=form, technician_directory=technician_workload_snapshot(dept), error="Select a valid asset for this department. If none exist, register the asset first.")
        return render_template("breakdowns/log_breakdown_step1.html", **ctx), 400

    if not incident_dt:
        ctx.update(sections=sections, selected_section=section, assets=assets, failure_categories=FAILURE_CATEGORIES, form=form, technician_directory=technician_workload_snapshot(dept), error="Incident date & time is required.")
        return render_template("breakdowns/log_breakdown_step1.html", **ctx), 400

    session["breakdown_step1"] = form
    return redirect(url_for("breakdowns_new_step2_get"))


# -------------------------
# BREAKDOWNS: LOG FLOW STEP 2 (GET/POST)
# -------------------------
@app.get("/breakdowns/new/step-2")
def breakdowns_new_step2_get():
    if not session.get("breakdown_step1"):
        return redirect(url_for("breakdowns_new_step1_get"))

    ctx = base_ctx("breakdowns")
    dept = get_current_department()
    tech_rows = technician_workload_snapshot(dept)
    technicians = [x.get("name") for x in tech_rows]
    step1 = session.get("breakdown_step1", {}) or {}
    form = dict(session.get("breakdown_step2", {}) or {})
    if not form and (step1.get("assigned_technician_name") or "").strip():
        preselected_name = (step1.get("assigned_technician_name") or "").strip()
        preselected = next((t for t in tech_rows if (t.get("name") or "").strip() == preselected_name), None)
        form["lead_technician_name"] = preselected_name
        form["lead_technician_phone"] = (preselected or {}).get("phone") or ""
        form["lead_technician_email"] = (preselected or {}).get("email") or ""
    recommended = technician_recommendations(3, dept)
    ctx.update(
        technicians=technicians,
        tech_rows=tech_rows,
        recommended=recommended,
        form=form,
        assigned_technician_name=(step1.get("assigned_technician_name") or "").strip(),
        error=None,
    )
    return render_template("breakdowns/log_breakdown_step2.html", **ctx)


@app.post("/breakdowns/new/step-2")
def breakdowns_new_step2_post():
    if not session.get("breakdown_step1"):
        return redirect(url_for("breakdowns_new_step1_get"))

    do_rca = (request.form.get("do_rca") or "no").strip().lower()

    lead_technician_name = (request.form.get("lead_technician_name") or "").strip()
    lead_technician_phone = (request.form.get("lead_technician_phone") or "").strip()
    lead_technician_email = (request.form.get("lead_technician_email") or "").strip()
    selected_tech = next((t for t in TECHNICIAN_DIRECTORY if (t.get("name") or "").strip() == lead_technician_name), None)
    if selected_tech:
        if not lead_technician_phone:
            lead_technician_phone = (selected_tech.get("phone") or "").strip()
        if not lead_technician_email:
            lead_technician_email = (selected_tech.get("email") or "").strip()
    notes = (request.form.get("notes") or "").strip()
    invoice_file = request.files.get("invoice")
    invoice_guess = _invoice_cost_guess(invoice_file) if invoice_file and getattr(invoice_file, "filename", "") else {}
    if invoice_file and getattr(invoice_file, "filename", ""):
        try:
            invoice_url = save_uploaded_doc(invoice_file, MESSAGE_UPLOAD_DIR, "uploads/messages")
            invoice_guess["url"] = invoice_url
        except ValueError:
            flash("Breakdown invoice must be a supported document/image under 10MB.", "error")
            return redirect(url_for("breakdowns_new_step2_get"))
    cost_fields = _compute_cost_fields(request.form.get("cost_subtotal"), request.form.get("cost_apply_vat"), request.form.get("cost_vat_pct"), invoice_guess)

    uploaded_files = []
    files = request.files.getlist("media")
    for f in files:
        if not f or not f.filename:
            continue
        try:
            url = save_uploaded_image(f, BREAKDOWN_UPLOAD_DIR, "uploads/breakdowns")
        except ValueError:
            ctx = base_ctx("breakdowns")
            dept = get_current_department()
            tech_rows = technician_workload_snapshot(dept)
            ctx.update(
                technicians=[x.get("name") for x in tech_rows],
                tech_rows=tech_rows,
                recommended=technician_recommendations(3, dept),
                form={
                    "lead_technician_name": lead_technician_name,
                    "lead_technician_phone": lead_technician_phone,
                    "lead_technician_email": lead_technician_email,
                    "notes": notes,
                    "uploaded": uploaded_files,
                },
                assigned_technician_name=(session.get("breakdown_step1", {}) or {}).get("assigned_technician_name") or "",
                error="Uploads must be JPG/PNG/WEBP and max 5MB each.",
            )
            return render_template("breakdowns/log_breakdown_step2.html", **ctx), 400

        uploaded_files.append(url)

    session["breakdown_step2"] = {
        "lead_technician_name": lead_technician_name,
        "lead_technician_phone": lead_technician_phone,
        "lead_technician_email": lead_technician_email,
        "notes": notes,
        "uploaded": uploaded_files,
        "invoice": invoice_guess,
        **cost_fields,
    }

    step1 = session.get("breakdown_step1", {}) or {}
    step2 = session.get("breakdown_step2", {}) or {}

    asset = next((a for a in ASSETS if a.get("uid") == step1.get("asset_uid")), None)
    if not asset:
        abort(400)

    breakdown_id = next_breakdown_id()
    created_at = datetime.now().isoformat(timespec="seconds")

    technician_name = (step2.get("lead_technician_name") or step1.get("assigned_technician_name") or "").strip()
    status = "open" if not technician_name else "in_progress"

    # 3.2 Copy department into breakdown payload
    payload = dict(
        breakdown_id=breakdown_id,
        created_at=created_at,
        reported_dt=step1.get("incident_dt"),
        incident_title=(step1.get("incident_title") or "").strip(),
        section=(step1.get("section") or "").strip(),
        asset_uid=asset.get("uid"),
        asset_name=asset.get("asset_name"),
        asset_id=asset.get("asset_id"),
        asset_serial_no=asset.get("serial_no") or "",
        failure_category=step1.get("failure_category"),
        severity=normalize_severity(step1.get("severity")),
        symptoms=step1.get("symptoms"),
        technician_name=technician_name,
        technician_phone=(step2.get("lead_technician_phone") or "").strip(),
        technician_email=(step2.get("lead_technician_email") or "").strip(),
        status=status,
        notes=step2.get("notes"),
        media=step2.get("uploaded") or [],
        duration_mins=None,
        resolved_at=None,
        progress_log=[],
        rca=None,
        department=asset.get("department") or get_current_department(),
        cost_subtotal=step2.get("cost_subtotal"),
        cost_apply_vat=bool(step2.get("cost_apply_vat")),
        cost_vat_pct=step2.get("cost_vat_pct"),
        cost_vat_amount=step2.get("cost_vat_amount"),
        cost_total=step2.get("cost_total"),
        invoice=step2.get("invoice") or {},
    )

    BREAKDOWNS.insert(0, payload)
    push_notification("Breakdown logged", f"{payload.get('incident_title') or payload.get('breakdown_id') or 'Incident'} was logged for {payload.get('asset_name') or 'an asset'}.", "warning", href=url_for("breakdowns_view", breakdown_id=payload["breakdown_id"]), module="breakdowns")

    if (asset.get("status") or "").strip() == "operational":
        set_asset_status(asset.get("uid"), "maintenance", reason=f"breakdown:{breakdown_id}")

    session.pop("breakdown_step1", None)
    session.pop("breakdown_step2", None)

    if do_rca == "yes":
        return redirect(url_for("breakdowns_rca_get", breakdown_id=breakdown_id))

    return redirect(url_for("breakdowns_success", breakdown_id=breakdown_id))


# -------------------------
# BREAKDOWNS: SUCCESS PAGE
# -------------------------
@app.get("/breakdowns/success/<breakdown_id>")
def breakdowns_success(breakdown_id):
    ctx = base_ctx("breakdowns")
    b = next((x for x in BREAKDOWNS if x.get("breakdown_id") == breakdown_id), None)
    if not b:
        abort(404)

    asset = next((a for a in ASSETS if a.get("uid") == b.get("asset_uid")), None)
    asset_photo_url = (asset or {}).get("photo_url")

    reported_date, reported_time = human_dt_parts(b.get("reported_dt") or "")
    reported_label = f"{reported_date} • {reported_time}"

    ctx.update(
        breakdown_id=b.get("breakdown_id"),
        incident_title=b.get("incident_title") or "",
        asset_name=b.get("asset_name"),
        asset_id=b.get("asset_id"),
        asset_photo_url=asset_photo_url,
        severity=(b.get("severity") or "medium").upper(),
        technician_name=b.get("technician_name") or "Unassigned",
        tech_initials=initials(b.get("technician_name") or ""),
        reported_label=reported_label,
        status_label=safe_status_label(b.get("status") or "open"),
    )
    return render_template("breakdowns/breakdown_success.html", **ctx)


# -------------------------
# BREAKDOWNS: VIEW DETAILS
# -------------------------
@app.get("/breakdowns/<breakdown_id>")
def breakdowns_view(breakdown_id):
    ctx = base_ctx("breakdowns")
    b = next((x for x in BREAKDOWNS if x.get("breakdown_id") == breakdown_id), None)
    if not b:
        abort(404)

    asset = next((a for a in ASSETS if a.get("uid") == b.get("asset_uid")), None)
    asset_photo_url = (asset or {}).get("photo_url")
    asset_serial_no = (asset or {}).get("serial_no") or b.get("asset_serial_no") or ""
    section = b.get("section") or (asset or {}).get("section") or ""

    reported_date, reported_time = human_dt_parts(b.get("reported_dt") or "")

    reported_dt_iso = (b.get("reported_dt") or "").strip()
    resolved_dt_iso = (b.get("resolved_at") or "").strip() if b.get("status") == "resolved" else ""
    resolved_date, resolved_time = human_dt_parts(resolved_dt_iso) if resolved_dt_iso else ("-", "-")

    downtime_display_label = "—"
    if b.get("status") == "resolved":
        mins = b.get("duration_mins")
        if mins is None and reported_dt_iso and resolved_dt_iso:
            mins = minutes_between(reported_dt_iso, resolved_dt_iso)
        downtime_display_label = fmt_hm_from_minutes(mins or 0)
    else:
        mins = minutes_between(reported_dt_iso or "", datetime.now().isoformat(timespec="seconds"))
        downtime_display_label = fmt_hm_from_minutes(mins or 0)

    media = b.get("media") or []
    media_count = len(media)

    tech_name = b.get("technician_name") or ""
    tech_initials = initials(tech_name) if tech_name else "NA"

    ctx.update(
        breakdown=b,
        breakdown_id=b.get("breakdown_id"),
        incident_title=b.get("incident_title") or "",
        section=section,
        asset_name=b.get("asset_name"),
        asset_id=b.get("asset_id"),
        asset_serial_no=asset_serial_no,
        asset_photo_url=asset_photo_url,
        failure_category=b.get("failure_category"),
        severity=b.get("severity"),
        status=b.get("status"),
        status_label=safe_status_label(b.get("status")),
        symptoms=b.get("symptoms"),
        notes=b.get("notes"),
        reported_date=reported_date,
        reported_time=reported_time,
        resolved_date=resolved_date,
        resolved_time=resolved_time,
        downtime_display_label=downtime_display_label,
        reported_dt_iso=reported_dt_iso,
        resolved_dt_iso=resolved_dt_iso,
        technician_name=tech_name or "Unassigned",
        technician_initials=tech_initials,
        media=media,
        media_count=media_count,
        progress_log=b.get("progress_log") or [],
        rca=b.get("rca") or None,
        cost_subtotal=round(_safe_float(b.get("cost_subtotal"), 0.0) or 0.0, 2),
        cost_vat_pct=round(_safe_float(b.get("cost_vat_pct"), 0.0) or 0.0, 2),
        cost_vat_amount=round(_safe_float(b.get("cost_vat_amount"), 0.0) or 0.0, 2),
        cost_total=round(_safe_float(b.get("cost_total"), 0.0) or 0.0, 2),
    )
    if (request.args.get("print") or "").lower() in ("1", "true", "yes"):
        return render_template("breakdowns/breakdown_print.html", **ctx)
    return render_template("breakdowns/view_breakdown_details.html", **ctx)


# -------------------------
# BREAKDOWNS: UPDATE INCIDENT (GET/POST)
# -------------------------
@app.get("/breakdowns/<breakdown_id>/update")
def breakdowns_update_get(breakdown_id):
    ctx = base_ctx("breakdowns")
    b = next((x for x in BREAKDOWNS if x.get("breakdown_id") == breakdown_id), None)
    if not b:
        abort(404)

    ctx.update(
        breakdown=b,
        breakdown_id=b.get("breakdown_id"),
        incident_title=b.get("incident_title") or "",
        asset_name=b.get("asset_name"),
        status=b.get("status"),
        technician_name=b.get("technician_name"),
        failure_category=b.get("failure_category"),
        severity=b.get("severity"),
        error=None,
    )
    return render_template("breakdowns/update_incident.html", **ctx)


@app.post("/breakdowns/<breakdown_id>/update")
def breakdowns_update_post(breakdown_id):
    b = next((x for x in BREAKDOWNS if x.get("breakdown_id") == breakdown_id), None)
    if not b:
        abort(404)

    status = normalize_status(request.form.get("status") or b.get("status") or "open")
    work_log = (request.form.get("work_log") or "").strip()
    labor_hours = (request.form.get("labor_hours") or "").strip()
    findings = (request.form.get("findings") or "").strip()

    if work_log or labor_hours or findings:
        b.setdefault("progress_log", [])
        b["progress_log"].insert(
            0,
            dict(
                ts=datetime.now().isoformat(timespec="seconds"),
                status=status,
                work_log=work_log,
                labor_hours=labor_hours,
                findings=findings,
            ),
        )

    just_resolved = False
    if status == "resolved" and b.get("status") != "resolved":
        resolved_at = datetime.now().isoformat(timespec="seconds")
        b["resolved_at"] = resolved_at
        mins = minutes_between(b.get("reported_dt") or "", resolved_at)
        b["duration_mins"] = mins
        just_resolved = True

    b["status"] = status

    if just_resolved and b.get("asset_uid"):
        _maybe_restore_asset_after_resolution(b.get("asset_uid"))

    push_notification("Breakdown updated", f"{b.get('incident_title') or b.get('breakdown_id') or 'Incident'} was updated.", "info", href=url_for("breakdowns_view", breakdown_id=breakdown_id), module="breakdowns")

    return redirect(url_for("breakdowns_view", breakdown_id=breakdown_id))


@app.post("/breakdowns/<breakdown_id>/close")
def breakdowns_close(breakdown_id):
    b = next((x for x in BREAKDOWNS if x.get("breakdown_id") == breakdown_id), None)
    if not b:
        abort(404)

    just_resolved = False
    if b.get("status") != "resolved":
        resolved_at = datetime.now().isoformat(timespec="seconds")
        b["resolved_at"] = resolved_at
        mins = minutes_between(b.get("reported_dt") or "", resolved_at)
        b["duration_mins"] = mins
        b["status"] = "resolved"
        just_resolved = True

        b.setdefault("progress_log", [])
        b["progress_log"].insert(
            0,
            dict(
                ts=resolved_at,
                status="resolved",
                work_log="Incident closed from management action.",
                labor_hours="",
                findings="",
            ),
        )

    if just_resolved and b.get("asset_uid"):
        _maybe_restore_asset_after_resolution(b.get("asset_uid"))

    push_notification("Breakdown resolved", f"{b.get('incident_title') or b.get('breakdown_id') or 'Incident'} was closed.", "success", href=url_for("breakdowns_view", breakdown_id=breakdown_id), module="breakdowns")

    next_url = request.form.get("next") or url_for("breakdowns_view", breakdown_id=breakdown_id)
    return redirect(next_url)


@app.get("/breakdowns/<breakdown_id>/rca")
def breakdowns_rca_get(breakdown_id):
    ctx = base_ctx("breakdowns")
    b = next((x for x in BREAKDOWNS if x.get("breakdown_id") == breakdown_id), None)
    if not b:
        abort(404)

    ctx.update(
        breakdown=b,
        breakdown_id=b.get("breakdown_id"),
        incident_title=b.get("incident_title") or "",
        asset_name=b.get("asset_name"),
        rca=b.get("rca") or {},
        error=None,
    )
    return render_template("breakdowns/root_cause.html", **ctx)


@app.post("/breakdowns/<breakdown_id>/rca")
def breakdowns_rca_post(breakdown_id):
    b = next((x for x in BREAKDOWNS if x.get("breakdown_id") == breakdown_id), None)
    if not b:
        abort(404)

    primary_root_cause = (request.form.get("primary_root_cause") or "").strip()
    sev_upgrade = (request.form.get("sev_upgrade") or "").strip().lower() == "on"

    why1 = (request.form.get("why1") or "").strip()
    why2 = (request.form.get("why2") or "").strip()
    why3 = (request.form.get("why3") or "").strip()
    why4 = (request.form.get("why4") or "").strip()
    why5 = (request.form.get("why5") or "").strip()

    corrective = (request.form.get("corrective") or "").strip()
    preventive = (request.form.get("preventive") or "").strip()

    verified_by = (request.form.get("verified_by") or "").strip()
    closure_date = (request.form.get("closure_date") or "").strip()

    rca_payload = dict(
        primary_root_cause=primary_root_cause,
        severity_re_evaluated=sev_upgrade,
        five_whys=[why1, why2, why3, why4, why5],
        corrective=corrective,
        preventive=preventive,
        verified_by=verified_by,
        closure_date=closure_date,
        saved_at=datetime.now().isoformat(timespec="seconds"),
    )

    b["rca"] = rca_payload

    just_resolved = False
    if closure_date and b.get("status") != "resolved":
        resolved_at = datetime.now().isoformat(timespec="seconds")
        b["resolved_at"] = resolved_at
        mins = minutes_between(b.get("reported_dt") or "", resolved_at)
        b["duration_mins"] = mins
        b["status"] = "resolved"
        just_resolved = True

    if just_resolved and b.get("asset_uid"):
        _maybe_restore_asset_after_resolution(b.get("asset_uid"))

    return redirect(url_for("breakdowns_view", breakdown_id=breakdown_id))


# -------------------------
# Preventive Maintenance: Management + Wizard + Calendar (department-aware)
# -------------------------
@app.get("/maintenance", endpoint="maintenance_management")
def maintenance_list():
    ctx = base_ctx("maintenance")
    dept = get_current_department()

    sections = distinct_sections_from_assets(department=dept)
    technicians = build_tech_list()

    q = (request.args.get("q") or "").strip()
    section = (request.args.get("section") or "").strip()
    mtype = (request.args.get("type") or "").strip().upper()
    frequency = (request.args.get("frequency") or "").strip()
    technician = (request.args.get("technician") or "").strip()
    asset_uid = (request.args.get("asset_uid") or "").strip()
    status = (request.args.get("status") or "").strip().lower()
    due_from_raw = (request.args.get("due_from") or "").strip()
    due_to_raw = (request.args.get("due_to") or "").strip()

    if mtype not in ("", "PM", "CM"):
        mtype = ""
    status = status if status in ("", "upcoming", "overdue", "completed") else ""

    due_from = parse_date_only(due_from_raw) if due_from_raw else None
    due_to = parse_date_only(due_to_raw) if due_to_raw else None

    try:
        per_page = int(request.args.get("per_page") or 10)
    except ValueError:
        per_page = 10
    per_page = per_page if per_page in (5, 10, 20, 50) else 10

    try:
        page = int(request.args.get("page") or 1)
    except ValueError:
        page = 1
    page = max(page, 1)

    enriched = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]
    filtered = enriched[:]

    if section:
        filtered = [t for t in filtered if (t.get("section") or "") == section]
    if mtype:
        filtered = [t for t in filtered if (t.get("maintenance_type") or "") == mtype]
    if frequency:
        filtered = [t for t in filtered if (t.get("frequency") or "") == frequency]
    if technician:
        filtered = [t for t in filtered if (t.get("technician") or "") == technician]
    if asset_uid:
        filtered = [t for t in filtered if _norm_str(t.get("asset_uid") or "") == _norm_str(asset_uid)]
    if status:
        filtered = [t for t in filtered if (t.get("status") or "") == status]

    if due_from or due_to:
        out = []
        for t in filtered:
            dd = parse_date_only(t.get("due_date") or "")
            if not dd:
                continue
            if due_from and dd < due_from:
                continue
            if due_to and dd > due_to:
                continue
            out.append(t)
        filtered = out

    if q:
        ql = q.lower()

        def match(t):
            return (
                ql in (t.get("task_id") or "").lower()
                or ql in (t.get("asset_name") or "").lower()
                or ql in (t.get("asset_id") or "").lower()
                or ql in (t.get("task_title") or "").lower()
                or ql in (t.get("task_description") or "").lower()
                or ql in (t.get("technician") or "").lower()
                or ql in (t.get("section") or "").lower()
            )

        filtered = [t for t in filtered if match(t)]

    now = datetime.now()
    today = now.date()
    in_7 = today + timedelta(days=7)
    month_key = now.strftime("%Y-%m")

    all_enriched = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]

    pm_month = 0
    overdue_total = 0
    upcoming_7 = 0

    due_mtd_total = 0
    on_time_completed = 0

    # ✅ IMPORTANT: this loop MUST be inside the function
    for t in all_enriched:
        dd = parse_date_only(t.get("due_date") or "")

        if t.get("status") == "overdue":
            overdue_total += 1

        if dd:
            if dd >= today and dd <= in_7 and (t.get("status") or "") != "completed":
                upcoming_7 += 1

            if dd.strftime("%Y-%m") == month_key and (t.get("maintenance_type") or "") == "PM":
                pm_month += 1

            # ✅ PM COMPLIANCE: ONLY PM tasks due MTD (and due up to today)
            if (
                dd.strftime("%Y-%m") == month_key
                and dd <= today
                and (t.get("maintenance_type") or "") == "PM"
            ):
                due_mtd_total += 1

                # Optional: if completed but completed_at missing, set it so it can count
                if (t.get("status") or "") == "completed" and not t.get("completed_at"):
                    t["completed_at"] = datetime.now().isoformat(timespec="seconds")

                if (t.get("status") or "") == "completed":
                    ca = parse_iso_dt(t.get("completed_at") or "")
                    if ca and ca.date() <= dd:
                        on_time_completed += 1

    compliance = (on_time_completed / due_mtd_total * 100.0) if due_mtd_total > 0 else 0.0
    current_year = today.year
    actual_cost_total = round(sum((_task_cost_value(t, "cost_total", 0.0) or 0.0) for t in all_enriched if (t.get("status") or "").strip().lower() == "completed" and bool(t.get("cost_collected"))), 2)
    estimated_cost_total = round(sum((_task_cost_value(t, "cost_total", 0.0) or 0.0) for t in all_enriched if (parse_date_only(t.get("due_date") or "") and parse_date_only(t.get("due_date") or "").year == current_year)), 2)

    visible_rows = _visible_management_tasks(filtered, status_filter=status)

    total = len(visible_rows)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = visible_rows[start:end]

    total_pages = max(1, (total + per_page - 1) // per_page)
    if page > total_pages:
        page = total_pages
        start = (page - 1) * per_page
        end = start + per_page
        page_items = visible_rows[start:end]

    showing_from = 0 if total == 0 else start + 1
    showing_to = min(end, total)

    ctx.update(
        sections=sections,
        technicians=technicians,
        tasks=page_items,
        q=q,
        selected_section=section,
        selected_type=mtype,
        selected_frequency=frequency,
        selected_technician=technician,
        selected_status=status,
        selected_due_from=due_from_raw,
        selected_due_to=due_to_raw,
        per_page=per_page,
        page=page,
        total=total,
        total_pages=total_pages,
        showing_from=showing_from,
        showing_to=showing_to,
        pages=build_pagination(page, total_pages),
        kpi_total_pm_month=pm_month,
        kpi_overdue=overdue_total,
        kpi_upcoming_7=upcoming_7,
        kpi_compliance_rate=compliance,
        kpi_cost_total=actual_cost_total,
        kpi_estimated_cost_total=estimated_cost_total,
    )
    return render_template("maintenance/maintenance_management.html", **ctx)


@app.get("/maintenance/export/<fmt>")
def maintenance_export(fmt):
    dept = get_current_department()
    q = (request.args.get("q") or "").strip()
    section = (request.args.get("section") or "").strip()
    frequency = (request.args.get("frequency") or "").strip()
    technician = (request.args.get("technician") or "").strip()
    asset_uid = (request.args.get("asset_uid") or "").strip()
    mtype = (request.args.get("type") or "").strip().upper()
    status = (request.args.get("status") or "").strip().lower()
    due_from_raw = (request.args.get("due_from") or "").strip()
    due_to_raw = (request.args.get("due_to") or "").strip()

    mtype = mtype if mtype in ("", "PM", "CM") else ""
    status = status if status in ("", "upcoming", "overdue", "completed") else ""
    due_from = parse_date_only(due_from_raw) if due_from_raw else None
    due_to = parse_date_only(due_to_raw) if due_to_raw else None

    filtered = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]
    if section:
        filtered = [t for t in filtered if (t.get("section") or "") == section]
    if mtype:
        filtered = [t for t in filtered if (t.get("maintenance_type") or "") == mtype]
    if frequency:
        filtered = [t for t in filtered if (t.get("frequency") or "") == frequency]
    if technician:
        filtered = [t for t in filtered if (t.get("technician") or "") == technician]
    if asset_uid:
        filtered = [t for t in filtered if _norm_str(t.get("asset_uid") or "") == _norm_str(asset_uid)]
    if status:
        filtered = [t for t in filtered if (t.get("status") or "") == status]
    if due_from or due_to:
        out = []
        for t in filtered:
            dd = parse_date_only(t.get("due_date") or "")
            if not dd:
                continue
            if due_from and dd < due_from:
                continue
            if due_to and dd > due_to:
                continue
            out.append(t)
        filtered = out
    if q:
        ql = q.lower()
        filtered = [
            t for t in filtered
            if ql in (t.get("task_id") or "").lower()
            or ql in (t.get("asset_name") or "").lower()
            or ql in (t.get("asset_id") or "").lower()
            or ql in (t.get("task_title") or "").lower()
            or ql in (t.get("task_description") or "").lower()
            or ql in (t.get("technician") or "").lower()
            or ql in (t.get("section") or "").lower()
        ]

    rows = [
        {
            "task_id": t.get("task_id") or "",
            "asset_name": t.get("asset_name") or "",
            "asset_id": t.get("asset_id") or "",
            "section": t.get("section") or "",
            "maintenance_type": t.get("maintenance_type") or "",
            "frequency": t.get("frequency") or "",
            "due_date": t.get("due_date") or "",
            "completed_at": t.get("completed_at") or "",
            "technician": t.get("technician") or "",
            "status": (t.get("status") or "").replace("_", " ").title(),
            "priority": (t.get("priority") or "").title(),
            "cost_subtotal": round(_task_cost_value(t, "cost_subtotal", 0.0) or 0.0, 2),
            "vat_rate": f"{round(_safe_float(t.get('cost_vat_pct'), 0.0) or 0.0, 2):g}%" if _task_cost_counts_for_reporting(t) and _safe_float(t.get("cost_vat_pct"), None) is not None else "No VAT",
            "vat_amount": round(_task_cost_value(t, "cost_vat_amount", 0.0) or 0.0, 2),
            "cost_total": round(_task_cost_value(t, "cost_total", 0.0) or 0.0, 2),
            "cost_realized": "Yes" if t.get("cost_collected") else "No",
            "task_description": t.get("task_description") or "",
        }
        for t in filtered
    ]
    return export_rows_file(
        fmt,
        "maintenance_schedules",
        "Maintenance Management",
        [
            ("Task ID", "task_id"),
            ("Asset Name", "asset_name"),
            ("Asset ID", "asset_id"),
            ("Section", "section"),
            ("Type", "maintenance_type"),
            ("Frequency", "frequency"),
            ("Due Date", "due_date"),
            ("Completed At", "completed_at"),
            ("Technician", "technician"),
            ("Status", "status"),
            ("Priority", "priority"),
            ("Amount Before VAT", "cost_subtotal"),
            ("VAT Rate", "vat_rate"),
            ("VAT Amount", "vat_amount"),
            ("Total Cost", "cost_total"),
            ("Actual Cost Confirmed", "cost_realized"),
            ("Task Description", "task_description"),
        ],
        rows,
    )


@app.get("/maintenance/schedule/step-1", endpoint="maintenance_schedule_step1")
def maintenance_schedule_step1():
    ctx = base_ctx("maintenance")
    dept = get_current_department()
    ctx["sections"] = distinct_sections_from_assets(department=dept)

    pre_section = (request.args.get("section") or "").strip()
    pre_asset_uid = (request.args.get("asset_uid") or "").strip()

    if not request.args:
        session.pop("pm_step1", None)
        session.pop("pm_step2", None)
        session.pop("pm_step3", None)

    saved = session.get("pm_step1", {}) or {}
    if pre_section:
        saved = dict(saved)
        saved["section"] = pre_section
    if pre_asset_uid:
        saved = dict(saved)
        saved["asset_uid"] = pre_asset_uid

    selected_section = (saved.get("section") or "").strip()

    assets = []
    if selected_section:
        assets = [
            a for a in ASSETS
            if (a.get("department") or "Engineering") == dept and (a.get("section") or "") == selected_section
        ]
        assets.sort(key=lambda x: (x.get("asset_name") or "").lower())

    ctx.update(
        assets=assets,
        form=saved,
        error=None,
    )
    return render_template("maintenance/schedule_step1.html", **ctx)


@app.post("/maintenance/schedule/step-1", endpoint="maintenance_schedule_step1_post")
def maintenance_schedule_step1_post():
    dept = get_current_department()

    section = (request.form.get("section") or "").strip()
    scope_mode = (request.form.get("scope_mode") or "assets").strip().lower()
    if scope_mode not in ("assets", "section", "department"):
        scope_mode = "assets"
    asset_uids = [x.strip() for x in request.form.getlist("asset_uids") if (x or "").strip()]
    asset_uid = (request.form.get("asset_uid") or "").strip() or (asset_uids[0] if len(asset_uids) == 1 else "")
    maintenance_type = (request.form.get("maintenance_type") or "PM").strip().upper()
    task_title = (request.form.get("task_title") or "").strip()
    task_description = (request.form.get("task_description") or "").strip()

    if maintenance_type not in ("PM", "CM"):
        maintenance_type = "PM"

    asset = next((a for a in ASSETS if a.get("uid") == asset_uid), None)

    form = dict(
        section=section,
        asset_uid=asset_uid,
        maintenance_type=maintenance_type,
        task_title=task_title,
        task_description=task_description,
    )

    ctx = base_ctx("maintenance")
    ctx["sections"] = distinct_sections_from_assets(department=dept)

    assets = []
    if section:
        assets = [
            a for a in ASSETS
            if (a.get("department") or "Engineering") == dept and (a.get("section") or "") == section
        ]
        assets.sort(key=lambda x: (x.get("asset_name") or "").lower())

    if not section:
        ctx.update(assets=assets, form=form, error="Please select a section first.")
        return render_template("maintenance/schedule_step1.html", **ctx), 400

    if not asset or (asset.get("section") or "") != section or (asset.get("department") or "Engineering") != dept:
        ctx.update(assets=assets, form=form, error="Select a valid machine from the selected section (in this department).")
        return render_template("maintenance/schedule_step1.html", **ctx), 400

    if not task_title:
        ctx.update(assets=assets, form=form, error="Task title is required.")
        return render_template("maintenance/schedule_step1.html", **ctx), 400

    if not task_description:
        ctx.update(assets=assets, form=form, error="Procedure/description is required.")
        return render_template("maintenance/schedule_step1.html", **ctx), 400

    session["pm_step1"] = form
    return redirect(url_for("maintenance_schedule_step2"))


@app.get("/maintenance/schedule/step-2", endpoint="maintenance_schedule_step2")
def maintenance_schedule_step2_get():
    if not session.get("pm_step1"):
        return redirect(url_for("maintenance_schedule_step1"))

    ctx = base_ctx("maintenance")
    ctx["form"] = session.get("pm_step2", {}) or {}
    ctx["error"] = None
    return render_template("maintenance/schedule_step2.html", **ctx)


@app.post("/maintenance/schedule/step-2", endpoint="maintenance_schedule_step2_post")
def maintenance_schedule_step2_post():
    if not session.get("pm_step1"):
        return redirect(url_for("maintenance_schedule_step1"))

    frequency = normalize_frequency(request.form.get("frequency") or "Monthly")
    first_service_date = safe_date_str(request.form.get("first_service_date") or "")
    duration_value = (request.form.get("duration_value") or "").strip()
    duration_unit = (request.form.get("duration_unit") or "Hours").strip()
    priority = normalize_priority(request.form.get("priority") or "medium")

    if not first_service_date or not parse_date_only(first_service_date):
        ctx = base_ctx("maintenance")
        ctx.update(form=request.form, error="First service date must be valid (YYYY-MM-DD).")
        return render_template("maintenance/schedule_step2.html", **ctx), 400

    session["pm_step2"] = dict(
        frequency=frequency,
        first_service_date=first_service_date,
        duration_value=duration_value,
        duration_unit=duration_unit,
        priority=priority,
    )
    return redirect(url_for("maintenance_schedule_step3"))


@app.get("/maintenance/schedule/step-3", endpoint="maintenance_schedule_step3")
def maintenance_schedule_step3_get():
    if not session.get("pm_step1") or not session.get("pm_step2"):
        return redirect(url_for("maintenance_schedule_step1"))

    ctx = base_ctx("maintenance")
    tech_rows = technician_workload_snapshot(get_current_department())
    ctx["technicians"] = [x.get("name") for x in tech_rows]
    ctx["tech_rows"] = tech_rows
    ctx["recommended_technicians"] = technician_recommendations(3, get_current_department())
    ctx["form"] = session.get("pm_step3", {}) or {}
    ctx["error"] = None
    return render_template("maintenance/schedule_step3.html", **ctx)


@app.post("/maintenance/schedule/step-3", endpoint="maintenance_schedule_step3_post")
def maintenance_schedule_step3_post():
    if not session.get("pm_step1") or not session.get("pm_step2"):
        return redirect(url_for("maintenance_schedule_step1"))

    technician = (request.form.get("technician") or "").strip()
    notes = (request.form.get("notes") or "").strip()
    invoice_file = request.files.get("invoice")
    invoice_guess = _invoice_cost_guess(invoice_file) if invoice_file and getattr(invoice_file, "filename", "") else {}
    if invoice_file and getattr(invoice_file, "filename", ""):
        try:
            invoice_url = save_uploaded_doc(invoice_file, MESSAGE_UPLOAD_DIR, "uploads/messages")
            invoice_guess["url"] = invoice_url
        except ValueError:
            flash("Maintenance invoice must be a supported document/image under 10MB.", "error")
            return redirect(url_for("maintenance_schedule_step3"))
    cost_fields = _compute_cost_fields(request.form.get("cost_subtotal"), request.form.get("cost_apply_vat"), request.form.get("cost_vat_pct"), invoice_guess)
    session["pm_step3"] = dict(technician=technician, notes=notes, invoice=invoice_guess, **cost_fields)
    return redirect(url_for("maintenance_schedule_success"))


@app.get("/maintenance/schedule/success", endpoint="maintenance_schedule_success")
def maintenance_schedule_success_get():
    if not session.get("pm_step1") or not session.get("pm_step2"):
        return redirect(url_for("maintenance_schedule_step1"))

    ctx = base_ctx("maintenance")
    s1 = session.get("pm_step1") or {}
    s2 = session.get("pm_step2") or {}
    s3 = session.get("pm_step3") or {}

    asset = next((a for a in ASSETS if a.get("uid") == s1.get("asset_uid")), None)
    if not asset:
        return redirect(url_for("maintenance_schedule_step1"))

    due = s2.get("first_service_date") or ""
    st = "overdue" if is_overdue(due) else "upcoming"

    # 3.2 Copy department into maintenance payload
    payload = dict(
        task_id=next_pm_id(),
        created_at=datetime.now().isoformat(timespec="seconds"),
        created_by=base_ctx("maintenance")["current_user_name"],
        section=(asset.get("section") or "").strip(),
        asset_uid=asset.get("uid"),
        asset_name=asset.get("asset_name"),
        asset_id=asset.get("asset_id"),
        maintenance_type=s1.get("maintenance_type") or "PM",
        frequency=s2.get("frequency") or "Monthly",
        technician=s3.get("technician") or "",
        task_description=(s1.get("task_title") or "").strip() + "\n" + (s1.get("task_description") or "").strip(),
        due_date=due,
        status=st,
        priority=s2.get("priority") or "medium",
        notes=s3.get("notes") or "",
        completed_at=None,
        completion_notes=None,
        history=[],
        department=asset.get("department") or get_current_department(),
        cost_subtotal=s3.get("cost_subtotal"),
        cost_apply_vat=bool(s3.get("cost_apply_vat")),
        cost_vat_pct=s3.get("cost_vat_pct"),
        cost_vat_amount=s3.get("cost_vat_amount"),
        cost_total=s3.get("cost_total"),
        invoice=s3.get("invoice") or {},
    )

    # Deploy schedule into calendar by generating future occurrences
    due_dates = _generate_maintenance_due_dates(due, payload.get("frequency") or "Monthly")
    if not due_dates:
        due_dates = [due]

    schedule_group_id = uuid4().hex[:12]

    # Create one task per due date (keeps calendar truthful and usable)
    for i, dd in enumerate(reversed(due_dates)):
        p = dict(payload)
        p["task_id"] = next_pm_id()
        p["due_date"] = dd
        p["status"] = "overdue" if is_overdue(dd) else "upcoming"
        p["schedule_group_id"] = schedule_group_id
        p["schedule_anchor_date"] = due
        p["series_frequency"] = payload.get("frequency") or "Monthly"
        p["series_position"] = len(due_dates) - i
        p["cost_collected"] = False
        if dd != due:
            p["technician"] = ""
            p["cost_subtotal"] = None
            p["cost_apply_vat"] = False
            p["cost_vat_pct"] = None
            p["cost_vat_amount"] = None
            p["cost_total"] = None
            p["invoice"] = {}
        MAINTENANCE_TASKS.insert(0, p)

    # Use the first occurrence as the displayed confirmation
    payload = MAINTENANCE_TASKS[0]

    session.pop("pm_step1", None)
    session.pop("pm_step2", None)
    session.pop("pm_step3", None)

    push_notification("Maintenance scheduled", f"{payload.get('task_id') or 'Task'} was scheduled for {payload.get('asset_name') or 'an asset'}.", "success", href=url_for("maintenance_view", task_id=payload["task_id"]), module="maintenance")
    ctx["task"] = payload
    ctx["asset_photo_url"] = (asset.get("photo_url") or None)
    return render_template("maintenance/schedule_success.html", **ctx)


@app.get("/maintenance/<task_id>")
def maintenance_view(task_id):
    ctx = base_ctx("maintenance")
    t = next((x for x in MAINTENANCE_TASKS if x.get("task_id") == task_id), None)
    if not t:
        abort(404)

    ctx.update(task=enrich_pm_task(t))
    if (request.args.get("print") or "").lower() in ("1", "true", "yes"):
        return render_template("maintenance/view_task_print.html", **ctx)
    return render_template("maintenance/view_task.html", **ctx)


@app.get("/maintenance/work-order/<work_order_id>", endpoint="maintenance_work_order_view")
def maintenance_work_order_view(work_order_id):
    return maintenance_view(work_order_id)


@app.get("/maintenance/<task_id>/update")
def maintenance_update_get(task_id):
    ctx = base_ctx("maintenance")
    t = next((x for x in MAINTENANCE_TASKS if x.get("task_id") == task_id), None)
    if not t:
        abort(404)

    tech_rows = technician_workload_snapshot(get_current_department())
    ctx.update(task=t, error=None, technicians=[x.get("name") for x in tech_rows], tech_rows=tech_rows)
    return render_template("maintenance/update_task.html", **ctx)


@app.post("/maintenance/<task_id>/update")
def maintenance_update_post(task_id):
    t = next((x for x in MAINTENANCE_TASKS if x.get("task_id") == task_id), None)
    if not t:
        abort(404)

    status = normalize_pm_status(request.form.get("status") or t.get("status") or "upcoming")
    due_date = (request.form.get("due_date") or t.get("due_date") or "").strip()
    maintenance_type = (request.form.get("maintenance_type") or t.get("maintenance_type") or "PM").strip().upper()
    frequency = normalize_frequency(request.form.get("frequency") or t.get("frequency") or "Monthly")
    task_title = (request.form.get("task_title") or t.get("task_title") or "").strip()
    task_description = (request.form.get("task_description") or t.get("task_description") or "").strip()
    technician = (request.form.get("technician") or t.get("technician") or "").strip()
    priority = (request.form.get("priority") or t.get("priority") or "medium").strip().lower()
    notes = (request.form.get("notes") or "").strip()
    completed_at_raw = (request.form.get("completed_at") or t.get("completed_at") or "").strip()
    completion_notes = (request.form.get("completion_notes") or t.get("completion_notes") or "").strip()
    cost_collected = str(request.form.get("cost_collected") or "").strip().lower() in ("1", "true", "yes", "on")
    invoice_file = request.files.get("invoice")
    invoice_guess = dict(t.get("invoice") or {})
    if invoice_file and getattr(invoice_file, "filename", ""):
        invoice_guess = _invoice_cost_guess(invoice_file) if invoice_file else {}
        try:
            invoice_url = save_uploaded_doc(invoice_file, MESSAGE_UPLOAD_DIR, "uploads/messages")
            invoice_guess["url"] = invoice_url
        except ValueError:
            ctx = base_ctx("maintenance")
            tech_rows = technician_workload_snapshot(get_current_department())
            ctx.update(task=t, error="Maintenance invoice must be a supported document/image under 10MB.", technicians=[x.get("name") for x in tech_rows], tech_rows=tech_rows)
            return render_template("maintenance/update_task.html", **ctx), 400
    cost_fields = _compute_cost_fields(request.form.get("cost_subtotal"), request.form.get("cost_apply_vat"), request.form.get("cost_vat_pct"), invoice_guess)

    if due_date and not parse_date_only(due_date):
        ctx = base_ctx("maintenance")
        tech_rows = technician_workload_snapshot(get_current_department())
        ctx.update(task=t, error="Due date must be valid (YYYY-MM-DD).", technicians=[x.get("name") for x in tech_rows], tech_rows=tech_rows)
        return render_template("maintenance/update_task.html", **ctx), 400

    completed_at_dt = None
    if completed_at_raw:
        completed_at_dt = parse_iso_dt(completed_at_raw)
        if not completed_at_dt:
            try:
                completed_at_dt = datetime.strptime(completed_at_raw, "%Y-%m-%dT%H:%M")
            except Exception:
                completed_at_dt = None
        if not completed_at_dt:
            ctx = base_ctx("maintenance")
            tech_rows = technician_workload_snapshot(get_current_department())
            ctx.update(task=t, error="Completed date/time must be valid.", technicians=[x.get("name") for x in tech_rows], tech_rows=tech_rows)
            return render_template("maintenance/update_task.html", **ctx), 400

    if priority not in ("low", "medium", "high"):
        priority = "medium"
    if maintenance_type not in ("PM", "CM"):
        maintenance_type = (t.get("maintenance_type") or "PM").strip().upper() or "PM"

    history_row = dict(
        ts=datetime.now().isoformat(timespec="seconds"),
        action="update",
        status=status,
        due_date=due_date,
        priority=priority,
        notes=notes,
        technician=technician,
        frequency=frequency,
        maintenance_type=maintenance_type,
        cost_total=cost_fields.get("cost_total"),
        cost_collected=cost_collected,
    )
    t.setdefault("history", [])
    t["history"].insert(0, history_row)

    t["status"] = status
    t["due_date"] = due_date
    t["maintenance_type"] = maintenance_type
    t["frequency"] = frequency
    t["series_frequency"] = frequency
    t["task_title"] = task_title
    t["task_description"] = task_description
    t["technician"] = technician
    t["priority"] = priority
    t["notes"] = notes
    t["completion_notes"] = completion_notes
    t["cost_collected"] = cost_collected
    t["invoice"] = invoice_guess
    t.update(cost_fields)

    if status == "completed":
        t["completed_at"] = (completed_at_dt or datetime.now()).isoformat(timespec="seconds")
    elif not completed_at_raw:
        t["completed_at"] = None

    push_notification("Maintenance updated", f"{t.get('task_id') or 'Task'} was updated.", "info", href=url_for("maintenance_view", task_id=task_id), module="maintenance")
    return redirect(url_for("maintenance_view", task_id=task_id))


@app.post("/maintenance/<task_id>/complete")
def maintenance_complete(task_id):
    t = next((x for x in MAINTENANCE_TASKS if x.get("task_id") == task_id), None)
    if not t:
        abort(404)

    completion_notes = (request.form.get("completion_notes") or "").strip()
    completed_dt = datetime.now()
    due_dt = _coerce_date(t.get("due_date") or "")
    overdue_days = max(0, (completed_dt.date() - due_dt).days) if due_dt else 0

    t["status"] = "completed"
    t["completed_at"] = completed_dt.isoformat(timespec="seconds")
    t["completion_notes"] = completion_notes
    t["completed_overdue"] = overdue_days > 0
    t["completed_delay_days"] = overdue_days
    t["cost_collected"] = str(request.form.get("cost_collected") or t.get("cost_collected") or "").strip().lower() in ("1", "true", "yes", "on")

    t.setdefault("history", [])
    t["history"].insert(0, dict(ts=t["completed_at"], action="complete", completion_notes=completion_notes, completed_overdue=(overdue_days > 0), completed_delay_days=overdue_days))

    _shift_future_schedule_after_completion(t, completed_dt)
    push_notification("Maintenance completed", f"{t.get('task_id') or 'Task'} was closed{' overdue' if overdue_days > 0 else ''}.", "success", href=url_for("maintenance_view", task_id=task_id), module="maintenance")

    next_url = request.form.get("next") or url_for("maintenance_view", task_id=task_id)
    return redirect(next_url)


@app.post("/maintenance/<task_id>/delete")
def maintenance_delete(task_id):
    task = next((x for x in MAINTENANCE_TASKS if x.get("task_id") == task_id), None)
    if not task:
        abort(404)
    series_key = _maintenance_series_key(task)
    remaining = []
    removed = []
    for row in MAINTENANCE_TASKS:
        if _maintenance_series_key(row) == series_key:
            removed.append(row)
        else:
            remaining.append(row)
    if not removed:
        abort(404)
    MAINTENANCE_TASKS[:] = remaining
    push_notification("Maintenance deleted", f"{removed[0].get('task_id') or 'Task'} schedule was deleted ({len(removed)} record(s)).", "warning", href=url_for("maintenance_management"), module="maintenance")
    next_url = request.form.get("next") or url_for("maintenance_management")
    return redirect(next_url)


@app.get("/maintenance/calendar", endpoint="maintenance_calendar")
def maintenance_calendar():
    ctx = base_ctx("maintenance")
    dept = get_current_department()

    q = (request.args.get("q") or "").strip()
    view = (request.args.get("view") or "month").strip().lower()
    view = view if view in ("month", "list") else "month"

    now = datetime.now()
    try:
        year = int(request.args.get("year") or now.year)
    except ValueError:
        year = now.year
    try:
        month = int(request.args.get("month") or now.month)
    except ValueError:
        month = now.month
    month = max(1, min(12, month))

    selected_iso = (request.args.get("selected") or "").strip()
    if not selected_iso:
        selected_iso = f"{year:04d}-{month:02d}-{now.day:02d}"

    selected_dt = parse_date_only(selected_iso)
    if not selected_dt:
        selected_dt = datetime(year, month, 1)
        selected_iso = selected_dt.strftime("%Y-%m-%d")

    first_of_month = datetime(year, month, 1)
    prev_month_dt = first_of_month - timedelta(days=1)
    next_month_dt = (first_of_month.replace(day=28) + timedelta(days=4)).replace(day=1)

    prev_year, prev_month = prev_month_dt.year, prev_month_dt.month
    next_year, next_month = next_month_dt.year, next_month_dt.month

    month_label = first_of_month.strftime("%B %Y")

    all_items = [enrich_pm_task(t) for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]

    def in_month(t):
        dd = parse_date_only(t.get("due_date") or "")
        return dd and dd.year == year and dd.month == month

    month_items = [t for t in all_items if in_month(t)]
    selected_section = (request.args.get("section") or "").strip()
    selected_asset_uid = (request.args.get("asset_uid") or "").strip()
    if selected_section:
        month_items = [t for t in month_items if _norm_str(t.get("section")) == _norm_str(selected_section)]
    if selected_asset_uid:
        month_items = [t for t in month_items if _norm_str(t.get("asset_uid")) == _norm_str(selected_asset_uid)]

    if q:
        ql = q.lower()
        month_items = [
            t for t in month_items
            if ql in (t.get("asset_name") or "").lower()
            or ql in (t.get("asset_id") or "").lower()
            or ql in (t.get("task_title") or "").lower()
            or ql in (t.get("technician") or "").lower()
        ]

    by_date = {}
    for t in month_items:
        d = (t.get("due_date") or "").strip()
        if not d:
            continue
        by_date.setdefault(d, []).append(t)

    selected_tasks = by_date.get(selected_iso, [])
    selected_label = selected_dt.strftime("%b %d, %Y")

    cal = pycalendar.Calendar(firstweekday=6)  # Sunday
    dates = list(cal.itermonthdates(year, month))
    calendar_cells = []

    for dt in dates:
        iso = dt.strftime("%Y-%m-%d")
        tasks = by_date.get(iso, [])

        badges = []
        overdue_count = 0
        for t in tasks:
            kind = "upcoming"
            if t.get("status") == "completed":
                kind = "completed"
            elif t.get("status") == "overdue":
                kind = "overdue"
                overdue_count += 1

            label = t.get("task_title") or t.get("asset_name") or "Task"
            badges.append({"kind": kind, "label": label})

        calendar_cells.append(
            dict(
                day=dt.day,
                iso=iso,
                in_month=(dt.month == month),
                badges=badges[:2],
                more_count=max(0, len(badges) - 2),
                count_overdue=overdue_count,
            )
        )

    list_items = sorted(month_items, key=lambda x: (x.get("due_date") or "9999-12-31", x.get("asset_name") or ""))
    month_start = first_of_month.date().isoformat()
    month_end = next_month_dt.date().isoformat()
    machine_map: dict[str, dict] = {}
    for t in list_items:
        key = (t.get("asset_uid") or t.get("asset_id") or t.get("asset_name") or uuid4().hex)
        row = machine_map.setdefault(key, {
            "asset_uid": t.get("asset_uid") or "",
            "asset_name": t.get("asset_name") or "Machine",
            "asset_id": t.get("asset_id") or "—",
            "section": t.get("section") or "—",
            "frequencies": set(),
            "task_titles": [],
            "technicians": set(),
            "count": 0,
        })
        if (t.get("frequency") or "").strip():
            row["frequencies"].add((t.get("frequency") or "").strip())
        if (t.get("technician") or "").strip():
            row["technicians"].add((t.get("technician") or "").strip())
        if (t.get("task_title") or "").strip() and len(row["task_titles"]) < 3:
            row["task_titles"].append((t.get("task_title") or "").strip())
        row["count"] += 1
    monthly_machine_summary = []
    for row in machine_map.values():
        row["frequencies"] = ", ".join(sorted(row["frequencies"])) or "—"
        row["technicians"] = ", ".join(sorted(row["technicians"])) or "Unassigned"
        monthly_machine_summary.append(row)
    monthly_machine_summary = sorted(monthly_machine_summary, key=lambda r: (r.get("asset_name") or "").lower())

    ctx.update(
        year=year,
        month=month,
        month_label=month_label,
        prev_year=prev_year,
        prev_month=prev_month,
        next_year=next_year,
        next_month=next_month,
        view=view,
        q=q,
        selected_iso=selected_iso,
        selected_label=selected_label,
        selected_tasks=selected_tasks,
        calendar_cells=calendar_cells,
        list_items=list_items,
        monthly_machine_summary=monthly_machine_summary,
        month_start=month_start,
        month_end=month_end,
        sections=distinct_sections_from_assets(department=dept),
        selected_section=selected_section,
        selected_asset_uid=selected_asset_uid,
    )
    return render_template("maintenance/maintenance_calendar.html", **ctx)




@app.get("/maintenance/schedule/print", endpoint="maintenance_schedule_print")
def maintenance_schedule_print():
    """Printable schedule summary for one machine or all machines with monthly spread + detailed register."""
    ctx = base_ctx("maintenance")
    dept = get_current_department()

    asset_uid = (request.args.get("asset_uid") or "").strip()
    section = (request.args.get("section") or "").strip()
    year = request.args.get("year", default=datetime.now().year, type=int)
    q = (request.args.get("q") or "").strip().lower()
    period_from_raw = (request.args.get("period_from") or "").strip()
    period_to_raw = (request.args.get("period_to") or "").strip()
    status_filter = (request.args.get("status") or "all").strip().lower()
    if status_filter not in ("all", "upcoming", "overdue", "completed"):
        status_filter = "all"

    assets = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]
    tasks = [t for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]

    if section:
        assets = [a for a in assets if _norm_str(a.get("section")) == _norm_str(section)]
    if asset_uid:
        assets = [a for a in assets if _norm_str(a.get("uid")) == _norm_str(asset_uid)]
    if q:
        assets = [a for a in assets if q in " ".join([str(a.get("asset_name") or ""), str(a.get("asset_id") or ""), str(a.get("section") or "")]).lower()]

    uidset, nameset = _asset_scope_sets(assets)
    tasks = _filter_records_by_asset_scope(tasks, uidset, nameset) if assets else []
    enriched_tasks = [enrich_pm_task(t) for t in tasks]

    default_period_from = date(year, 1, 1)
    default_period_to = date(year, 12, 31)
    period_from = parse_date_only(period_from_raw) or default_period_from
    period_to = parse_date_only(period_to_raw) or default_period_to
    if period_to < period_from:
        period_from, period_to = period_to, period_from

    month_keys = [f"{year}-{m:02d}" for m in range(1, 13)]
    month_labels = [datetime(year, m, 1).strftime("%b").upper() for m in range(1, 13)]
    rows = []
    for a in sorted(assets, key=lambda r: (r.get("asset_name") or "").lower()):
        uid = a.get("uid")
        nm = a.get("asset_name") or a.get("name") or "Machine"
        aid = a.get("asset_id") or a.get("asset_code") or ""
        serial = a.get("serial_number") or a.get("serial") or a.get("serial_no") or ""
        atasks = [t for t in enriched_tasks if _norm_str(t.get("asset_uid")) == _norm_str(uid) or _norm_str(t.get("asset_name")) == _norm_str(nm)]
        pm_freq = sorted({(t.get("frequency") or "").strip() for t in atasks if (t.get("maintenance_type") or "PM") == "PM" and (t.get("frequency") or "").strip()})
        cm_freq = sorted({(t.get("frequency") or "").strip() for t in atasks if (t.get("maintenance_type") or "PM") == "CM" and (t.get("frequency") or "").strip()})
        month_counts = {k: 0 for k in month_keys}
        month_details = {k: [] for k in month_keys}
        for t in atasks:
            due = parse_date_only(t.get("due_date") or "")
            if not due or due.year != year:
                continue
            k = due.strftime("%Y-%m")
            month_counts[k] = month_counts.get(k, 0) + 1
            month_details[k].append({
                "title": t.get("task_title") or t.get("task_description") or "Task",
                "frequency": t.get("frequency") or "—",
                "type": t.get("maintenance_type") or "PM",
                "status": t.get("status") or "upcoming",
                "due_date": due.strftime("%Y-%m-%d"),
            })
        rows.append({
            "asset_uid": uid or "",
            "asset_name": nm,
            "asset_id": aid,
            "serial": serial,
            "section": a.get("section") or "—",
            "pm_frequency": ", ".join(pm_freq) if pm_freq else "—",
            "cm_frequency": ", ".join(cm_freq) if cm_freq else "—",
            "month_counts": month_counts,
            "month_details": month_details,
        })

    detail_rows = []
    for t in enriched_tasks:
        due = parse_date_only(t.get("due_date") or "")
        if not due:
            continue
        if due < period_from or due > period_to:
            continue
        task_status = (t.get("status") or "").strip().lower()
        if status_filter != "all" and task_status != status_filter:
            continue
        detail_rows.append({
            "due_date": due.strftime("%Y-%m-%d"),
            "asset_name": t.get("asset_name") or "—",
            "asset_id": t.get("asset_id") or "—",
            "section": t.get("section") or "—",
            "task_title": t.get("task_title") or t.get("task_description") or "Task",
            "maintenance_type": t.get("maintenance_type") or "PM",
            "frequency": t.get("frequency") or "—",
            "technician": t.get("technician") or "Unassigned",
            "status": task_status or "upcoming",
            "completed_at": t.get("completed_at") or "—",
            "cost_total": round(_safe_float(t.get("cost_total"), 0.0) or 0.0, 2),
        })
    detail_rows.sort(key=lambda r: (r.get("due_date") or "9999-12-31", r.get("asset_name") or "", r.get("task_title") or ""))

    status_counts = {
        "all": len(detail_rows),
        "upcoming": sum(1 for r in detail_rows if r.get("status") == "upcoming"),
        "overdue": sum(1 for r in detail_rows if r.get("status") == "overdue"),
        "completed": sum(1 for r in detail_rows if r.get("status") == "completed"),
    }

    selected_machine_name = next((r.get("asset_name") for r in rows if _norm_str(r.get("asset_uid")) == _norm_str(asset_uid)), "") if asset_uid else ""
    ctx.update(
        rows=rows,
        asset_uid=asset_uid,
        selected_section=section,
        selected_year=year,
        month_labels=month_labels,
        month_keys=month_keys,
        sections=distinct_sections_from_assets(department=dept),
        print_title=f"Maintenance Machine Schedule • {year}",
        report_scope_label="Maintenance Schedule",
        report_scope_target=(selected_machine_name or section or (rows[0]["asset_name"] if len(rows)==1 else dept)),
        report_period=f"{period_from.strftime('%d %b %Y')} - {period_to.strftime('%d %b %Y')}",
        report_creator=base_ctx("maintenance")["current_user_name"],
        period_from=period_from.isoformat(),
        period_to=period_to.isoformat(),
        selected_status=status_filter,
        detail_rows=detail_rows,
        detail_status_counts=status_counts,
    )
    return render_template("maintenance/maintenance_schedule_print.html", **ctx)

# -------------------------
# INVENTORY
# -------------------------
@app.get("/inventory", endpoint="inventory_management")
def inventory_management():
    ctx = base_ctx("inventory")
    dept = get_current_department()

    q = (request.args.get("q") or "").strip()
    category = (request.args.get("category") or "").strip()
    stock_state = (request.args.get("stock_state") or "").strip()

    try:
        per_page = int(request.args.get("per_page") or 10)
    except ValueError:
        per_page = 10
    per_page = per_page if per_page in (5, 10, 20, 50) else 10

    try:
        page = int(request.args.get("page") or 1)
    except ValueError:
        page = 1
    page = max(page, 1)

    parts = [p for p in INVENTORY_PARTS if (p.get("department") or "Engineering") == dept]
    categories = sorted({(p.get("category") or "Uncategorized").strip() for p in parts if (p.get("category") or "").strip()})

    if q:
        ql = q.lower()
        def match(p):
            return (
                ql in (p.get("part_name") or "").lower()
                or ql in (p.get("sku") or "").lower()
                or ql in (p.get("category") or "").lower()
                or ql in (p.get("supplier") or "").lower()
                or ql in (p.get("manufacturer") or "").lower()
                or ql in (p.get("storage_location") or "").lower()
            )
        parts = [p for p in parts if match(p)]

    if category:
        parts = [p for p in parts if (p.get("category") or "") == category]
    if stock_state in ("healthy", "low_stock", "out_of_stock"):
        parts = [p for p in parts if inventory_stock_state(p) == stock_state]

    parts_sorted = sorted(parts, key=lambda x: (x.get("part_name") or "").lower())
    total_unique_skus = len(parts_sorted)
    critical_spares = sum(1 for p in parts_sorted if p.get("is_critical") is True)
    low_stock_alerts = sum(1 for p in parts_sorted if inventory_stock_state(p) == "low_stock")
    out_of_stock = sum(1 for p in parts_sorted if inventory_stock_state(p) == "out_of_stock")
    total_inventory_value = sum(float(p.get("qty") or 0) * float(p.get("unit_price") or 0) for p in parts_sorted)

    healthy = max(0, total_unique_skus - low_stock_alerts - out_of_stock)
    total_for_pct = max(1, total_unique_skus)
    donut = dict(
        healthy=healthy,
        low=low_stock_alerts,
        out=out_of_stock,
        healthy_pct=int(round((healthy / total_for_pct) * 100)),
        low_pct=int(round((low_stock_alerts / total_for_pct) * 100)),
        out_pct=max(0, 100 - int(round((healthy / total_for_pct) * 100)) - int(round((low_stock_alerts / total_for_pct) * 100))),
    )

    urgent = []
    for p in parts_sorted:
        qty = int(p.get("qty") or 0)
        minq = int(p.get("min_qty") or 0)
        if qty <= 0:
            reason = "Immediate reorder needed to prevent downtime risk."
        elif minq > 0 and qty <= minq:
            reason = "Below minimum threshold. Reorder before consumption triggers stockout."
        else:
            continue
        u = dict(p)
        u["urgent_reason"] = reason
        urgent.append(u)

    def urgent_rank(p):
        qty = int(p.get("qty") or 0)
        critical = 1 if p.get("is_critical") else 0
        lead = int(p.get("lead_time_days") or 0)
        return (0 if qty <= 0 else 1, -critical, -lead)

    urgent.sort(key=urgent_rank)
    urgent = urgent[:6]
    urgent_count = len(urgent)

    total = len(parts_sorted)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = min(page, total_pages)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = parts_sorted[start:end]
    showing_from = 0 if total == 0 else start + 1
    showing_to = min(end, total)

    ctx.update(
        total_unique_skus=total_unique_skus,
        critical_spares=critical_spares,
        low_stock_alerts=low_stock_alerts,
        out_of_stock=out_of_stock,
        total_inventory_value=total_inventory_value,
        donut=donut,
        urgent=urgent,
        urgent_count=urgent_count,
        parts=page_items,
        categories=categories,
        q=q,
        selected_category=category,
        selected_stock_state=stock_state,
        total=total,
        per_page=per_page,
        page=page,
        total_pages=total_pages,
        showing_from=showing_from,
        showing_to=showing_to,
        pages=build_pagination(page, total_pages),
    )
    return render_template("inventory/inventory_management.html", **ctx)


@app.get("/inventory/export/<fmt>")
def inventory_export(fmt):
    dept = get_current_department()
    q = (request.args.get("q") or "").strip()
    category = (request.args.get("category") or "").strip()
    stock_state = (request.args.get("stock_state") or "").strip()

    parts = [p for p in INVENTORY_PARTS if (p.get("department") or "Engineering") == dept]
    if q:
        ql = q.lower()
        parts = [
            p for p in parts
            if ql in (p.get("part_name") or "").lower()
            or ql in (p.get("sku") or "").lower()
            or ql in (p.get("category") or "").lower()
            or ql in (p.get("supplier") or "").lower()
            or ql in (p.get("manufacturer") or "").lower()
            or ql in (p.get("storage_location") or "").lower()
        ]
    if category:
        parts = [p for p in parts if (p.get("category") or "") == category]
    if stock_state in ("healthy", "low_stock", "out_of_stock"):
        parts = [p for p in parts if inventory_stock_state(p) == stock_state]

    rows = []
    for p in sorted(parts, key=lambda x: (x.get("part_name") or "").lower()):
        linked_assets = [a.get("asset_name") for a in ASSETS if _part_linked_to_asset(p, a)]
        rows.append({
            "sku": p.get("sku") or "",
            "part_name": p.get("part_name") or "",
            "category": p.get("category") or "",
            "qty": p.get("qty") or 0,
            "min_qty": p.get("min_qty") or 0,
            "unit_price": p.get("unit_price") or 0,
            "lead_time_days": p.get("lead_time_days") or "",
            "status": inventory_stock_state(p).replace("_", " ").title(),
            "supplier": p.get("supplier") or p.get("vendor") or "",
            "storage_location": p.get("storage_location") or "",
            "linked_assets": ", ".join(linked_assets),
        })

    return export_rows_file(
        fmt,
        "inventory_master_list",
        "Inventory Master List",
        [
            ("SKU", "sku"),
            ("Part Name", "part_name"),
            ("Category", "category"),
            ("Qty", "qty"),
            ("Min Qty", "min_qty"),
            ("Unit Price", "unit_price"),
            ("Lead Time (Days)", "lead_time_days"),
            ("Stock Status", "status"),
            ("Supplier", "supplier"),
            ("Storage", "storage_location"),
            ("Linked Assets", "linked_assets"),
        ],
        rows,
    )


@app.get("/inventory/<part_uid>")
def inventory_part_view(part_uid):
    ctx = base_ctx("inventory")
    part = next((p for p in INVENTORY_PARTS if str(p.get("uid") or p.get("id") or "") == part_uid), None)
    if not part:
        abort(404)

    linked_assets = [a for a in ASSETS if _part_linked_to_asset(part, a)]
    qty = int(part.get("qty") or 0)
    min_qty = int(part.get("min_qty") or 0)
    target_qty = int(part.get("target_qty") or 0) or max(min_qty * 2 if min_qty > 0 else 0, qty, 1)
    pct = max(0, min(100, int(round((qty / target_qty) * 100)))) if target_qty else 0

    asset_uid = (request.args.get("asset_uid") or "").strip()
    source_asset = next((a for a in ASSETS if a.get("uid") == asset_uid), None) if asset_uid else None

    ctx.update(
        part=part,
        linked_assets=linked_assets,
        source_asset=source_asset,
        stock_state=inventory_stock_state(part),
        stock_percent=pct,
        min_qty=min_qty,
        target_qty=target_qty,
    )
    if (request.args.get("print") or "").lower() in ("1", "true", "yes"):
        return render_template("inventory/part_print.html", **ctx)
    return render_template("inventory/part_view.html", **ctx)


# -------------------------
# INVENTORY: ADD NEW PART (STEP 1/2/3)
# -------------------------
def _safe_int(v: str, default: int | None = None) -> int | None:
    try:
        if v is None:
            return default
        s = str(v).strip()
        if s == "":
            return default
        return int(s)
    except Exception:
        return default


def _safe_float(v: str, default: float | None = None) -> float | None:
    try:
        if v is None:
            return default
        s = str(v).strip()
        if s == "":
            return default
        return float(s)
    except Exception:
        return default


@app.get("/inventory/new/step-1")
def inventory_add_step1_get():
    ctx = base_ctx("inventory")
    saved = session.get("inv_step1", {}) or {}

    if isinstance(saved.get("compatible_assets"), str):
        saved["compatible_assets"] = [saved["compatible_assets"]]

    fixed_asset_uid = (request.args.get("asset_uid") or saved.get("fixed_asset_uid") or "").strip()
    fixed_asset = next((a for a in ASSETS if a.get("uid") == fixed_asset_uid), None) if fixed_asset_uid else None
    if fixed_asset:
        saved["fixed_asset_uid"] = fixed_asset_uid
        saved["compatible_assets"] = [fixed_asset_uid]
    ctx.update(
        form=saved,
        error=None,
        categories=INVENTORY_CATEGORIES,
        assets=[{"uid": a.get("uid"), "asset_name": a.get("asset_name"), "asset_id": a.get("asset_id")} for a in ASSETS],
        fixed_asset=fixed_asset,
    )
    return render_template("inventory/parts_add_step1.html", **ctx)


@app.post("/inventory/new/step-1")
def inventory_add_step1_post():
    part_name = (request.form.get("part_name") or "").strip()
    sku = (request.form.get("sku") or "").strip()
    category = (request.form.get("category") or "").strip()
    fixed_asset_uid = (request.form.get("fixed_asset_uid") or "").strip()
    compatible_assets = [fixed_asset_uid] if fixed_asset_uid else request.form.getlist("compatible_assets")

    form = dict(
        part_name=part_name,
        sku=sku,
        category=category,
        compatible_assets=compatible_assets,
        fixed_asset_uid=fixed_asset_uid,
    )

    if not part_name or not sku or not category:
        ctx = base_ctx("inventory")
        ctx.update(
            form=form,
            error="Part Name, SKU, and Category are required.",
            categories=INVENTORY_CATEGORIES,
            assets=[{"uid": a.get("uid"), "asset_name": a.get("asset_name"), "asset_id": a.get("asset_id")} for a in ASSETS],
            fixed_asset=next((a for a in ASSETS if a.get("uid") == fixed_asset_uid), None) if fixed_asset_uid else None,
        )
        return render_template("inventory/parts_add_step1.html", **ctx), 400

    sku_l = sku.lower()
    if any((p.get("sku") or "").lower() == sku_l for p in INVENTORY_PARTS):
        ctx = base_ctx("inventory")
        ctx.update(
            form=form,
            error="That SKU already exists. Use a unique SKU.",
            categories=INVENTORY_CATEGORIES,
            assets=[{"uid": a.get("uid"), "asset_name": a.get("asset_name"), "asset_id": a.get("asset_id")} for a in ASSETS],
            fixed_asset=next((a for a in ASSETS if a.get("uid") == fixed_asset_uid), None) if fixed_asset_uid else None,
        )
        return render_template("inventory/parts_add_step1.html", **ctx), 400

    session["inv_step1"] = form
    return redirect(url_for("inventory_add_step2_get"))


@app.get("/inventory/new/step-2")
def inventory_add_step2_get():
    if not session.get("inv_step1"):
        return redirect(url_for("inventory_add_step1_get"))

    ctx = base_ctx("inventory")
    form = session.get("inv_step2", {}) or {}
    ctx.update(form=form, error=None)
    return render_template("inventory/parts_add_step2.html", **ctx)


@app.post("/inventory/new/step-2")
def inventory_add_step2_post():
    if not session.get("inv_step1"):
        return redirect(url_for("inventory_add_step1_get"))

    qty = _safe_int(request.form.get("qty"), None)
    min_qty = _safe_int(request.form.get("min_qty"), None)
    storage_location = (request.form.get("storage_location") or "").strip()

    unit_price = _safe_float(request.form.get("unit_price"), None)
    supplier = (request.form.get("supplier") or "").strip()
    lead_time_days = _safe_int(request.form.get("lead_time_days"), None)

    is_critical = (request.form.get("is_critical") or "").strip().lower() == "on"

    form = dict(
        qty=qty,
        min_qty=min_qty,
        storage_location=storage_location,
        unit_price=unit_price,
        supplier=supplier,
        lead_time_days=lead_time_days,
        is_critical=is_critical,
    )

    if qty is None or qty < 0:
        ctx = base_ctx("inventory")
        ctx.update(form=form, error="Current stock level must be a valid number (0 or more).")
        return render_template("inventory/parts_add_step2.html", **ctx), 400

    if min_qty is None or min_qty < 0:
        ctx = base_ctx("inventory")
        ctx.update(form=form, error="Minimum stock level must be a valid number (0 or more).")
        return render_template("inventory/parts_add_step2.html", **ctx), 400

    if not storage_location:
        ctx = base_ctx("inventory")
        ctx.update(form=form, error="Storage location is required.")
        return render_template("inventory/parts_add_step2.html", **ctx), 400

    if unit_price is None or unit_price < 0:
        ctx = base_ctx("inventory")
        ctx.update(form=form, error="Unit price/cost must be a valid number (0 or more).")
        return render_template("inventory/parts_add_step2.html", **ctx), 400

    if not supplier:
        ctx = base_ctx("inventory")
        ctx.update(form=form, error="Preferred supplier is required.")
        return render_template("inventory/parts_add_step2.html", **ctx), 400

    session["inv_step2"] = form
    return redirect(url_for("inventory_add_step3_get"))


@app.get("/inventory/new/step-3")
def inventory_add_step3_get():
    if not session.get("inv_step1") or not session.get("inv_step2"):
        return redirect(url_for("inventory_add_step1_get"))

    ctx = base_ctx("inventory")
    form = session.get("inv_step3", {}) or {}
    ctx.update(form=form, error=None)
    return render_template("inventory/parts_add_step3.html", **ctx)


@app.post("/inventory/new/step-3")
def inventory_add_step3_post():
    if not session.get("inv_step1") or not session.get("inv_step2"):
        return redirect(url_for("inventory_add_step1_get"))

    manufacturer = (request.form.get("manufacturer") or "").strip()
    model_number = (request.form.get("model_number") or "").strip()
    tech_specs = (request.form.get("tech_specs") or "").strip()

    previous = session.get("inv_step3", {}) or {}
    photo_url = previous.get("photo_url")
    doc_url = previous.get("doc_url")

    if not manufacturer or not model_number or not tech_specs:
        ctx = base_ctx("inventory")
        ctx.update(
            form=dict(**previous, manufacturer=manufacturer, model_number=model_number, tech_specs=tech_specs),
            error="Manufacturer, Model Number, and Technical Specifications are required.",
        )
        return render_template("inventory/parts_add_step3.html", **ctx), 400

    photo = request.files.get("part_photo")
    if photo and photo.filename:
        try:
            photo_url = save_uploaded_image(photo, INVENTORY_UPLOAD_DIR, "uploads/parts")
        except ValueError as e:
            ctx = base_ctx("inventory")
            ctx.update(
                form=dict(**previous, manufacturer=manufacturer, model_number=model_number, tech_specs=tech_specs, photo_url=photo_url, doc_url=doc_url),
                error=str(e) if str(e) else "Invalid photo upload.",
            )
            return render_template("inventory/parts_add_step3.html", **ctx), 400

    doc = request.files.get("part_doc")
    if doc and doc.filename:
        try:
            doc_url = save_uploaded_doc(doc, INVENTORY_DOC_UPLOAD_DIR, "uploads/part_docs")
        except ValueError as e:
            ctx = base_ctx("inventory")
            ctx.update(
                form=dict(**previous, manufacturer=manufacturer, model_number=model_number, tech_specs=tech_specs, photo_url=photo_url, doc_url=doc_url),
                error=str(e) if str(e) else "Invalid document upload.",
            )
            return render_template("inventory/parts_add_step3.html", **ctx), 400

    s1 = session.get("inv_step1") or {}
    s2 = session.get("inv_step2") or {}

    payload = dict(
        uid=uuid4().hex,
        created_at=datetime.now().isoformat(timespec="seconds"),

        part_name=s1.get("part_name"),
        sku=s1.get("sku"),
        category=s1.get("category"),
        compatible_assets=s1.get("compatible_assets") or [],

        qty=s2.get("qty") or 0,
        min_qty=s2.get("min_qty") or 0,
        storage_location=s2.get("storage_location"),
        unit_price=s2.get("unit_price") or 0.0,
        supplier=s2.get("supplier"),
        lead_time_days=s2.get("lead_time_days"),
        is_critical=bool(s2.get("is_critical")),

        manufacturer=manufacturer,
        model_number=model_number,
        tech_specs=tech_specs,
        photo_url=photo_url,
        doc_url=doc_url,
    )

    INVENTORY_PARTS.insert(0, payload)
    _sync_inventory_part_links_to_spares(payload)
    push_notification("Inventory part added", f"{payload.get('part_name') or 'Part'} was added to inventory.", "success", href=url_for("inventory_part_view", part_uid=payload["uid"]), module="inventory")

    fixed_asset_uid = (s1.get("fixed_asset_uid") or "").strip()

    session.pop("inv_step1", None)
    session.pop("inv_step2", None)
    session.pop("inv_step3", None)

    if fixed_asset_uid:
        return redirect(url_for("assets_spare_parts_get", asset_uid=fixed_asset_uid))
    return redirect(url_for("inventory_management"))


# -------------------------
# 3.4 /dashboard renders a real template
# -------------------------
@app.get("/dashboard")
def dashboard():
    ctx = base_ctx("dashboard")
    dept = get_current_department()
    intel = compute_dashboard_intelligence(dept)
    ctx.update(intel)

    dashboard_tpl = "dashboard/executive_dashboard.html"
    if not os.path.exists(os.path.join(app.template_folder or "templates", dashboard_tpl)):
        dashboard_tpl = "dashboard.html"
    return render_template(dashboard_tpl, **ctx)

@app.get("/dashboard/strategic-export")
def dashboard_strategic_export():
    dept = get_current_department()
    today = date.today()
    mode = (request.args.get("range") or "mtd").strip().lower()
    year_raw = (request.args.get("year") or "").strip()
    quarter_raw = (request.args.get("quarter") or "").strip()
    from_raw = (request.args.get("from") or "").strip()
    to_raw = (request.args.get("to") or "").strip()

    try:
        year_i = int(year_raw) if year_raw else today.year
    except Exception:
        year_i = today.year
    try:
        quarter_i = int(quarter_raw) if quarter_raw else ((today.month - 1) // 3 + 1)
    except Exception:
        quarter_i = ((today.month - 1) // 3 + 1)

    if mode == "year":
        start_d = date(year_i, 1, 1)
        end_d = date(year_i, 12, 31)
    elif mode == "ytd":
        start_d = date(year_i, 1, 1)
        end_d = today if year_i == today.year else date(year_i, 12, 31)
    elif mode == "qtr":
        quarter_i = max(1, min(4, quarter_i))
        start_month = (quarter_i - 1) * 3 + 1
        start_d = date(year_i, start_month, 1)
        if quarter_i == 4:
            end_d = date(year_i, 12, 31)
        else:
            end_d = date(year_i, start_month + 3, 1) - timedelta(days=1)
    elif mode == "90d":
        end_d = today
        start_d = end_d - timedelta(days=89)
    elif mode == "custom":
        start_d = parse_date_only(from_raw) or today.replace(day=1)
        end_d = parse_date_only(to_raw) or today
        if end_d < start_d:
            start_d, end_d = end_d, start_d
    else:
        end_d = today
        start_d = today.replace(day=1)
        mode = "mtd"

    rid = uuid4().hex
    label = _range_label_from_dates(start_d.isoformat(), end_d.isoformat())
    record = {
        "id": rid,
        "name": f"Executive Strategic Dashboard • {label}",
        "report_title": f"Executive Strategic Dashboard • {label}",
        "category": "Strategic ROI",
        "category_key": "strategic_roi",
        "department": dept,
        "scope_mode": "department",
        "scope_target": dept,
        "generated_for": dept,
        "start_date": start_d.isoformat(),
        "end_date": end_d.isoformat(),
        "metrics": ["value_realized", "roi_multiplier", "life_extension", "breakeven"],
        "metric_labels": [metric_label(m, "strategic_roi") for m in ["value_realized", "roi_multiplier", "life_extension", "breakeven"]],
        "format": "pdf",
        "status": "READY",
        "generated_label": datetime.now().strftime("%d %b %Y %H:%M"),
        "user_name": base_ctx("reports")["current_user_name"],
        "filename": f"executive_strategic_dashboard_{start_d.isoformat()}_{end_d.isoformat()}.pdf",
    }
    REPORT_EXPORTS.insert(0, record)
    return redirect(url_for("reports_generate_success_get", rid=rid))

@app.template_filter("kes0")
def kes0(v):
    try:
        n = float(v or 0)
    except Exception:
        n = 0.0
    return f"KES {n:,.0f}"

@app.template_filter("kes2")
def kes2(v):
    try:
        n = float(v or 0)
    except Exception:
        n = 0.0
    return f"KES {n:,.2f}"



# -------------------------
# REPORTS
# -------------------------

@app.get("/api/live/breakdowns/kpis")
def api_live_breakdowns_kpis():
    dept = get_current_department()
    k = compute_kpi_trends(department=dept)
    return jsonify({
        "active": int(k.get("active") or 0),
        "active_delta": int(k.get("active_delta") or 0),
        "mttr_hours": round(float(k.get("mttr_hours") or 0.0), 1),
        "mttr_trend": round(float(k.get("mttr_trend") or 0.0), 1),
        "downtime_mtd_hours": round(float(k.get("downtime_mtd_hours") or 0.0), 1),
        "uptime_rate": round(float(compute_uptime_rate(department=dept) or 0.0), 1),
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    })


@app.get("/api/live/reports/kpis")
def api_live_reports_kpis():
    dept = get_current_department()
    return jsonify(compute_reports_center_kpis(dept))


@app.get("/api/live/dashboard/kpis")
def api_live_dashboard_kpis():
    dept = get_current_department()
    intel = compute_dashboard_intelligence(dept)
    return jsonify({
        "uptime_rate": round(float(intel.get("kpi_uptime_rate") or 0.0), 2),
        "uptime_target": round(float(intel.get("kpi_uptime_target") or 0.0), 1),
        "active_breakdowns": int(intel.get("kpi_active_breakdowns") or 0),
        "active_delta": int(intel.get("kpi_active_delta") or 0),
        "mttr_hours": round(float(intel.get("kpi_mttr_hours") or 0.0), 1),
        "mttr_trend": round(float(intel.get("kpi_mttr_trend") or 0.0), 1),
        "downtime_mtd_hours": round(float(intel.get("kpi_downtime_mtd_hours") or 0.0), 1),
        "downtime_financial_mtd": round(float(intel.get("kpi_downtime_financial_mtd") or 0.0), 0),
        "maintenance_cost_total": round(float(intel.get("maintenance_cost_total") or 0.0), 2),
        "breakdown_cost_total": round(float(intel.get("breakdown_cost_total") or 0.0), 2),
        "combined_cost_total": round(float(intel.get("combined_cost_total") or 0.0), 2),
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    })


@app.get("/api/live/maintenance/kpis")
def api_live_maintenance_kpis():
    dept = get_current_department()
    return jsonify(compute_maintenance_management_kpis(dept))


@app.get("/api/live/breakdowns/<breakdown_id>")
def api_live_breakdown_detail(breakdown_id):
    b = next((x for x in BREAKDOWNS if x.get("breakdown_id") == breakdown_id), None)
    if not b:
        abort(404)
    reported_dt_iso = (b.get("reported_dt") or "").strip()
    resolved_dt_iso = (b.get("resolved_at") or "").strip() if b.get("status") == "resolved" else ""
    if b.get("status") == "resolved":
        mins = b.get("duration_mins")
        if mins is None and reported_dt_iso and resolved_dt_iso:
            mins = minutes_between(reported_dt_iso, resolved_dt_iso)
    else:
        mins = minutes_between(reported_dt_iso or "", datetime.now().isoformat(timespec="seconds"))
    resolved_date, resolved_time = human_dt_parts(resolved_dt_iso) if resolved_dt_iso else ("-", "-")
    return jsonify({
        "status": (b.get("status") or ""),
        "status_label": safe_status_label(b.get("status") or ""),
        "downtime_display_label": fmt_hm_from_minutes(mins or 0),
        "resolved_dt_iso": resolved_dt_iso,
        "resolved_date": resolved_date,
        "resolved_time": resolved_time,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    })


@app.get("/reports", endpoint="reports_center")
def reports_center():
    ctx = base_ctx("reports")
    dept = get_current_department()

    q_raw = (request.args.get("q") or "").strip()
    q = q_raw.lower()
    page = request.args.get("page", default=1, type=int)
    per_page = request.args.get("per_page", default=5, type=int)

    ctx["kpis"] = compute_reports_center_kpis(dept)

    items = [r for r in REPORT_EXPORTS if (r.get("department") or "Engineering") == dept]

    if q:
        def match(r):
            scope_text = " ".join([
                str(r.get("scope_mode") or ""),
                str(r.get("scope_section") or ""),
                str(r.get("generated_for") or ""),
            ]).lower()
            return (
                q in (r.get("name") or "").lower()
                or q in (r.get("category") or "").lower()
                or q in (r.get("user_name") or "").lower()
                or q in (r.get("status") or "").lower()
                or q in scope_text
            )
        items = [r for r in items if match(r)]

    items.sort(key=lambda x: (x.get("created_at") or ""), reverse=True)
    page_data = paginate_records(items, page, per_page)
    ctx.update(
        reports=page_data["items"],
        reports_q=q_raw,
        q=q_raw,
        page=page_data["page"],
        per_page=page_data["per_page"],
        total=page_data["total"],
        total_pages=page_data["total_pages"],
        pages=page_data["pages"],
        showing_start=page_data["showing_start"],
        showing_end=page_data["showing_end"],
    )

    return render_template("reports/reports_center.html", **ctx)


@app.get("/reports/history", endpoint="reports_history")
def reports_history():
    ctx = base_ctx("reports")
    dept = get_current_department()

    q_raw = (request.args.get("q") or "").strip()
    q = q_raw.lower()
    page = request.args.get("page", default=1, type=int)
    per_page = request.args.get("per_page", default=10, type=int)
    fmt = (request.args.get("format") or "").strip().lower()
    status = (request.args.get("status") or "").strip().lower()

    items = [r for r in REPORT_EXPORTS if (r.get("department") or "Engineering") == dept]
    if q:
        items = [
            r for r in items
            if q in (r.get("name") or "").lower()
            or q in (r.get("category") or "").lower()
            or q in (r.get("user_name") or "").lower()
            or q in (r.get("generated_for") or "").lower()
        ]
    if fmt:
        items = [r for r in items if (r.get("format") or ((r.get("filename") or "").split(".")[-1] if r.get("filename") else "")).lower() == fmt]
    if status:
        items = [r for r in items if (r.get("status") or "").lower() == status]

    items.sort(key=lambda x: (x.get("created_at") or ""), reverse=True)
    page_data = paginate_records(items, page, per_page)
    ctx.update(
        reports=page_data["items"],
        exports=page_data["items"],
        reports_q=q_raw,
        q=q_raw,
        selected_format=fmt,
        selected_status=status,
        page=page_data["page"],
        per_page=page_data["per_page"],
        total=page_data["total"],
        total_pages=page_data["total_pages"],
        pages=page_data["pages"],
        showing_start=page_data["showing_start"],
        showing_end=page_data["showing_end"],
    )
    return render_template("reports/reports_history.html", **ctx)


# -------------------------

def _reports_wizard_template(step: str, category: str | None) -> str:
    """Return the correct wizard template for the given step and category.

    Falls back to the generic templates if a category-specific template is missing.
    """
    step = (step or "").strip().lower()
    category = (category or "").strip()

    # Category-specific templates we ship in /templates/reports/
    mapping = {
        "asset_reliability": {
            "step2": "reports/reports_generate_asset_reliability_step2.html",
            "step3": "reports/reports_generate_asset_reliability_step3.html",
        },
        "breakdown_analytics": {
            "step2": "reports/reports_generate_breakdown_analytics_step2.html",
            "step3": "reports/reports_generate_breakdown_analytics_step3.html",
        },
        "maintenance_compliance": {
            "step2": "reports/reports_generate_maintenance_compliance_step2.html",
            "step3": "reports/reports_generate_maintenance_compliance_step3.html",
        },
        "inventory_spares": {
            "step2": "reports/reports_generate_inventory_spares_step2.html",
            "step3": "reports/reports_generate_inventory_spares_step3.html",
        },
        "strategic_roi": {
            "step2": "reports/reports_generate_strategic_roi_step2.html",
            "step3": "reports/reports_generate_strategic_roi_step3.html",
        },
    }

    generic = {
        "step2": "reports/reports_generate_step2.html",
        "step3": "reports/reports_generate_step3.html",
    }

    tpl = mapping.get(category, {}).get(step) or generic.get(step)
    return tpl or generic["step2"]


# REPORTS WIZARD: STEP 1 (GET/POST)
# -------------------------

@app.get("/reports/generate", endpoint="reports_generate_step1_get")
def reports_generate_step1_get():
    ctx = base_ctx("reports")
    w = _wizard_get()
    # Allow deep-links from the reports center cards, e.g. /reports/generate?category=asset_reliability
    allowed = {
        "asset_reliability",
        "breakdown_analytics",
        "maintenance_compliance",
        "inventory_spares",
        "strategic_roi",
    }
    pre = (request.args.get("category") or "").strip()
    if pre in allowed:
        _wizard_set({"category": pre})
        session["report_wizard_category"] = pre
        return redirect(url_for("reports_generate_step2_get"))

    ctx["selected_category"] = w.get("category") or session.get("report_wizard_category")
    ctx["error"] = None
    return render_template("reports/reports_generate_step1.html", **ctx)


@app.post("/reports/generate", endpoint="reports_generate_step1_post")
def reports_generate_step1_post():
    category = (request.form.get("category") or "").strip()

    allowed = {
        "asset_reliability",
        "breakdown_analytics",
        "maintenance_compliance",
        "inventory_spares",
        "strategic_roi",
    }
    if category not in allowed:
        ctx = base_ctx("reports")
        ctx["selected_category"] = category
        ctx["error"] = "Select a valid report category."
        return render_template("reports/reports_generate_step1.html", **ctx), 400

    _wizard_set({"category": category})
    session["report_wizard_category"] = category  # backwards compat

    return redirect(url_for("reports_generate_step2_get"))


# -------------------------
# REPORTS WIZARD: STEP 2 (GET/POST)
# -------------------------

@app.get("/reports/generate/step-2", endpoint="reports_generate_step2_get")
def reports_generate_step2_get():
    w = _wizard_get()
    category = w.get("category") or session.get("report_wizard_category")
    if not category:
        return redirect(url_for("reports_generate_step1_get"))

    current_dept = get_current_department()
    ctx = base_ctx("reports")

    # If department is selectable later, prefer wizard value; otherwise lock to current_dept.
    selected_dept = (w.get("department") or current_dept)


    # Restore multi-asset selection (if any)
    scope_mode = (w.get("scope_mode") or "assets").strip()
    selected_asset_uids = [str(x) for x in (w.get("asset_uids") or []) if str(x).strip()]
    selected_asset_names = []
    if selected_asset_uids:
        uid_to_name = {a.get("uid"): (a.get("asset_name") or '').strip() for a in ASSETS}
        for uid in selected_asset_uids:
            nm = uid_to_name.get(uid) or uid
            selected_asset_names.append(nm.upper())

    ctx.update(
        selected_category=category,
        category_title=_report_category_title(category) + " Configuration",

        start_date=w.get("start_date", "2024-01-01"),
        end_date=w.get("end_date", "2024-01-31"),

        # If you don't have dept dropdown in Step2 UI yet, keep it in ctx for later.
        department=selected_dept,

        # IMPORTANT: sections must come from selected_dept
        sections=distinct_sections_from_assets(department=selected_dept),
        selected_section=w.get("section", ""),

        selected_scope_mode=scope_mode,
        selected_asset_uids=selected_asset_uids,
        selected_asset_names=selected_asset_names,

        selected_asset_uid=w.get("asset_uid", ""),
        selected_asset_name=w.get("asset_name", ""),  # optional but useful for chip restore

        selected_metrics=w.get("metrics", None),
        export_format=w.get("format", "pdf"),
        error=None,
    )
    template = _reports_wizard_template("step2", category)
    return render_template(template, **ctx)


@app.post("/reports/generate/step-2", endpoint="reports_generate_step2_post")
def reports_generate_step2_post():
    w = _wizard_get()
    category = (request.form.get("category") or "").strip() or w.get("category") or session.get("report_wizard_category")
    if not category:
        return redirect(url_for("reports_generate_step1_get"))

    current_dept = get_current_department()

    start_date = (request.form.get("start_date") or "").strip()
    end_date = (request.form.get("end_date") or "").strip()

    # Department selection (if UI has it; otherwise it will just be current_dept)
    department = (request.form.get("department") or w.get("department") or current_dept).strip()
    if department not in DEPARTMENTS:
        department = current_dept

    section = (request.form.get("section") or "").strip()
    scope_mode = (request.form.get("scope_mode") or "assets").strip().lower()
    if scope_mode not in ("assets", "section", "department"):
        scope_mode = "assets"
    asset_uids = [x.strip() for x in request.form.getlist("asset_uids") if (x or "").strip()]
    asset_uid = (request.form.get("asset_uid") or "").strip() or (asset_uids[0] if len(asset_uids) == 1 else "")
    asset_name = (request.form.get("asset_name") or "").strip()  # optional
    metrics = request.form.getlist("metrics")
    export_format = (request.form.get("format") or "pdf").strip().lower()

    # ✅ NEW: generated_for (UI may not send it yet, so fallback to section then default label)
    generated_for = (request.form.get("generated_for") or section or "Production Unit A").strip()

    # validate dates (allow empty -> default last 30 days)
    if not start_date or not parse_date_only(start_date):
        start_date = (datetime.now() - timedelta(days=30)).date().isoformat()

    if not end_date or not parse_date_only(end_date):
        end_date = datetime.now().date().isoformat()

    if parse_date_only(end_date) < parse_date_only(start_date):
        return _step2_error(
            category,
            department,
            section,
            asset_uid,
            asset_name,
            start_date,
            end_date,
            metrics,
            export_format,
            "End date must be on or after start date.",
        )

    if not metrics:
        return _step2_error(category, department, section, asset_uid, asset_name, start_date, end_date, metrics, export_format, "Select at least one metric.")

    if export_format not in ("pdf", "xlsx", "csv"):
        export_format = "pdf"

    # validate section exists in SELECTED department
    valid_sections = distinct_sections_from_assets(department=department)

    # SECTION requirement depends on scope
    if scope_mode in ("assets", "section"):
        if not section or section not in valid_sections:
            return _step2_error(
                category, department, section, asset_uid, asset_name, start_date, end_date, metrics, export_format,
                "Select a valid section for the chosen scope."
            )
    else:
        # department-wide: section is optional, but if provided must be valid
        if section and section not in valid_sections:
            section = ""

    # validate asset(s) for selected scope
    cleaned_asset_uids = []
    cleaned_asset_names = []

    if scope_mode == "assets":
        if not asset_uids and asset_uid:
            asset_uids = [asset_uid]

        for uid in asset_uids:
            a = next((x for x in ASSETS if x.get("uid") == uid), None)
            if not a:
                continue
            if (a.get("department") or "Engineering") != department:
                continue
            if section and (a.get("section") or "").strip() != section:
                continue
            cleaned_asset_uids.append(uid)
            cleaned_asset_names.append((a.get("asset_name") or "").strip())

        # must have at least one valid asset
        if not cleaned_asset_uids:
            return _step2_error(
                category, department, section, "", "", start_date, end_date, metrics, export_format,
                "Select at least one machine for Selected Machines scope."
            )

        asset_uids = cleaned_asset_uids
        asset_uid = asset_uids[0] if len(asset_uids) == 1 else ""
        asset_name = cleaned_asset_names[0] if len(cleaned_asset_names) == 1 else ""

    elif scope_mode == "section":
        # section-wide: ignore explicit asset selection
        asset_uids = []
        asset_uid = ""
        asset_name = ""

    elif scope_mode == "department":
        # department-wide: ignore explicit asset selection
        asset_uids = []
        asset_uid = ""
        asset_name = ""
    _wizard_set({
        "category": category,
        "start_date": start_date,
        "end_date": end_date,
        "department": department,
        "section": section,
        "scope_mode": scope_mode,

        # ✅ NEW: store generated_for in wizard for Step 3 + PDF cover + report metadata
        "generated_for": generated_for,

        "asset_uid": asset_uid,
        "asset_uids": asset_uids,
        "asset_name": asset_name,
        "metrics": metrics,
        "format": export_format,
    })

    return redirect(url_for("reports_generate_step3_get"))

def _step2_error(category, department, section, asset_uid, asset_name, start_date, end_date, metrics, export_format, msg):
    ctx = base_ctx("reports")
    ctx.update(
        selected_category=category,
        category_title=_report_category_title(category) + " Configuration",
        selected_scope_mode=(request.form.get("scope_mode") or "assets").strip().lower(),
        selected_asset_uids=[x.strip() for x in request.form.getlist("asset_uids") if (x or "").strip()],
        department=department,

        # IMPORTANT: sections must come from selected department
        sections=distinct_sections_from_assets(department=department),
        selected_section=section,

        selected_asset_uid=asset_uid,
        selected_asset_name=asset_name,

        start_date=start_date,
        end_date=end_date,
        selected_metrics=metrics,
        export_format=export_format,
        error=msg,
    )
    template = _reports_wizard_template("step2", category)
    return render_template(template, **ctx), 400


# -------------------------
# REPORTS WIZARD: STEP 3 (GET/POST)
# -------------------------

@app.get("/reports/generate/progress/<job_id>")
def reports_generate_progress(job_id):
    row = REPORT_GENERATION_PROGRESS.get((job_id or "").strip()) or {
        "percent": 0,
        "label": "Waiting",
        "status": "idle",
        "redirect": "",
        "error": "",
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    return jsonify(row)


@app.get("/reports/generate/step-3", endpoint="reports_generate_step3_get")
def reports_generate_step3_get():
    w = _wizard_get()
    category = w.get("category") or session.get("report_wizard_category")
    if not category:
        return redirect(url_for("reports_generate_step1_get"))

    # hard gate: must have step2
    if not w.get("start_date") or not w.get("end_date") or not w.get("metrics") or not w.get("format"):
        return redirect(url_for("reports_generate_step2_get"))

    dept = w.get("department") or get_current_department()

    # derive selected assets list for preview (based on scope_mode)
    scope_mode = (w.get("scope_mode") or "assets").strip().lower()
    if scope_mode not in ("assets", "section", "department"):
        scope_mode = "assets"

    selected_assets = []
    if scope_mode == "assets":
        uids = w.get("asset_uids") or ([] if not (w.get("asset_uid") or "").strip() else [(w.get("asset_uid") or "").strip()])
        if uids:
            uidset = set(uids)
            selected_assets = [a for a in ASSETS if (a.get("department") or "Engineering") == dept and (a.get("uid") or "") in uidset]
        else:
            selected_assets = []

    elif scope_mode == "section":
        sec = (w.get("section") or "").strip()
        selected_assets = [a for a in ASSETS if (a.get("department") or "Engineering") == dept and (a.get("section") or "").strip() == sec]

    else:  # department
        selected_assets = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]
# preview chips (like screenshot)
    preview_asset_chips = []
    for a in selected_assets[:3]:
        name = (a.get("asset_name") or "").strip() or "Unnamed Asset"
        preview_asset_chips.append(name.upper())
    if len(selected_assets) > 3:
        preview_asset_chips.append(f"+{len(selected_assets) - 3} MORE")

    # ✅ machine name (single selected asset) for preview/cover
    preview_machine_name = ""
    if (w.get("scope_mode") or "assets") == "assets":
        uids = w.get("asset_uids") or ([] if not (w.get("asset_uid") or "").strip() else [(w.get("asset_uid") or "").strip()])
        if len(uids) == 1:
            a = next((x for x in ASSETS if x.get("uid") == uids[0]), None)
            preview_machine_name = (a.get("asset_name") or "").strip() if a else ""
        elif len(uids) > 1:
            preview_machine_name = "Multiple Machines"
    ctx = base_ctx("reports")
    ctx.update(
        wizard=w,

        preview_report_type=_report_category_title(category),
        preview_time_range=_range_label_from_dates(w["start_date"], w["end_date"]),
        preview_selected_assets=preview_asset_chips,
        preview_output_format=_format_label(w.get("format")),

        recipient_name=ctx.get("current_user_name") or "User",
        recipient_email=(ctx.get("current_user_email") or "opsloom.ke@gmail.com"),

        send_email_default=True,
        schedule_monthly_default=False,

        preview_title=_report_category_title(category),
        preview_generated_for=(w.get("generated_for") or w.get("section") or "Production Unit A"),
        preview_machine_name=preview_machine_name,

        error=None,
        report_job_id=token_urlsafe(12),
    )

    template = _reports_wizard_template("step3", category)
    return render_template(template, **ctx)

@app.post("/reports/generate/step-3", endpoint="reports_generate_step3_post")
def reports_generate_step3_post():
    w = _wizard_get()
    category = w.get("category") or session.get("report_wizard_category")
    wants_json = request.headers.get("X-Requested-With") == "XMLHttpRequest" or "application/json" in (request.headers.get("Accept") or "")
    job_id = _report_progress_start((request.form.get("job_id") or "").strip() or token_urlsafe(12), "Validating report request")
    if not category:
        return redirect(url_for("reports_generate_step1_get"))

    if not w.get("start_date") or not w.get("end_date") or not w.get("metrics") or not w.get("format"):
        return redirect(url_for("reports_generate_step2_get"))

    report_name = (request.form.get("report_name") or "").strip() or _default_report_name(category, w["start_date"], w["end_date"])
    _report_progress_update(job_id, 10, "Collecting report scope and filters")
    dept = w.get("department") or get_current_department()
    fmt = (w.get("format") or "pdf").lower()

    # ✅ Match Step 3 template checkbox names
    _report_progress_update(job_id, 18, "Preparing delivery options")
    send_email = bool(request.form.get("send_email"))
    schedule_monthly = bool(request.form.get("schedule_monthly"))
    include_cover = bool(request.form.get("include_cover"))

    # Email extras (comma-separated). These should never break generation if empty/invalid.
    def _parse_emails(raw: str) -> list:
        raw = (raw or "").strip()
        if not raw:
            return []
        parts = [p.strip() for p in raw.replace(";", ",").split(",")]
        out = []
        for p in parts:
            if not p:
                continue
            # very light validation
            if "@" in p and "." in p.split("@")[-1]:
                out.append(p)
        # de-dup preserve order
        seen = set()
        uniq = []
        for e in out:
            if e.lower() in seen:
                continue
            seen.add(e.lower())
            uniq.append(e)
        return uniq

    to_emails = _parse_emails(request.form.get("to_emails") or "")
    cc_emails = _parse_emails(request.form.get("cc_emails") or "")
    email_subject = (request.form.get("email_subject") or "").strip()
    email_message = (request.form.get("email_message") or "").strip()

    rid = uuid4().hex

    # Data snapshot (dept scoped)
    assets = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]
    breakdowns = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept]
    tasks = [t for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]
    inventory_parts = [p for p in INVENTORY_PARTS if (p.get("department") or "Engineering") == dept]

    # Optional: filter report scope based on scope_mode
    scope_mode = (w.get("scope_mode") or "assets").strip().lower()
    if scope_mode not in ("assets", "section", "department"):
        scope_mode = "assets"

    if scope_mode == "assets":
        scope_asset_uids = w.get("asset_uids") or ([] if not (w.get("asset_uid") or "").strip() else [(w.get("asset_uid") or "").strip()])
        if scope_asset_uids:
            uidset_raw = {str(u).strip() for u in scope_asset_uids if str(u).strip()}
            assets = [a for a in assets if _norm_str(a.get("uid")) in {_norm_str(u) for u in uidset_raw}]
            uidset, nameset = _asset_scope_sets(assets)
            breakdowns = _filter_records_by_asset_scope(breakdowns, uidset, nameset)
            tasks = _filter_records_by_asset_scope(tasks, uidset, nameset)

    elif scope_mode == "section":
        sec = (w.get("section") or "").strip()
        if sec:
            assets = [a for a in assets if _norm_str(a.get("section")) == _norm_str(sec)]
            uidset, nameset = _asset_scope_sets(assets)
            breakdowns = _filter_records_by_asset_scope(breakdowns, uidset, nameset)
            tasks = _filter_records_by_asset_scope(tasks, uidset, nameset)

    else:
        # department-wide: no further filtering
        pass

    kpis = compute_reports_center_kpis(dept)

    download_url = None
    status = "READY"
    filename = None
    abs_path = None

    # CSV
    if fmt == "csv":
        _report_progress_update(job_id, 55, "Building CSV export")
        filename = f"report_{rid}.csv"
        abs_path = os.path.join(REPORT_EXPORT_DIR, filename)
        with open(abs_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Report Name", report_name])
            writer.writerow(["Category", _report_category_title(category)])
            writer.writerow(["Department", report_department_display(dept)])
            writer.writerow(["Range", f"{w['start_date']} to {w['end_date']}"])
            writer.writerow(["Generated At", datetime.now().isoformat(timespec="seconds")])
            writer.writerow([])
            writer.writerow(["KPI", "Value"])
            for k, v in kpis.items():
                writer.writerow([k, v])
            writer.writerow([])
            writer.writerow(["Assets Count", len(assets)])
            writer.writerow(["Breakdowns Count", len(breakdowns)])
            writer.writerow(["PM Tasks Count", len(tasks)])

        download_url = url_for("static", filename=f"exports/reports/{filename}")

    # XLSX
    elif fmt == "xlsx":
        _report_progress_update(job_id, 55, "Building Excel export")
        try:
            import openpyxl
            from openpyxl.workbook import Workbook
            from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
            from openpyxl.utils import get_column_letter
            from openpyxl.chart import LineChart, Reference
        except ModuleNotFoundError:
            status = "PENDING"
            download_url = None
        else:
            filename = f"report_{rid}.xlsx"
            abs_path = os.path.join(REPORT_EXPORT_DIR, filename)

            wb = Workbook()
            ws = wb.active
            ws.title = "Summary"

            # ---------- Styling helpers ----------
            header_font = Font(bold=True, color="FFFFFF")
            title_font = Font(bold=True, size=18)
            kpi_label_font = Font(bold=True)
            center = Alignment(horizontal="center", vertical="center")
            left = Alignment(horizontal="left", vertical="center")
            wrap = Alignment(wrap_text=True, vertical="top")
            fill_title = PatternFill("solid", fgColor="1554FF")  # UEAL purple
            fill_header = PatternFill("solid", fgColor="0B1020")  # UEAL gold
            thin = Side(style="thin", color="CBD5E1")
            border = Border(left=thin, right=thin, top=thin, bottom=thin)

            def autosize(sheet, max_col=12):
                for col in range(1, max_col + 1):
                    letter = get_column_letter(col)
                    sheet.column_dimensions[letter].width = 18

            # ---------- Summary sheet ----------
            ws.merge_cells("A1:F1")
            ws["A1"] = report_name
            ws["A1"].font = title_font
            ws["A1"].alignment = left

            ws.merge_cells("A2:F2")
            ws["A2"] = f"{_report_category_title(category)} • {dept} • {w['start_date']} to {w['end_date']}"
            ws["A2"].alignment = left

            ws.merge_cells("A4:F4")
            ws["A4"] = "KPI Snapshot"
            ws["A4"].font = Font(bold=True, color="FFFFFF")
            ws["A4"].fill = fill_title
            ws["A4"].alignment = left

            ws.append([])
            ws.append(["KPI", "Value"])
            ws["A6"].font = header_font
            ws["A6"].fill = fill_header
            ws["A6"].alignment = center
            ws["B6"].font = header_font
            ws["B6"].fill = fill_header
            ws["B6"].alignment = center

            row = 7
            for k, v in kpis.items():
                ws.cell(row=row, column=1, value=str(k)).font = kpi_label_font
                ws.cell(row=row, column=2, value=v)
                row += 1

            ws.cell(row=row + 1, column=1, value="Assets Count").font = kpi_label_font
            ws.cell(row=row + 1, column=2, value=len(assets))
            ws.cell(row=row + 2, column=1, value="Breakdowns Count").font = kpi_label_font
            ws.cell(row=row + 2, column=2, value=len(breakdowns))
            ws.cell(row=row + 3, column=1, value="PM Tasks Count").font = kpi_label_font
            ws.cell(row=row + 3, column=2, value=len(tasks))

            # Borders for KPI table
            for r in range(6, row + 4):
                for c in range(1, 3):
                    cell = ws.cell(row=r, column=c)
                    cell.border = border
                    cell.alignment = left

            autosize(ws, 6)
            ws.freeze_panes = "A6"

            # ---------- Assets sheet ----------
            ws_assets = wb.create_sheet("Assets")
            asset_headers = ["asset_id", "asset_name", "section", "status", "criticality"]
            ws_assets.append(asset_headers)
            for c, h in enumerate(asset_headers, start=1):
                cell = ws_assets.cell(row=1, column=c)
                cell.value = h
                cell.font = header_font
                cell.fill = fill_title
                cell.alignment = center
                cell.border = border

            for a in assets[:5000]:
                ws_assets.append([
                    a.get("asset_id"),
                    a.get("asset_name"),
                    a.get("section"),
                    a.get("status"),
                    a.get("criticality"),
                ])

            for r in ws_assets.iter_rows(min_row=2, max_col=len(asset_headers)):
                for cell in r:
                    cell.border = border
                    cell.alignment = wrap if cell.column == 2 else left

            autosize(ws_assets, len(asset_headers))
            ws_assets.freeze_panes = "A2"

            # ---------- Breakdowns sheet + simple chart (if any) ----------
            ws_bd = wb.create_sheet("Breakdowns")
            bd_headers = ["date", "asset_id", "asset_name", "category", "severity", "downtime_hours", "root_cause", "status"]
            ws_bd.append(bd_headers)
            for c, h in enumerate(bd_headers, start=1):
                cell = ws_bd.cell(row=1, column=c)
                cell.value = h
                cell.font = header_font
                cell.fill = fill_title
                cell.alignment = center
                cell.border = border

            # Keep a compact, readable export
            bd_rows = breakdowns[:10000]
            for b in bd_rows:
                ws_bd.append([
                    b.get("date"),
                    b.get("asset_id"),
                    b.get("asset_name"),
                    b.get("category"),
                    b.get("severity"),
                    float(b.get("downtime_hours") or 0),
                    b.get("root_cause"),
                    b.get("status"),
                ])

            for r in ws_bd.iter_rows(min_row=2, max_col=len(bd_headers)):
                for cell in r:
                    cell.border = border
                    cell.alignment = wrap if cell.column in (3, 7) else left

            autosize(ws_bd, len(bd_headers))
            ws_bd.freeze_panes = "A2"

            # Chart: incidents over time (only if we have dates)
            try:
                # Build a small helper table for charting
                ws_chart = wb.create_sheet("_ChartData")
                ws_chart.append(["date", "incidents"])
                by_date = {}
                for b in bd_rows:
                    d = b.get("date") or ""
                    by_date[d] = by_date.get(d, 0) + 1
                for d in sorted(by_date.keys())[:365]:
                    ws_chart.append([d, by_date[d]])

                if ws_chart.max_row > 2:
                    chart = LineChart()
                    chart.title = "Incidents over time"
                    chart.y_axis.title = "Count"
                    chart.x_axis.title = "Date"
                    data = Reference(ws_chart, min_col=2, min_row=1, max_row=ws_chart.max_row)
                    cats = Reference(ws_chart, min_col=1, min_row=2, max_row=ws_chart.max_row)
                    chart.add_data(data, titles_from_data=True)
                    chart.set_categories(cats)
                    ws.add_chart(chart, "D6")
            except Exception:
                # Chart is optional; never fail export generation because of it
                pass

            # ---------- Maintenance sheet ----------
            ws_pm = wb.create_sheet("PM Tasks")
            pm_headers = ["task_id", "asset_id", "asset_name", "type", "planned_date", "completed_date", "status", "technician"]
            ws_pm.append(pm_headers)
            for c, h in enumerate(pm_headers, start=1):
                cell = ws_pm.cell(row=1, column=c)
                cell.value = h
                cell.font = header_font
                cell.fill = fill_title
                cell.alignment = center
                cell.border = border
            for t in tasks[:10000]:
                ws_pm.append([
                    t.get("task_id"),
                    t.get("asset_id"),
                    t.get("asset_name"),
                    t.get("type"),
                    t.get("planned_date"),
                    t.get("completed_date"),
                    t.get("status"),
                    t.get("technician"),
                ])
            for r in ws_pm.iter_rows(min_row=2, max_col=len(pm_headers)):
                for cell in r:
                    cell.border = border
                    cell.alignment = wrap if cell.column == 3 else left
            autosize(ws_pm, len(pm_headers))
            ws_pm.freeze_panes = "A2"

            # Hide chart data sheet if created
            if "_ChartData" in wb.sheetnames:
                wb["_ChartData"].sheet_state = "hidden"

            wb.save(abs_path)
            download_url = url_for("static", filename=f"exports/reports/{filename}")

    # PDF
    else:
        _report_progress_update(job_id, 55, "Rendering PDF report")
        filename = f"report_{rid}.pdf"
        abs_path = os.path.join(REPORT_EXPORT_DIR, filename)
        rel_url = url_for("static", filename=f"exports/reports/{filename}")
        pdf_ready = False

        export_preview = dict(
            id=rid,
            name=report_name,
            report_title=report_name,
            category_key=category,
            category=_report_category_title(category),
            department=dept,
            generated_for=(w.get("generated_for") or w.get("section") or dept),
            scope_mode=scope_mode,
            scope_section=(w.get("section") or "").strip(),
            scope_asset_uids=(w.get("asset_uids") or ([] if not (w.get("asset_uid") or "").strip() else [(w.get("asset_uid") or "").strip()])),
            metrics=w.get("metrics") or [],
            metric_labels=[metric_label(m, category) for m in (w.get("metrics") or [])],
            start_date=w["start_date"],
            end_date=w["end_date"],
            status=status,
            user_name=base_ctx("reports")["current_user_name"],
            created_at=datetime.now().isoformat(timespec="seconds"),
        )

        pdf_buf = _render_report_pdf_buffer(export_preview)
        if pdf_buf:
            with open(abs_path, "wb") as fp:
                fp.write(pdf_buf.getvalue())
            pdf_ready = True
        elif REPORTLAB_AVAILABLE:
            from reportlab.lib.pagesizes import A4
            from reportlab.pdfgen import canvas

            c = canvas.Canvas(abs_path, pagesize=A4)
            _build_report_pdf_guarded(
                c=c,
                report_name=report_name,
                category_key=category,
                category_title=_report_category_title(category),
                department=dept,
                start_date=w["start_date"],
                end_date=w["end_date"],
                generated_for=w.get("generated_for") or "",
                section=w.get("section") or "—",
                asset_uid=w.get("asset_uid") or "",
                assets=assets,
                breakdowns=breakdowns,
                tasks=tasks,
                inventory_parts=inventory_parts,
                metrics=w.get("metrics") or [],
                kpis=kpis,
                include_cover=include_cover,
                reported_by=base_ctx("reports")["current_user_name"],
            )
            c.save()
            pdf_ready = True
        else:
            status = "PENDING"
            download_url = None

        if pdf_ready:
            download_url = rel_url

    _report_progress_update(job_id, 82, "Saving report to register")
    # file size (for success UI card)
    file_size_mb = None
    if abs_path and os.path.exists(abs_path):
        file_size_mb = round(os.path.getsize(abs_path) / (1024 * 1024), 1)

    # Store export record (✅ include filename so success page can show it)
    export_rec = dict(
        id=rid,
        name=report_name,
        period_label=_range_label_from_dates(w["start_date"], w["end_date"]),
        start_date=w["start_date"],
        end_date=w["end_date"],
        format=fmt,
        metrics=w.get("metrics") or [],
        metric_labels=[metric_label(m, category) for m in (w.get("metrics") or [])],
        category_key=category,
        category=_report_category_title(category),
        department=dept,
        generated_for=(w.get("generated_for") or w.get("section") or dept),
        scope_mode=scope_mode,
        scope_section=(w.get("section") or "").strip(),
        scope_asset_uids=(w.get("asset_uids") or ([] if not (w.get("asset_uid") or "").strip() else [(w.get("asset_uid") or "").strip()])),
        user_name=base_ctx("reports")["current_user_name"],
        user_initials=initials(base_ctx("reports")["current_user_name"]),
        user_avatar=base_ctx("reports").get("current_user_avatar_url"),
        date=datetime.now().strftime("%d %b %Y %H:%M"),
        status=status,
        filename=filename,
        files={fmt: filename} if filename else {},
        file_size_mb=file_size_mb,
        download_url=download_url,
        created_at=datetime.now().isoformat(timespec="seconds"),

        send_email=send_email,
        schedule_monthly=schedule_monthly,
        include_cover=include_cover,
        email_to=to_emails,
        email_cc=cc_emails,
        email_subject=email_subject,
        email_message=email_message,
        email_status=None,
    )
    REPORT_EXPORTS.insert(0, export_rec)

    # Best-effort email send (won't crash the request if SMTP isn't configured).
    _report_progress_update(job_id, 88, "Finalizing report package")
    if send_email and abs_path and os.path.exists(abs_path):
        try:
            smtp_host = (SYSTEM_SETTINGS.get("smtp_host") or os.environ.get("SMTP_HOST") or "").strip()
            smtp_port = int(SYSTEM_SETTINGS.get("smtp_port") or os.environ.get("SMTP_PORT", "587"))
            smtp_user = (SYSTEM_SETTINGS.get("smtp_user") or os.environ.get("SMTP_USER") or "").strip()
            smtp_pass = (SYSTEM_SETTINGS.get("smtp_pass") or os.environ.get("SMTP_PASS") or "").strip()
            smtp_from = (SYSTEM_SETTINGS.get("smtp_from") or os.environ.get("SMTP_FROM") or smtp_user or "").strip()

            # If SMTP not configured, mark as skipped.
            if not (smtp_host and smtp_user and smtp_pass and smtp_from):
                export_rec["email_status"] = "SKIPPED_NO_SMTP"
            else:
                from email.message import EmailMessage
                import smtplib

                msg = EmailMessage()
                msg["From"] = smtp_from
                # Always include current user email as primary recipient if available,
                # but never duplicate addresses across To/CC (case-insensitive).
                primary = (base_ctx("reports").get("current_user_email") or "").strip()

                # Build To list (primary + additional)
                raw_to = []
                if primary:
                    raw_to.append(primary)
                raw_to.extend(to_emails)

                seen = set()
                all_to = []
                for e in raw_to:
                    key = (e or "").strip().lower()
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    all_to.append((e or "").strip())

                # Build CC list (dedup + remove anything already in To)
                all_cc = []
                for e in cc_emails:
                    key = (e or "").strip().lower()
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    all_cc.append((e or "").strip())

                if not all_to:
                    export_rec["email_status"] = "SKIPPED_NO_RECIPIENTS"
                else:
                    msg["To"] = ", ".join(all_to)
                    if all_cc:
                        msg["Cc"] = ", ".join(all_cc)

                    if not email_subject:
                        email_subject = f"{_report_category_title(category)} • {_range_label_from_dates(w['start_date'], w['end_date'])}"
                    msg["Subject"] = email_subject

                    if not email_message:
                        email_message = (
                            f"Hello,\n\n"
                            f"Please find attached the {_report_category_title(category)} report for {dept} "
                            f"covering {w['start_date']} to {w['end_date']}."
                        )
                    _apply_email_body(msg, email_message, signature=_current_mail_signature())

                    with open(abs_path, "rb") as fp:
                        data = fp.read()
                    # basic mimetypes
                    if fmt == "pdf":
                        maintype, subtype = "application", "pdf"
                    elif fmt == "xlsx":
                        maintype, subtype = "application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    else:
                        maintype, subtype = "text", "csv"
                    msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename or os.path.basename(abs_path))

                    _report_progress_update(job_id, 94, "Sending email delivery")
                    _smtp_send_message(msg, smtp_host, smtp_port, smtp_user, smtp_pass)
                    export_rec["email_status"] = "SENT"
        except Exception:
            export_rec["email_status"] = "FAILED"

    push_notification(
        title="Report generated",
        message=f"{report_name} is ready in {str(fmt).upper()} format.",
        kind="success",
        href=url_for("reports_generate_success_get", rid=rid),
    )
    if send_email:
        push_notification(
            title="Report email status",
            message=f"{report_name}: {export_rec.get('email_status') or 'PENDING'}",
            kind="success" if export_rec.get("email_status") == "SENT" else ("warning" if str(export_rec.get("email_status") or "").startswith("SKIPPED") else "info"),
            href=url_for("reports_generate_success_get", rid=rid),
        )

    _wizard_clear()

    success_url = url_for("reports_generate_success_get", rid=rid)
    _report_progress_finish(job_id, redirect_url=success_url)

    # ✅ Redirect to Success screen
    if wants_json:
        return jsonify({"ok": True, "redirect": success_url, "job_id": job_id})
    return redirect(success_url)


def _absolute_public_url(raw_url: str | None) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""
    if url.startswith(("http://", "https://", "data:", "cid:")):
        return url
    if not has_request_context():
        return url
    return urljoin(request.url_root, url.lstrip("/"))


def _local_public_file_path(raw_url: str | None) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""
    parsed = urlsplit(url)
    path = parsed.path if (parsed.scheme or parsed.netloc) else (url if url.startswith("/") else f"/{url.lstrip('/')}" )
    if not path.startswith("/static/"):
        return ""
    candidate = os.path.join(app.root_path, path.lstrip("/"))
    return candidate if os.path.exists(candidate) else ""


def _current_mail_signature() -> dict:
    user = _current_user_record() or {}
    return {
        "name": (user.get("signature_name") or SYSTEM_SETTINGS.get("mail_signature_name") or user.get("name") or "Opsloom").strip(),
        "title": (user.get("signature_title") or SYSTEM_SETTINGS.get("mail_signature_title") or user.get("role") or "").strip(),
        "font": (user.get("signature_font") or SYSTEM_SETTINGS.get("mail_signature_font") or "Inter").strip(),
        "color": (user.get("signature_color") or SYSTEM_SETTINGS.get("mail_signature_color") or "#1554FF").strip(),
        "footer": (SYSTEM_SETTINGS.get("mail_signature_footer") or "Opsloom").strip(),
        "image_url": (user.get("signature_image_url") or SYSTEM_SETTINGS.get("mail_signature_image_url") or "").strip(),
    }


def _build_email_bodies(message_text: str, signature: dict | None = None):
    signature = signature or _current_mail_signature()
    clean_text = (message_text or "").strip() or "Please find the requested report attached."
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", clean_text) if p.strip()] or [clean_text]
    image_url = (signature.get("image_url") or "").strip()
    inline_path = _local_public_file_path(image_url)
    cid = ""
    if inline_path:
        try:
            from email.utils import make_msgid
            cid = make_msgid(domain="opsloom.local")[1:-1]
        except Exception:
            cid = ""
    image_src = f"cid:{cid}" if cid else _absolute_public_url(image_url)

    plain_lines = [clean_text, "", "Regards,", signature.get("name") or "Opsloom"]
    if signature.get("title"):
        plain_lines.append(signature.get("title"))
    if signature.get("footer"):
        plain_lines.append(signature.get("footer"))
    plain_body = "\n".join([line for line in plain_lines if line is not None])

    para_html = "".join(
        f'<p style="margin:0 0 12px 0; line-height:1.6; color:#0F172A;">{html.escape(p)}</p>'
        for p in paragraphs
    )
    sig_name = html.escape(signature.get("name") or "Opsloom")
    sig_title = html.escape(signature.get("title") or "")
    sig_footer = html.escape(signature.get("footer") or "")
    sig_font = html.escape(signature.get("font") or "Inter")
    sig_color = html.escape(signature.get("color") or "#1554FF")
    image_html = f'<div style="margin-top:10px;"><img src="{html.escape(image_src)}" alt="signature" style="max-height:72px; max-width:240px; object-fit:contain;"></div>' if image_src else ""
    html_body = (
        f'<div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#0F172A;">'
        f'{para_html}'
        f'<div style="margin-top:18px; padding-top:14px; border-top:1px solid #E2E8F0; font-family:{sig_font}, Arial, sans-serif;">'
        f'<div style="font-weight:700; color:{sig_color}; font-size:15px;">{sig_name}</div>'
        f'{f"<div style=\"margin-top:3px; color:#334155; font-size:13px;\">{sig_title}</div>" if sig_title else ""}'
        f'{f"<div style=\"margin-top:3px; color:#64748B; font-size:12px;\">{sig_footer}</div>" if sig_footer else ""}'
        f'{image_html}'
        f'</div></div>'
    )
    return plain_body, html_body, inline_path, cid


def _apply_email_body(msg, message_text: str, signature: dict | None = None):
    plain_body, html_body, inline_path, cid = _build_email_bodies(message_text, signature=signature)
    msg.set_content(plain_body)
    msg.add_alternative(html_body, subtype="html")
    if inline_path and cid:
        try:
            ctype, _ = mimetypes.guess_type(inline_path)
            maintype, subtype = (ctype or "image/png").split("/", 1)
            with open(inline_path, "rb") as img_fp:
                img_bytes = img_fp.read()
            msg.get_payload()[-1].add_related(img_bytes, maintype=maintype, subtype=subtype, cid=f"<{cid}>")
        except Exception:
            pass


def _smtp_send_message(msg, smtp_host: str, smtp_port: int, smtp_user: str, smtp_pass: str):
    import smtplib
    with smtplib.SMTP(smtp_host, smtp_port, timeout=25) as s:
        s.ehlo()
        if int(smtp_port or 0) == 587:
            s.starttls()
            s.ehlo()
        s.login(smtp_user, smtp_pass)
        s.send_message(msg)


# -------------------------
# REPORTS: Assets API (must match Step2 JS: /reports/api/assets)
# -------------------------
@app.get("/reports/api/assets", endpoint="reports_assets_api")
def reports_assets_api():
    # IMPORTANT: Step2 currently filters by SECTION only.
    # If you later add dept/section filtering, pass dept too.
    dept = (request.args.get("department") or "").strip() or get_current_department()
    if dept not in DEPARTMENTS:
        dept = get_current_department()
    section = (request.args.get("section") or "").strip()
    if not section:
        return jsonify({"assets": []})

    items = [
        a for a in ASSETS
        if (a.get("department") or "Engineering") == dept
        and (a.get("section") or "").strip() == section
    ]
    items.sort(key=lambda x: (x.get("asset_name") or "").lower())

    # ✅ Step2 normalizeAssetRow expects {uid,name} OR {uid,asset_name}
    out = [{"uid": a.get("uid"), "name": a.get("asset_name") or a.get("asset_name", ""), "asset_id": a.get("asset_id")} for a in items]
    return jsonify({"assets": out})


# -------------------------
# REPORTS: SUCCESS PAGE (matches screenshot)
# -------------------------
@app.get("/reports/generate/success/<rid>", endpoint="reports_generate_success_get")
def reports_generate_success_get(rid: str):
    export = next((x for x in REPORT_EXPORTS if x.get("id") == rid), None)
    if not export:
        abort(404)
    print_mode = (request.args.get("print") or "").lower() in ("1", "true", "yes")
    ctx, view_tpl = _build_report_view_context(export, print_mode=print_mode)
    return render_template(view_tpl, **ctx)


@app.get("/reports/view/<rid>", endpoint="reports_view")
def reports_view(rid):
    return reports_generate_success_get(rid)

    # Asset context for headers
    machine_name = ""
    serial_number = ""
    if asset_uid:
        a = next((x for x in (assets or []) if _norm_str(x.get("uid")) == _norm_str(asset_uid)), None)
        if a:
            machine_name = (a.get("asset_name") or a.get("name") or a.get("machine_name") or "").strip()
            serial_number = (a.get("serial_number") or a.get("serial") or a.get("serial_no") or a.get("sn") or "").strip()



# -------------------------
# REPORT CHART HELPERS
# -------------------------
def _record_dt_for_chart(rec: dict) -> Optional[datetime]:
    for k in ("resolved_at", "reported_dt", "reported_at", "completed_at", "due_date", "created_at", "created_dt", "date", "timestamp"):
        v = rec.get(k)
        if not v:
            continue
        if isinstance(v, datetime):
            return v
        if isinstance(v, date):
            return datetime(v.year, v.month, v.day)
        if isinstance(v, (int, float)):
            try:
                return datetime.fromtimestamp(float(v))
            except Exception:
                continue
        if isinstance(v, str):
            dt = parse_iso_dt(v) or parse_dt_local(v)
            if dt:
                return dt
            d = parse_date_only(v)
            if d:
                return datetime(d.year, d.month, d.day)
    return None


def _duration_hours_for_chart(rec: dict) -> float:
    for k in ("duration_hours", "downtime_hours"):
        v = rec.get(k)
        if v is None:
            continue
        try:
            return float(v)
        except Exception:
            pass
    for k in ("duration_mins", "downtime_mins", "duration_minutes"):
        v = rec.get(k)
        if v is None:
            continue
        try:
            return float(v) / 60.0
        except Exception:
            pass
    a = rec.get("start_time") or rec.get("start")
    b = rec.get("end_time") or rec.get("end")
    if isinstance(a, str) and isinstance(b, str):
        mins = minutes_between(a, b)
        if mins is not None:
            return mins / 60.0
    return 0.0


def _resolve_report_scope(export: dict):
    dept = (export.get("department") or get_current_department() or "Engineering").strip() or "Engineering"
    scope_mode = (export.get("scope_mode") or "assets").strip().lower()
    scope_section = (export.get("scope_section") or "").strip()
    scope_asset_uids = export.get("scope_asset_uids") or []

    assets = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]
    breakdowns = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept]
    tasks = [t for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]
    inventory_parts = [p for p in INVENTORY_PARTS if (p.get("department") or "Engineering") == dept]

    if scope_mode == "assets" and scope_asset_uids:
        uidset_raw = {str(u).strip() for u in scope_asset_uids if str(u).strip()}
        assets = [a for a in assets if _norm_str(a.get("uid")) in {_norm_str(u) for u in uidset_raw}]
        uidset, nameset = _asset_scope_sets(assets)
        breakdowns = _filter_records_by_asset_scope(breakdowns, uidset, nameset)
        tasks = _filter_records_by_asset_scope(tasks, uidset, nameset)
    elif scope_mode == "section" and scope_section:
        assets = [a for a in assets if _norm_str(a.get("section")) == _norm_str(scope_section)]
        uidset, nameset = _asset_scope_sets(assets)
        breakdowns = _filter_records_by_asset_scope(breakdowns, uidset, nameset)
        tasks = _filter_records_by_asset_scope(tasks, uidset, nameset)

    return dept, assets, breakdowns, tasks, inventory_parts


def _bucket_key_for_date(d: date, grain: str) -> str:
    grain = (grain or "daily").strip().lower()
    if grain == "weekly":
        y, w, _ = d.isocalendar()
        return f"{y}-W{int(w):02d}"
    if grain == "monthly":
        return d.strftime("%Y-%m")
    if grain == "quarterly":
        return f"{d.year}-Q{((d.month - 1) // 3) + 1}"
    if grain in ("biannually", "bi-annual", "biannual", "halfyear", "half-year"):
        return f"{d.year}-H{1 if d.month <= 6 else 2}"
    if grain in ("yearly", "annual", "annually"):
        return str(d.year)
    return d.strftime("%Y-%m-%d")


def _bucket_label_from_key(key: str, grain: str) -> str:
    grain = (grain or "daily").strip().lower()
    try:
        if grain == "weekly" and "-W" in key:
            return key.split("-")[1]
        if grain == "monthly":
            return datetime.strptime(key + "-01", "%Y-%m-%d").strftime("%b")
        if grain == "quarterly" and "-Q" in key:
            return key.split("-")[1]
        if grain.startswith("bi") and "-H" in key:
            return key.split("-")[1]
        if grain in ("yearly", "annual", "annually"):
            return key
        d = datetime.strptime(key, "%Y-%m-%d").date()
        return d.strftime("%b %d")
    except Exception:
        return key


def _bucket_sequence(start_d: date, end_d: date, grain: str) -> list[str]:
    grain = (grain or "daily").strip().lower()
    if end_d < start_d:
        start_d, end_d = end_d, start_d
    keys: list[str] = []
    if grain == "monthly":
        cur = date(start_d.year, start_d.month, 1)
        last = date(end_d.year, end_d.month, 1)
        while cur <= last:
            keys.append(_bucket_key_for_date(cur, grain))
            if cur.month == 12:
                cur = date(cur.year + 1, 1, 1)
            else:
                cur = date(cur.year, cur.month + 1, 1)
        return keys
    if grain == "quarterly":
        cur = date(start_d.year, ((start_d.month - 1)//3)*3 + 1, 1)
        while cur <= end_d:
            keys.append(_bucket_key_for_date(cur, grain))
            month = cur.month + 3
            year = cur.year + ((month - 1) // 12)
            month = ((month - 1) % 12) + 1
            cur = date(year, month, 1)
        return keys
    if grain in ("biannually", "bi-annual", "biannual", "halfyear", "half-year"):
        cur = date(start_d.year, 1 if start_d.month <= 6 else 7, 1)
        while cur <= end_d:
            keys.append(_bucket_key_for_date(cur, grain))
            if cur.month == 1:
                cur = date(cur.year, 7, 1)
            else:
                cur = date(cur.year + 1, 1, 1)
        return keys
    if grain in ("yearly", "annual", "annually"):
        return [str(y) for y in range(start_d.year, end_d.year + 1)]
    if grain == "weekly":
        cur = start_d - timedelta(days=start_d.weekday())
        while cur <= end_d:
            keys.append(_bucket_key_for_date(cur, grain))
            cur += timedelta(days=7)
        return keys
    cur = start_d
    while cur <= end_d:
        keys.append(_bucket_key_for_date(cur, grain))
        cur += timedelta(days=1)
    return keys


def _report_chart_series(export: dict, kind: str = "incidents", grain: str = "daily", year: int | None = None):
    dept, assets, breakdowns, tasks, inventory_parts = _resolve_report_scope(export)
    sd = parse_date_only(export.get("start_date") or "")
    ed = parse_date_only(export.get("end_date") or "")
    kind = (kind or "incidents").strip().lower()
    grain = (grain or "daily").strip().lower()

    if year:
        start_d = date(int(year), 1, 1)
        end_d = date(int(year), 12, 31)
    else:
        start_d = sd or date.today().replace(month=1, day=1)
        end_d = ed or date.today()
        if end_d < start_d:
            start_d, end_d = end_d, start_d

    if kind in ("downtime", "downtime_hours"):
        source = breakdowns
    elif kind in ("pm_completed", "pm", "maintenance"):
        source = [t for t in tasks if (t.get("status") or t.get("pm_status") or "").strip().lower() in ("completed", "done", "closed")]
    else:
        source = breakdowns

    daily: dict[str, float] = {}
    for rec in source:
        dt = _record_dt_for_chart(rec)
        if not dt:
            continue
        d = dt.date()
        if d < start_d or d > end_d:
            continue
        key = d.isoformat()
        if kind in ("downtime", "downtime_hours"):
            daily[key] = daily.get(key, 0.0) + float(_duration_hours_for_chart(rec) or 0.0)
        else:
            daily[key] = daily.get(key, 0.0) + 1.0

    buckets: dict[str, float] = {}
    for d_str, val in daily.items():
        try:
            d = datetime.strptime(d_str, "%Y-%m-%d").date()
        except Exception:
            continue
        bkey = _bucket_key_for_date(d, grain)
        buckets[bkey] = buckets.get(bkey, 0.0) + float(val or 0.0)

    ordered_keys = _bucket_sequence(start_d, end_d, grain)
    series = []
    for key in ordered_keys:
        value = float(buckets.get(key, 0.0) or 0.0)
        series.append({
            "key": key,
            "label": _bucket_label_from_key(key, grain),
            "value": round(value, 2),
            "count": int(round(value)),
        })

    all_years = []
    for r in list(breakdowns) + list(tasks):
        dt = _record_dt_for_chart(r)
        if dt:
            all_years.append(dt.year)
    if sd:
        all_years.append(sd.year)
    if ed:
        all_years.append(ed.year)
    years = sorted(set(all_years), reverse=True)
    quarter_panels = []
    half_panels = []
    if grain in ("quarterly", "biannually", "bi-annual", "biannual", "halfyear", "half-year") and year:
        monthly_buckets: dict[str, float] = {}
        for d_str, val in daily.items():
            try:
                d = datetime.strptime(d_str, "%Y-%m-%d").date()
            except Exception:
                continue
            mkey = _bucket_key_for_date(d, "monthly")
            monthly_buckets[mkey] = monthly_buckets.get(mkey, 0.0) + float(val or 0.0)
        if grain == "quarterly":
            for q in range(1, 5):
                q_start = date(int(year), (q - 1) * 3 + 1, 1)
                q_end = date(int(year), q * 3, 28) + timedelta(days=4)
                q_end = q_end.replace(day=1) - timedelta(days=1)
                q_keys = _bucket_sequence(q_start, q_end, "monthly")
                q_series = []
                for key in q_keys:
                    val = float(monthly_buckets.get(key, 0.0) or 0.0)
                    q_series.append({"key": key, "label": _bucket_label_from_key(key, "monthly"), "value": round(val, 2), "count": int(round(val))})
                quarter_panels.append({"quarter": f"Q{q}", "series": q_series})
        else:
            halves = (("H1", 1, 6), ("H2", 7, 12))
            for half_label, start_month, end_month in halves:
                h_start = date(int(year), start_month, 1)
                h_end = date(int(year), end_month, 28) + timedelta(days=4)
                h_end = h_end.replace(day=1) - timedelta(days=1)
                h_keys = _bucket_sequence(h_start, h_end, "monthly")
                h_series = []
                for key in h_keys:
                    val = float(monthly_buckets.get(key, 0.0) or 0.0)
                    h_series.append({"key": key, "label": _bucket_label_from_key(key, "monthly"), "value": round(val, 2), "count": int(round(val))})
                half_panels.append({"half": half_label, "series": h_series})
    return {"ok": True, "kind": kind, "grain": grain, "year": year, "years": years, "series": series, "quarter_panels": quarter_panels, "half_panels": half_panels, "start": start_d.isoformat(), "end": end_d.isoformat()}


def _series_peak_label(series: list[dict], value_key: str = "value") -> tuple[str, float]:
    if not series:
        return ("—", 0.0)
    peak = max(series, key=lambda x: float(x.get(value_key) or 0.0))
    return (str(peak.get("label") or "—"), float(peak.get(value_key) or 0.0))


def _draw_simple_series_chart(c, labels: list[str], values: list[float], x: float, y: float, w: float, h: float, title: str = "Trend"):
    if not labels:
        return y
    from reportlab.lib import colors
    c.saveState()
    c.setStrokeColor(colors.HexColor("#CBD5E1"))
    c.setLineWidth(0.6)
    c.roundRect(x, y - h, w, h, 6, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(colors.HexColor("#0F172A"))
    c.drawString(x + 10, y - 14, title)
    chart_x = x + 12
    chart_y = y - h + 28
    chart_w = w - 24
    chart_h = h - 46
    max_v = max([float(v or 0.0) for v in values] + [1.0])
    n = max(1, len(labels))
    gap = 6
    bar_w = max(8, (chart_w - (gap * (n - 1))) / n)
    c.setStrokeColor(colors.HexColor("#E2E8F0"))
    for i in range(5):
        ly = chart_y + (chart_h * i / 4.0)
        c.line(chart_x, ly, chart_x + chart_w, ly)
    for i, (lab, val) in enumerate(zip(labels, values)):
        bx = chart_x + i * (bar_w + gap)
        bh = 0 if max_v <= 0 else (chart_h * float(val or 0.0) / max_v)
        c.setFillColor(colors.HexColor("#6B57B6"))
        c.roundRect(bx, chart_y, bar_w, bh, 2, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#475569"))
        c.setFont("Helvetica", 7)
        c.drawCentredString(bx + (bar_w / 2), chart_y - 10, str(lab)[:8])
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(bx + (bar_w / 2), chart_y + bh + 3, f"{float(val or 0.0):g}")
    c.restoreState()
    return y - h - 10


def _range_label_for_chart_report(start_iso: str, end_iso: str) -> str:
    return f"{start_iso} to {end_iso}" if start_iso and end_iso else (start_iso or end_iso or "Selected period")

def _svg_palette(index: int) -> str:
    palette = ("#6B57B6", "#D9A942", "#0F766E", "#2563EB", "#DC2626", "#64748B")
    return palette[index % len(palette)]


def _svg_num(value) -> str:
    try:
        value = float(value or 0)
    except Exception:
        value = 0.0
    if abs(value - round(value)) < 0.0001:
        return str(int(round(value)))
    return f"{value:.1f}"


def _svg_y_label(value, prefix: str = "", suffix: str = "") -> str:
    return f"{prefix}{_svg_num(value)}{suffix}"


def _build_series_svg_chart(labels: list[str], datasets: list[dict], chart_type: str = "bar", stacked: bool = False, title: str = "", value_prefix: str = "", value_suffix: str = "", empty_label: str = "No data available for the selected period.") -> str:
    labels = [str(x or "") for x in (labels or [])]
    clean_sets = []
    for i, ds in enumerate(datasets or []):
        values = []
        for v in (ds.get("values") or []):
            try:
                values.append(float(v or 0))
            except Exception:
                values.append(0.0)
        if len(values) < len(labels):
            values.extend([0.0] * (len(labels) - len(values)))
        clean_sets.append({
            "label": str(ds.get("label") or f"Series {i+1}"),
            "values": values[:len(labels)],
            "color": ds.get("color") or _svg_palette(i),
        })

    width, height = 980, 300
    ml, mr, mt, mb = 60, 20, 26, 52
    plot_w = max(120, width - ml - mr)
    plot_h = max(120, height - mt - mb)

    if not labels or not clean_sets:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%" role="img" aria-label="Chart">'
            f'<rect x="0" y="0" width="{width}" height="{height}" rx="18" fill="#ffffff"/>'
            f'<text x="{width/2}" y="{height/2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#64748B">{html.escape(empty_label)}</text>'
            f'</svg>'
        )

    if stacked:
        max_value = max(sum(max(ds["values"][i], 0.0) for ds in clean_sets) for i in range(len(labels))) if labels else 0.0
    else:
        max_value = max((max(ds["values"] or [0.0]) for ds in clean_sets), default=0.0)
    max_value = max(max_value, 1.0) * 1.1

    chart_label = html.escape(title or "Chart")
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%" role="img" aria-label="{chart_label}">',
        f'<rect x="0" y="0" width="{width}" height="{height}" rx="18" fill="#ffffff"/>'
    ]
    if title:
        parts.append(f'<text x="{ml}" y="18" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#334155">{html.escape(title)}</text>')

    for step in range(5):
        yv = max_value * (4 - step) / 4.0
        y = mt + (plot_h * step / 4.0)
        parts.append(f'<line x1="{ml}" y1="{y:.2f}" x2="{ml + plot_w}" y2="{y:.2f}" stroke="#E2E8F0" stroke-width="1"/>')
        parts.append(f'<text x="{ml - 8}" y="{y + 4:.2f}" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="#64748B">{html.escape(_svg_y_label(yv, value_prefix, value_suffix))}</text>')

    parts.append(f'<line x1="{ml}" y1="{mt + plot_h:.2f}" x2="{ml + plot_w}" y2="{mt + plot_h:.2f}" stroke="#94A3B8" stroke-width="1.2"/>')

    n = len(labels)
    group_w = plot_w / max(n, 1)
    show_every = max(1, int((n + 11) / 12))

    if chart_type == "line":
        for ds in clean_sets:
            pts = []
            for i, val in enumerate(ds["values"]):
                x = ml + (i + 0.5) * group_w
                y = mt + plot_h - ((max(val, 0.0) / max_value) * plot_h)
                pts.append((x, y))
            if pts:
                poly = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
                parts.append(f'<polyline fill="none" stroke="{ds["color"]}" stroke-width="3" points="{poly}" stroke-linecap="round" stroke-linejoin="round"/>')
                for x, y in pts:
                    parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="3.5" fill="{ds["color"]}"/>')
    else:
        if stacked:
            bar_w = min(34.0, group_w * 0.5)
            for i in range(n):
                x = ml + (i + 0.5) * group_w - (bar_w / 2)
                cumulative = 0.0
                for ds in clean_sets:
                    val = max(ds["values"][i], 0.0)
                    h = (val / max_value) * plot_h
                    y = mt + plot_h - ((cumulative + val) / max_value) * plot_h
                    if h > 0:
                        parts.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{bar_w:.2f}" height="{h:.2f}" rx="5" fill="{ds["color"]}" opacity="0.92"/>')
                    cumulative += val
        else:
            inner_gap = 6.0
            bar_w = min(24.0, max(6.0, (group_w - inner_gap) / max(len(clean_sets), 1)))
            for i in range(n):
                total_w = len(clean_sets) * bar_w
                start_x = ml + (i + 0.5) * group_w - (total_w / 2)
                for j, ds in enumerate(clean_sets):
                    val = max(ds["values"][i], 0.0)
                    h = (val / max_value) * plot_h
                    y = mt + plot_h - h
                    x = start_x + (j * bar_w)
                    if h > 0:
                        parts.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{max(bar_w - 2.0, 4.0):.2f}" height="{h:.2f}" rx="4" fill="{ds["color"]}" opacity="0.92"/>')

    for i, lab in enumerate(labels):
        x = ml + (i + 0.5) * group_w
        if i % show_every == 0 or i == n - 1:
            parts.append(f'<text x="{x:.2f}" y="{mt + plot_h + 18:.2f}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#475569">{html.escape(str(lab)[:12])}</text>')

    legend_x = ml
    legend_y = height - 18
    for ds in clean_sets:
        parts.append(f'<rect x="{legend_x}" y="{legend_y - 9}" width="10" height="10" rx="2" fill="{ds["color"]}"/>')
        parts.append(f'<text x="{legend_x + 16}" y="{legend_y}" font-family="Arial, sans-serif" font-size="10" fill="#334155">{html.escape(ds["label"])}</text>')
        legend_x += 16 + min(max(len(ds["label"]) * 6, 48), 180)

    parts.append('</svg>')
    return "".join(parts)


def _attach_chart_export_svgs(payload: dict, report_kind: str = "breakdown") -> dict:
    payload = dict(payload or {})
    labels = list(payload.get("labels") or [])
    if report_kind == "maintenance":
        payload["main_chart_svg"] = _build_series_svg_chart(
            labels,
            [
                {"label": "PM", "values": payload.get("pm_values") or []},
                {"label": "CM", "values": payload.get("cm_values") or []},
            ],
            chart_type="bar",
            stacked=True,
            title=payload.get("subtitle") or payload.get("title") or "Maintenance distribution",
        )
        cost_sets = [
            {"label": "Actual Total", "values": payload.get("total_cost_values") or []},
            {"label": "VAT Amount", "values": payload.get("vat_values") or []},
        ]
        if payload.get("estimated_total_cost_values"):
            cost_sets.append({"label": "Estimated Total", "values": payload.get("estimated_total_cost_values") or []})
        payload["cost_chart_svg"] = _build_series_svg_chart(
            labels,
            cost_sets,
            chart_type="bar",
            stacked=False,
            title="Cost over selected period",
            value_prefix="KES ",
        )
    else:
        payload["main_chart_svg"] = _build_series_svg_chart(
            labels,
            [{"label": "Incidents", "values": payload.get("values") or []}],
            chart_type="line",
            title=payload.get("subtitle") or payload.get("title") or "Incident trend",
        )
        payload["cost_chart_svg"] = _build_series_svg_chart(
            labels,
            [
                {"label": "Total Cost", "values": payload.get("total_cost_values") or []},
                {"label": "VAT Amount", "values": payload.get("vat_values") or []},
            ],
            chart_type="bar",
            stacked=False,
            title="Cost over selected period",
            value_prefix="KES ",
        )
    return payload


def _browser_pdf_executable() -> str | None:
    env_candidates = [os.environ.get("EABC_BROWSER_PDF_BIN"), os.environ.get("CHROME_BIN"), os.environ.get("EDGE_BIN")]
    for item in env_candidates:
        if item and os.path.exists(item):
            return item
    for cmd in ("msedge", "chrome", "google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(cmd)
        if found:
            return found
    if os.name == "nt":
        win_candidates = [
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ]
        for item in win_candidates:
            if os.path.exists(item):
                return item
    return None


def _render_pdf_from_html(html_content: str, base_url: str | None = None):
    if WEASYPRINT_AVAILABLE:
        try:
            pdf_bytes = WeasyHTML(string=html_content, base_url=base_url).write_pdf()
            buf = io.BytesIO(pdf_bytes)
            buf.seek(0)
            return buf
        except Exception:
            pass

    browser_bin = _browser_pdf_executable()
    if not browser_bin:
        return None
    try:
        html_with_base = html_content
        if base_url and "<head>" in html_with_base and "<base " not in html_with_base:
            html_with_base = html_with_base.replace("<head>", f"<head><base href=\"{base_url}\">", 1)
        with tempfile.TemporaryDirectory(prefix="eabc_pdf_") as tmpdir:
            html_path = os.path.join(tmpdir, "report.html")
            pdf_path = os.path.join(tmpdir, "report.pdf")
            with open(html_path, "w", encoding="utf-8") as fp:
                fp.write(html_with_base)
            commands = [
                [browser_bin, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}", html_path],
                [browser_bin, "--headless", "--disable-gpu", "--print-to-pdf-no-header", f"--print-to-pdf={pdf_path}", html_path],
            ]
            for cmd in commands:
                try:
                    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90, check=False)
                    if result.returncode == 0 and os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0:
                        with open(pdf_path, "rb") as pf:
                            buf = io.BytesIO(pf.read())
                        buf.seek(0)
                        return buf
                except Exception:
                    continue
    except Exception:
        return None
    return None




def _report_print_default_grain(start_d: date | None, end_d: date | None) -> str:
    start_d = start_d or date.today()
    end_d = end_d or start_d
    days = max(1, (end_d - start_d).days + 1)
    if days > 730:
        return "yearly"
    if days > 180:
        return "quarterly"
    if days > 90:
        return "monthly"
    if days > 45:
        return "weekly"
    return "daily"


def _metric_exec_note(metric_key: str, label: str, value, analysis: dict, category_key: str = "") -> str:
    kpis = analysis.get("kpis") or {}
    try:
        num_value = float(value)
    except Exception:
        num_value = None

    if metric_key == "availability":
        val = _safe_float(kpis.get("availability_pct"), None)
        if val is None:
            return "Availability could not be calculated because no reliable uptime baseline was available in the selected window."
        if val >= 95:
            return f"Availability is operating above the 95% control target at {val:.1f}%, which points to strong uptime performance in this reporting window."
        return f"Availability is at {val:.1f}%, below the 95% control target, so the downtime drivers in this report need corrective action priority."
    if metric_key == "mtbf":
        val = _safe_float(kpis.get("mtbf_hours"), None)
        if val is None:
            return "No failure interval could be calculated because no incidents were logged in the selected period."
        return f"MTBF is {val:.1f} hours, meaning the current operation averages that interval between recorded failures. Higher is better."
    if metric_key == "mttr":
        val = _safe_float(kpis.get("mttr_hours"), None)
        if val is None:
            return "MTTR is not available because there were no resolved incidents with usable repair-duration data in the period."
        return f"MTTR is {val:.1f} hours, which reflects the average time required to restore the affected equipment after a breakdown. Lower is better."
    if metric_key == "downtime":
        val = _safe_float(kpis.get("downtime_hours"), 0.0) or 0.0
        return f"Unscheduled downtime totals {val:.1f} hours in the selected window. This is the direct uptime loss carried into availability and cost exposure."
    if metric_key == "failure_rate":
        val = _safe_float(kpis.get("failure_rate_per_day"), 0.0) or 0.0
        return f"Failure rate stands at {val:.2f} incidents per day across the selected scope, showing how frequently interruptions are being recorded."
    if metric_key == "health_score":
        val = _safe_float(kpis.get("health_score"), None)
        if val is None:
            return "Asset health score was not produced because the uptime and repair inputs required for the score were incomplete."
        return f"Asset health score is {val:.1f}/100. It combines availability strength with MTTR pressure to give a practical condition signal for leadership review."
    if metric_key == "incidents":
        val = int(kpis.get("incidents") or 0)
        return f"A total of {val} incident(s) were logged in the reporting window. This is the raw event count behind the reliability and hotspot analysis."
    if metric_key == "loss_estimate":
        val = _safe_float(kpis.get("loss_estimate"), 0.0) or 0.0
        return f"Estimated production loss is {_kes_label(val)}, derived from logged downtime hours multiplied by the configured downtime cost rate."
    if metric_key == "pm_adherence":
        val = _safe_float(kpis.get("pm_adherence_pct"), None)
        if val is None:
            return "PM adherence could not be calculated because no scheduled maintenance tasks were found in the selected period."
        return f"PM adherence is {val:.1f}%, measuring how much of the scheduled maintenance plan was actually completed in the selected window."
    if metric_key == "sop_validation":
        val = _safe_float(kpis.get("sop_validation_pct"), None)
        if val is None:
            return "SOP validation score is unavailable because there were no completed maintenance records to assess against timing discipline."
        return f"SOP validation score is {val:.1f}%, using execution discipline as a proxy for how consistently the maintenance process is being followed."
    if metric_key == "audit_readiness":
        val = _safe_float(kpis.get("audit_readiness_pct"), None)
        if val is None:
            return "Audit readiness was not calculated because the system did not find enough maintenance execution data in the selected period."
        return f"Audit readiness is {val:.1f}%, combining completion, timeliness, and overdue exposure into one management control score."
    if metric_key == "technician_ranking":
        rows = analysis.get("technician_rankings") or []
        if not rows:
            return "No technician ranking could be prepared because there were no attributable maintenance records in the selected period."
        lead = rows[0]
        return f"Technician ranking is led by {lead.get('technician') or 'the top recorded technician'}, based on completed workload and execution quality in the selected period."
    if metric_key == "critical_gaps":
        count = len(analysis.get("critical_gaps") or [])
        return f"Critical audit gaps total {count}. These are the highest-priority control weaknesses identified from the current maintenance data set."
    if metric_key == "late_tasks":
        val = int(kpis.get("late_tasks") or 0)
        return f"Late or overdue PM tasks total {val}. This backlog is a direct control risk because it pushes preventable work past the planned window."
    if metric_key == "inventory_value":
        val = _safe_float(kpis.get("inventory_value"), 0.0) or 0.0
        return f"Inventory value in scope is {_kes_label(val)}, representing the current working capital tied up in spare parts and related stock."
    if metric_key == "turnover":
        val = _safe_float(kpis.get("turnover_ratio"), None)
        if val is None:
            return "Stock turnover ratio could not be calculated because issue or stock movement data was not sufficient in the selected window."
        return f"Stock turnover ratio is {val:.2f}, indicating how actively the spare-parts holding is moving relative to current stock value."
    if metric_key == "dead_stock":
        count = int(kpis.get("dead_stock") or 0)
        return f"Dead stock count is {count}. These are items with stock value but no meaningful movement signal, so they should be reviewed for cleanup or redeployment."
    if metric_key == "stockouts":
        count = int(kpis.get("stockouts") or 0)
        return f"Critical stock-outs total {count}. Each stock-out increases the risk of longer repair time and missed maintenance execution."
    if metric_key == "consumption_vs_proc":
        val = kpis.get("consumption_vs_proc")
        return f"Consumption versus procurement currently reads {val if val not in (None, '') else '—'}, showing how incoming stock is tracking against actual usage pressure."
    if metric_key == "vendor_reliability":
        val = _safe_float(kpis.get("vendor_reliability_pct"), None)
        if val is None:
            return "Vendor reliability rating is not available because supplier performance scoring has not yet been fully captured in the current data."
        return f"Vendor reliability rating is {val:.1f}%, giving a directional view of supplier consistency in supporting stores and maintenance execution."
    if metric_key == "value_realized":
        val = _safe_float(kpis.get("value_realized"), 0.0) or 0.0
        return f"Total value realized stands at {_kes_label(val)}, representing the benefit that has already been captured and recorded against strategic actions."
    if metric_key == "roi_multiplier":
        val = _safe_float(kpis.get("roi_multiplier"), None)
        if val is None:
            return "Portfolio ROI multiplier is not available because investment and verified savings data are still incomplete."
        return f"Portfolio ROI multiplier is {val:.2f}x, showing the return generated for each unit of recorded investment."
    if metric_key == "life_extension":
        val = _safe_float(kpis.get("life_extension_years"), None)
        if val is None:
            return "Asset life extension is not available because the system does not yet hold validated before-and-after life assumptions for the selected initiatives."
        return f"Average asset life extension is {val:.1f} year(s), reflecting the projected operating life preserved through the selected interventions."
    if metric_key == "pillar_breakdown":
        rows = analysis.get("pillar_breakdown") or []
        if not rows:
            return "Strategic pillar breakdown is not available because the report has no scored project portfolio in the selected period."
        lead = rows[0]
        return f"The leading strategic pillar is {lead.get('pillar') or 'the top-ranked pillar'} at {lead.get('score') or 0}%, showing where the strongest realized value is currently concentrated."
    if metric_key == "breakeven":
        val = _safe_float(kpis.get("breakeven_months"), None)
        if val is None:
            return "Break-even timing is not yet available because investment and savings records are not complete enough for payback measurement."
        return f"Investment break-even is estimated at {val:.1f} month(s), which sets the expected payback horizon for the recorded initiative mix."
    if metric_key == "projects":
        count = int(kpis.get("projects") or 0)
        return f"Project-by-project performance currently covers {count} strategic initiative(s), giving leadership a direct view of where value is or is not being realized."

    if category_key == "asset_reliability":
        return "This selected reliability metric feeds the operating condition picture for the chosen assets, section, or department."
    if category_key == "breakdown_analytics":
        return "This selected breakdown metric highlights the event pattern, loss exposure, or root-cause concentration for the chosen reporting scope."
    if category_key == "maintenance_compliance":
        return "This selected maintenance metric shows whether planned work is being executed with the required control and timing discipline."
    if category_key == "inventory_spares":
        return "This selected stores metric explains spare-parts exposure, stock health, and supply support for execution readiness."
    if category_key == "strategic_roi":
        return "This selected strategy metric indicates whether the improvement portfolio is converting action into measurable business value."
    return f"{label} is part of the selected management scorecard for this report window."


def _build_report_print_charts(export: dict, analysis: dict) -> list[dict]:
    category_key = (export.get("category_key") or "").strip()
    start_d = analysis.get("start") or date.today()
    end_d = analysis.get("end") or start_d
    grain = (request.args.get("trend_grain") or request.args.get("grain") or _report_print_default_grain(start_d, end_d)).strip().lower()
    year_raw = (request.args.get("trend_year") or request.args.get("year") or "").strip()
    year = None
    try:
        year = int(year_raw) if year_raw else None
    except Exception:
        year = None
    if year is None and grain in ("quarterly", "biannually", "biannual", "bi-annual", "halfyear", "half-year", "yearly", "annual", "annually"):
        year = int((end_d or start_d).year)

    sections = []

    def _add_series_chart(title: str, payload: dict, dataset_label: str, *, chart_type: str = "bar", note: str = "", value_prefix: str = "", value_suffix: str = ""):
        series = payload.get("series") or []
        if not series:
            return
        labels = [str(x.get("label") or "") for x in series]
        values = []
        for x in series:
            try:
                values.append(float(x.get("value") or x.get("count") or 0.0))
            except Exception:
                values.append(0.0)
        sections.append({
            "title": title,
            "note": note,
            "svg": _build_series_svg_chart(
                labels,
                [{"label": dataset_label, "values": values}],
                chart_type=chart_type,
                title=title,
                value_prefix=value_prefix,
                value_suffix=value_suffix,
            ),
        })

    def _add_simple_chart(title: str, labels: list, values: list, *, chart_type: str = "bar", note: str = "", value_prefix: str = "", value_suffix: str = ""):
        clean_labels = [str(x or "") for x in (labels or [])]
        clean_values = []
        for v in (values or []):
            try:
                clean_values.append(float(v or 0.0))
            except Exception:
                clean_values.append(0.0)
        if not clean_labels:
            return
        sections.append({
            "title": title,
            "note": note,
            "svg": _build_series_svg_chart(
                clean_labels,
                [{"label": title, "values": clean_values}],
                chart_type=chart_type,
                title=title,
                value_prefix=value_prefix,
                value_suffix=value_suffix,
            ),
        })

    if category_key == "asset_reliability":
        payload = _report_chart_series(export, kind="downtime", grain=grain, year=year)
        _add_series_chart("Downtime Trend", payload, "Downtime (hrs)", chart_type="line", note="Logged downtime pattern across the selected report window.", value_suffix="h")
        top_assets = analysis.get("top_assets") or []
        if top_assets:
            _add_simple_chart(
                "Top Assets by Downtime",
                [name for name, _ in top_assets],
                [float(meta.get("downtime_hours") or 0.0) for _, meta in top_assets],
                note="Highest downtime contributors in the selected scope.",
                value_suffix="h",
            )
        availability_rows = analysis.get("availability_by_section") or []
        if availability_rows:
            _add_simple_chart(
                "Availability by Section",
                [row.get("section") or "Section" for row in availability_rows],
                [float(row.get("availability_pct") or 0.0) for row in availability_rows],
                note="Section-level uptime comparison derived from recorded downtime.",
                value_suffix="%",
            )

    elif category_key == "breakdown_analytics":
        payload = _report_chart_series(export, kind="incidents", grain=grain, year=year)
        _add_series_chart("Incidents Trend", payload, "Incidents", chart_type="line", note="Recorded incident pattern across the selected report window.")
        causes = analysis.get("top_causes") or []
        if causes:
            _add_simple_chart(
                "Root Cause Distribution",
                [cause for cause, _ in causes],
                [int(count or 0) for _, count in causes],
                note="Most frequent root causes in the selected scope.",
            )
        top_assets = analysis.get("top_assets") or []
        if top_assets:
            _add_simple_chart(
                "Top Asset Hotspots",
                [name for name, _ in top_assets],
                [float(meta.get("downtime_hours") or 0.0) for _, meta in top_assets],
                note="Assets driving the largest downtime burden in the selected period.",
                value_suffix="h",
            )

    elif category_key == "maintenance_compliance":
        payload = _report_chart_series(export, kind="pm_completed", grain=grain, year=year)
        _add_series_chart("PM Completions Trend", payload, "Completed PM", chart_type="line", note="Completed preventive maintenance tasks over the selected reporting period.")
        pm_status = analysis.get("pm_status_counts") or {}
        if pm_status:
            _add_simple_chart(
                "PM Task Status",
                ["Scheduled", "Completed", "Open", "Overdue"],
                [
                    int(pm_status.get("scheduled") or 0),
                    int(pm_status.get("completed") or 0),
                    int(pm_status.get("open") or 0),
                    int(pm_status.get("overdue") or 0),
                ],
                note="Execution-state split for the maintenance plan in the selected window.",
            )
        tech_rows = analysis.get("technician_rankings") or []
        if tech_rows:
            _add_simple_chart(
                "Technician Completion Ranking",
                [row.get("technician") or "Unassigned" for row in tech_rows[:6]],
                [int(row.get("completed") or 0) for row in tech_rows[:6]],
                note="Completed task count by technician based on current maintenance records.",
            )

    elif category_key == "inventory_spares":
        payload = _report_chart_series(export, kind="incidents", grain=grain, year=year)
        _add_series_chart("Breakdown Demand Signal", payload, "Breakdowns", chart_type="line", note="Breakdown pattern used as a demand signal for spares planning.")
        top_items = analysis.get("inventory_top_value") or []
        if top_items:
            _add_simple_chart(
                "Top Items by Inventory Value",
                [row.get("name") or "Item" for row in top_items[:8]],
                [float(row.get("value") or 0.0) for row in top_items[:8]],
                note="Largest spare-parts value concentrations in the selected scope.",
                value_prefix="KES ",
            )
        _add_simple_chart(
            "Stock Risk Snapshot",
            ["Stock-outs", "Dead Stock", "Items with Price"],
            [
                int((analysis.get("kpis") or {}).get("stockouts") or 0),
                int((analysis.get("kpis") or {}).get("dead_stock") or 0),
                int((analysis.get("data_quality") or {}).get("inventory_items_with_price") or 0),
            ],
            note="Quick stores risk view combining availability risk and pricing coverage.",
        )

    elif category_key == "strategic_roi":
        payload = _report_chart_series(export, kind="downtime", grain=grain, year=year)
        _add_series_chart("Downtime Trend", payload, "Downtime (hrs)", chart_type="bar", note="Reliability loss pattern used as the strategic value baseline.", value_suffix="h")
        projects = analysis.get("project_candidates") or []
        if projects:
            _add_simple_chart(
                "Top Value Recovery Opportunities",
                [row.get("asset") or row.get("project") or "Project" for row in projects[:6]],
                [float(row.get("estimated_loss") or 0.0) for row in projects[:6]],
                note="Estimated loss concentration showing where improvement action can recover the most value.",
                value_prefix="KES ",
            )

    return sections[:4]


def _enrich_report_analysis_for_print(export: dict, analysis: dict) -> dict:
    category_key = (export.get("category_key") or "").strip()
    metric_insights = []
    for card in (analysis.get("selected_metric_cards") or []):
        metric_insights.append({
            "key": card.get("key") or "",
            "label": card.get("label") or metric_label(card.get("key") or "", category_key),
            "value": card.get("value") if card.get("value") not in (None, "") else "—",
            "detail": _metric_exec_note(card.get("key") or "", card.get("label") or "Metric", card.get("value"), analysis, category_key),
        })
    analysis["metric_insights"] = metric_insights
    analysis["print_chart_sections"] = _build_report_print_charts(export, analysis)
    return analysis


def _render_report_pdf_buffer(export_row: dict):
    ctx, view_tpl = _build_report_view_context(export_row, print_mode=True)
    html_content = render_template(view_tpl, **ctx)
    return _render_pdf_from_html(html_content, base_url=request.url_root)

def _build_report_view_context(export: dict, print_mode: bool = False):
    ctx = base_ctx("reports")

    export_format = "pdf"
    if (export.get("filename") or "").lower().endswith(".xlsx"):
        export_format = "xlsx"
    elif (export.get("filename") or "").lower().endswith(".csv"):
        export_format = "csv"

    pages_label = "—"
    if export_format == "pdf":
        pages_label = "—"

    ctx.update(export={
        "id": export.get("id"),
        "status": export.get("status") or "READY",
        "category_key": export.get("category_key") or export.get("category") or "",
        "report_title": export.get("name"),
        "name": export.get("name"),
        "category": export.get("category"),
        "department": export.get("department"),
        "generated_for": export.get("generated_for") or export.get("scope_section") or export.get("department"),
        "scope_mode": export.get("scope_mode") or "department",
        "scope_section": export.get("scope_section") or "",
        "metrics": export.get("metrics") or [],
        "metric_labels": export.get("metric_labels") or [metric_label(m, export.get("category_key") or "") for m in (export.get("metrics") or [])],
        "email_status": export.get("email_status"),
        "format": export_format,
        "filename": export.get("filename") or (export.get("name", "report") + f".{export_format}"),
        "file_size_label": f"{export.get('file_size_mb')} MB" if export.get("file_size_mb") is not None else "—",
        "pages_label": pages_label,
        "generated_label": format_report_timestamp(export.get("created_at"), export.get("date")),
        "download_url": export.get("download_url"),
        "start_date": export.get("start_date"),
        "end_date": export.get("end_date"),
        "user_name": export.get("user_name") or base_ctx("reports")["current_user_name"],
    })

    ctx["rid"] = export.get("id")
    dept = (export.get("department") or get_current_department() or "Engineering").strip() or "Engineering"
    sd = export.get("start_date")
    ed = export.get("end_date")
    metrics = export.get("metrics") or []

    scope_mode = (export.get("scope_mode") or "assets").strip().lower()
    scope_section = (export.get("scope_section") or "").strip()
    scope_asset_uids = export.get("scope_asset_uids") or []

    assets = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]
    breakdowns = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept]
    tasks = [t for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]
    inventory_parts = [p for p in INVENTORY_PARTS if (p.get("department") or "Engineering") == dept]

    if scope_mode == "assets" and scope_asset_uids:
        uidset_raw = {str(u).strip() for u in scope_asset_uids if str(u).strip()}
        assets = [a for a in assets if _norm_str(a.get("uid")) in {_norm_str(u) for u in uidset_raw}]
        uidset, nameset = _asset_scope_sets(assets)
        breakdowns = _filter_records_by_asset_scope(breakdowns, uidset, nameset)
        tasks = _filter_records_by_asset_scope(tasks, uidset, nameset)
    elif scope_mode == "section" and scope_section:
        assets = [a for a in assets if _norm_str(a.get("section")) == _norm_str(scope_section)]
        uidset, nameset = _asset_scope_sets(assets)
        breakdowns = _filter_records_by_asset_scope(breakdowns, uidset, nameset)
        tasks = _filter_records_by_asset_scope(tasks, uidset, nameset)

    scope_target = export.get("generated_for") or export.get("scope_section") or export.get("department")
    if scope_mode == "assets" and assets:
        names = [a.get("asset_name") or a.get("asset_id") or "Asset" for a in assets[:5]]
        scope_target = ", ".join(names)
    elif scope_mode == "section" and scope_section:
        scope_target = scope_section
    else:
        scope_target = get_scope_unit_display(dept)
    ctx["export"]["scope_target"] = scope_target
    ctx["export"]["scope_mode"] = scope_mode

    center_kpis = compute_reports_center_kpis(dept)
    analysis = _analyze_report(
        category_key=export.get("category_key") or "",
        metrics=metrics,
        start_date=sd,
        end_date=ed,
        assets=assets,
        breakdowns=breakdowns,
        tasks=tasks,
        inventory_parts=inventory_parts,
        kpis=center_kpis,
    )
    if print_mode:
        analysis = _enrich_report_analysis_for_print(export, analysis)
    ctx["analysis"] = analysis

    category_key = export.get("category_key")
    ctx["print_mode"] = bool(print_mode)
    if print_mode and category_key == "strategic_roi":
        grain = (request.args.get("trend_grain") or "quarterly").strip().lower()
        year_raw = (request.args.get("trend_year") or "").strip()
        try:
            trend_year = int(year_raw) if year_raw else int((analysis.get("end") or analysis.get("start") or date.today()).year)
        except Exception:
            trend_year = int((analysis.get("end") or analysis.get("start") or date.today()).year)
        trend_payload = _report_chart_series(export, kind="downtime", grain=grain, year=trend_year)
        analysis["trend_chart"] = trend_payload
        analysis["trend_chart_svg"] = _build_series_svg_chart(
            [str(x.get("label") or "") for x in (trend_payload.get("series") or [])],
            [{"label": "Downtime (hrs)", "values": [float(x.get("value") or 0.0) for x in (trend_payload.get("series") or [])]}],
            chart_type="bar",
            title="Trend of downtime hours across the selected reporting window.",
            value_suffix="h",
        )

    mapped_categories = ("asset_reliability", "breakdown_analytics", "maintenance_compliance", "inventory_spares", "strategic_roi")
    if print_mode:
        specific_print_tpl = f"reports/reports_print_{category_key}.html" if category_key else ""
        specific_print_abs = os.path.join(app.template_folder or "templates", specific_print_tpl) if specific_print_tpl else ""
        view_tpl = specific_print_tpl if specific_print_tpl and os.path.exists(specific_print_abs) else "reports/report_print.html"
    elif category_key in mapped_categories:
        view_tpl = f"reports/reports_view_{category_key}.html"
    else:
        view_tpl = "reports/reports_generate_success.html"
    return ctx, view_tpl


@app.post("/reports/<report_id>/delete")
def reports_delete(report_id):
    dept = get_current_department()
    idx = next((i for i, row in enumerate(REPORT_EXPORTS) if str(row.get("id")) == str(report_id) and (row.get("department") or "Engineering") == dept), None)
    if idx is None:
        abort(404)

    removed = REPORT_EXPORTS.pop(idx)
    filenames = set()
    if removed.get("filename"):
        filenames.add(str(removed.get("filename")))
    for fname in (removed.get("files") or {}).values():
        if fname:
            filenames.add(str(fname))

    for fname in filenames:
        try:
            abs_path = os.path.join(REPORT_EXPORT_DIR, fname)
            if os.path.exists(abs_path):
                os.remove(abs_path)
        except Exception:
            pass

    _save_store_from_memory()
    push_notification(
        "Report deleted",
        f"{removed.get('name') or 'Report'} was removed from the reports register.",
        "warning",
        href=url_for("reports_center"),
        module="reports",
    )
    flash("Report deleted.", "success")
    return redirect(request.form.get("next") or request.referrer or url_for("reports_center"))


# -------------------------
# REPORTS: DOWNLOAD (optional helper)
# -------------------------
@app.get("/reports/export/<rid>/chart_data")
def reports_export_chart_data(rid):
    """Return aggregated timeline data for report charts (used by HTML dropdowns)."""
    export = next((r for r in REPORT_EXPORTS if str(r.get("id")) == str(rid)), None)
    if not export:
        return jsonify({"ok": False, "error": "NOT_FOUND"}), 404

    grain = (request.args.get("grain") or "daily").strip().lower()
    kind = (request.args.get("kind") or "incidents").strip().lower()
    year_raw = (request.args.get("year") or "").strip()
    try:
        year = int(year_raw) if year_raw else None
    except Exception:
        year = None
    return jsonify(_report_chart_series(export, kind=kind, grain=grain, year=year))

@app.get("/reports/download/<report_id>", endpoint="reports_download")
def reports_download(report_id):
    """Download the generated report file (PDF/XLSX/CSV).
    We do NOT render HTML "print" templates because printing HTML varies across browsers
    and was breaking layouts. The source of truth is the generated export file.
    """
    dept = get_current_department()
    r = next((x for x in REPORT_EXPORTS if x.get("id") == report_id), None)
    if not r or (r.get("department") or "Engineering") != dept:
        abort(404)

    filename = (r.get("filename") or "").strip()
    if not filename:
        # Backwards compatibility: if older records only had download_url
        # attempt to redirect to static url.
        if r.get("download_url"):
            return redirect(r["download_url"])
        abort(404)

    abs_path = os.path.join(REPORT_EXPORT_DIR, filename)
    if not os.path.exists(abs_path):
        abort(404)

    ext = os.path.splitext(filename)[1].lower()
    mimetype = {
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".csv": "text/csv",
    }.get(ext, "application/octet-stream")

    # Nice download name (keep original file extension)
    safe_name = re.sub(r"[^A-Za-z0-9 _\-\.]+", "", (r.get("name") or "Opsloom Report")).strip()
    if not safe_name:
        safe_name = "Opsloom Report"
    download_name = f"{safe_name}{ext}"

    return send_file(abs_path, as_attachment=True, download_name=download_name, mimetype=mimetype)

# -------------------------
# REPORTS: EXPORT (generate on demand for any existing report)
# -------------------------
@app.get("/reports/export/<report_id>/<fmt>", endpoint="reports_export")
def reports_export(report_id, fmt):
    """Generate and download a report export (pdf/xlsx/csv) for an existing report ID.

    Rules for this route:
    - PDF must come from the same printable HTML view users see in Print Preview whenever possible.
    - XLSX must be structured, styled, and readable without manual column resizing.
    - CSV must always succeed with a stable tabular dataset.
    """
    dept = get_current_department()
    r = next((x for x in REPORT_EXPORTS if str(x.get("id")) == str(report_id)), None)
    if not r or (r.get("department") or "Engineering") != dept:
        abort(404)

    fmt = (fmt or "").lower().strip()
    if fmt not in ("pdf", "xlsx", "csv"):
        abort(404)

    job_id = (request.args.get("job_id") or request.form.get("job_id") or "").strip() or None

    files = r.get("files") or {}
    if isinstance(files, dict):
        files = dict(files)
    else:
        files = {}
    if r.get("filename") and r.get("format"):
        f0 = str(r.get("format")).lower()
        if f0 in ("pdf", "xlsx", "csv") and f0 not in files:
            files[f0] = r.get("filename")
    r["files"] = files

    inline = (request.args.get("inline") or "").strip().lower() in ("1", "true", "yes")

    category = (r.get("category_key") or r.get("category") or "").strip() or "breakdown_analytics"
    start_date = (r.get("start_date") or "").strip()
    end_date = (r.get("end_date") or "").strip()
    report_name = (r.get("name") or _default_report_name(category, start_date, end_date)).strip()

    assets = [a for a in ASSETS if (a.get("department") or "Engineering") == dept]
    breakdowns = [b for b in BREAKDOWNS if (b.get("department") or "Engineering") == dept]
    tasks = [t for t in MAINTENANCE_TASKS if (t.get("department") or "Engineering") == dept]
    inventory_parts = [p for p in INVENTORY_PARTS if (p.get("department") or "Engineering") == dept]

    scope_mode = (r.get("scope_mode") or "assets").strip().lower()
    if scope_mode not in ("assets", "section", "department"):
        scope_mode = "assets"

    if scope_mode == "assets":
        scope_asset_uids = r.get("scope_asset_uids") or []
        if scope_asset_uids:
            uidset_raw = {str(u).strip() for u in scope_asset_uids if str(u).strip()}
            norm_uids = {_norm_str(u) for u in uidset_raw}
            assets = [a for a in assets if _norm_str(a.get("uid")) in norm_uids]
            uidset, nameset = _asset_scope_sets(assets)
            breakdowns = _filter_records_by_asset_scope(breakdowns, uidset, nameset)
            tasks = _filter_records_by_asset_scope(tasks, uidset, nameset)
    elif scope_mode == "section":
        sec = (r.get("scope_section") or "").strip()
        if sec:
            assets = [a for a in assets if _norm_str(a.get("section")) == _norm_str(sec)]
            uidset, nameset = _asset_scope_sets(assets)
            breakdowns = _filter_records_by_asset_scope(breakdowns, uidset, nameset)
            tasks = _filter_records_by_asset_scope(tasks, uidset, nameset)

    kpis = compute_reports_center_kpis(dept)
    analysis = _analyze_report(category, r.get("metrics") or [], start_date, end_date, assets, breakdowns, tasks, inventory_parts, kpis)

    _report_progress_update(job_id, 30, "Compiling report datasets")

    _safe_makedirs(REPORT_EXPORT_DIR)
    filename = f"report_{report_id}.{fmt}"
    abs_path = os.path.join(REPORT_EXPORT_DIR, filename)

    def _safe_download_name(ext: str) -> str:
        base = re.sub(r"[^A-Za-z0-9 _\-\.]+", "", report_name).strip() or "Opsloom Report"
        return f"{base}.{ext}"

    def _safe_float(value, default=0.0):
        try:
            if value in (None, ""):
                return float(default)
            return float(value)
        except Exception:
            return float(default)

    def _safe_text(value):
        if value is None:
            return ""
        if isinstance(value, (list, tuple, set)):
            return ", ".join(str(x) for x in value if str(x).strip())
        if isinstance(value, dict):
            return json.dumps(value, ensure_ascii=False)
        return str(value)

    def _xls_autofit(sheet, min_width=12, max_width=60):
        from openpyxl.utils import get_column_letter
        for idx, col_cells in enumerate(sheet.columns, start=1):
            max_len = 0
            for cell in col_cells:
                value = cell.value
                if value is None:
                    continue
                lines = str(value).splitlines() or [""]
                cell_len = max(len(line) for line in lines)
                if cell_len > max_len:
                    max_len = cell_len
            sheet.column_dimensions[get_column_letter(idx)].width = max(min_width, min(max_width, max_len + 3))

    def _style_table(ws, header_row=1, freeze_cell="A2"):
        from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
        fill_header = PatternFill("solid", fgColor="0F172A")
        fill_section = PatternFill("solid", fgColor="EAF0FF")
        fill_meta = PatternFill("solid", fgColor="EEF2FF")
        thin = Side(style="thin", color="D6DCE5")
        border = Border(left=thin, right=thin, top=thin, bottom=thin)
        center = Alignment(vertical="center", horizontal="center")
        wrap = Alignment(vertical="top", wrap_text=True)
        left = Alignment(vertical="center", horizontal="left", wrap_text=True)
        for row in ws.iter_rows():
            for cell in row:
                cell.border = border
                cell.alignment = wrap
        for cell in ws[header_row]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = fill_header
            cell.alignment = center
        for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 10)):
            for cell in row:
                if cell.row != header_row and cell.column <= 2 and cell.value in ("Report", "Category", "Department", "Range", "Scope", "Generated", "Metrics", "Scope Mode"):
                    cell.font = Font(bold=True)
                    cell.fill = fill_meta
                    cell.alignment = left
        ws.freeze_panes = freeze_cell
        ws.auto_filter.ref = ws.dimensions

    if fmt == "pdf":
        _report_progress_update(job_id, 55, "Rendering printable HTML to PDF")
        ctx, view_tpl = _build_report_view_context(r, print_mode=True)
        html_content = render_template(view_tpl, **ctx)
        if inline:
            return render_template(view_tpl, **ctx)
        pdf_buf = _render_pdf_from_html(html_content, base_url=request.url_root)
        if pdf_buf:
            with open(abs_path, "wb") as fp:
                fp.write(pdf_buf.getvalue())
        else:
            # Last-resort fallback only if HTML→PDF engine is unavailable.
            if REPORTLAB_AVAILABLE:
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas
                c = canvas.Canvas(abs_path, pagesize=A4)
                _build_report_pdf_guarded(
                    c=c,
                    report_name=report_name,
                    category_key=category,
                    category_title=_report_category_title(category),
                    department=dept,
                    start_date=start_date,
                    end_date=end_date,
                    generated_for=(r.get("generated_for") or r.get("scope_section") or ""),
                    section=(r.get("scope_section") or "—"),
                    asset_uid=(r.get("asset_uid") or ""),
                    assets=assets,
                    breakdowns=breakdowns,
                    tasks=tasks,
                    inventory_parts=inventory_parts,
                    metrics=r.get("metrics") or [],
                    kpis=kpis,
                    include_cover=True,
                    reported_by=(r.get("user_name") or base_ctx("reports")["current_user_name"]),
                )
                c.save()
            else:
                abort(500)

    elif fmt == "csv":
        _report_progress_update(job_id, 55, "Building CSV export")
        selected_cards = analysis.get("selected_metric_cards") or []
        top_causes = analysis.get("top_causes") or []
        top_assets = analysis.get("top_assets") or []
        top_inventory = analysis.get("inventory_top_value") or []
        action_plan = analysis.get("action_plan") or []

        with open(abs_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["Report", report_name])
            writer.writerow(["Category", _report_category_title(category)])
            writer.writerow(["Department", report_department_display(dept)])
            writer.writerow(["Range", f"{start_date} to {end_date}"])
            writer.writerow(["Scope Mode", scope_mode.title()])
            writer.writerow(["Scope", _safe_text(r.get("generated_for") or r.get("scope_section") or report_department_display(dept))])
            writer.writerow(["Generated", datetime.now().isoformat(timespec="seconds")])
            writer.writerow(["Metrics", ", ".join([metric_label(m, category) for m in (r.get("metrics") or [])])])
            writer.writerow([])

            writer.writerow([f"{_report_category_title(category)} Metrics"])
            writer.writerow(["Metric", "Value", "Insight"])
            if selected_cards:
                for card in selected_cards:
                    writer.writerow([
                        card.get("label") or metric_label(card.get("key") or "", category),
                        _safe_text(card.get("value") if card.get("value") not in (None, "") else "—"),
                        _safe_text(_metric_exec_note(card.get("key") or "", card.get("label") or "Metric", card.get("value"), analysis, category)),
                    ])
            else:
                for k, v in (analysis.get("kpis") or {}).items():
                    writer.writerow([k, _safe_text(v), ""])
            writer.writerow([])

            if top_causes:
                writer.writerow(["Top Causes"])
                writer.writerow(["Cause", "Count"])
                for cause, cnt in top_causes:
                    writer.writerow([_safe_text(cause), _safe_text(cnt)])
                writer.writerow([])

            if top_assets:
                writer.writerow(["Top Assets"])
                writer.writerow(["Asset", "Incidents", "Downtime (hrs)"])
                for name, meta in top_assets:
                    writer.writerow([_safe_text(name), _safe_text((meta or {}).get("incidents")), _safe_text((meta or {}).get("downtime_hours"))])
                writer.writerow([])

            if top_inventory:
                writer.writerow(["Top Inventory by Value"])
                writer.writerow(["Item", "Quantity", "Unit Cost", "Value"])
                for row in top_inventory:
                    writer.writerow([_safe_text(row.get("name")), _safe_text(row.get("qty")), _safe_text(row.get("unit_cost")), _safe_text(row.get("value"))])
                writer.writerow([])

            if action_plan:
                writer.writerow(["Executive Actions"])
                writer.writerow(["Priority", "Action", "Owner", "Timeline"])
                for row in action_plan:
                    writer.writerow([_safe_text(row.get("priority")), _safe_text(row.get("action")), _safe_text(row.get("owner")), _safe_text(row.get("timeline"))])

    elif fmt == "xlsx":
        _report_progress_update(job_id, 55, "Building Excel export")
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
            from openpyxl.chart import BarChart, LineChart, Reference
        except ModuleNotFoundError:
            abort(500)

        selected_cards = analysis.get("selected_metric_cards") or []
        top_causes = analysis.get("top_causes") or []
        top_assets = analysis.get("top_assets") or []
        inventory_top_value = analysis.get("inventory_top_value") or []
        action_plan = analysis.get("action_plan") or []

        wb = Workbook()
        ws = wb.active
        ws.title = "Report Summary"

        title_fill = PatternFill("solid", fgColor="1554FF")
        dark_fill = PatternFill("solid", fgColor="0F172A")
        light_fill = PatternFill("solid", fgColor="F8FAFC")
        thin = Side(style="thin", color="D6DCE5")
        border = Border(left=thin, right=thin, top=thin, bottom=thin)
        bold_white = Font(bold=True, color="FFFFFF")
        bold = Font(bold=True)
        wrap = Alignment(wrap_text=True, vertical="top")
        left = Alignment(horizontal="left", vertical="center", wrap_text=True)

        ws.merge_cells("A1:F1")
        ws["A1"] = report_name
        ws["A1"].font = Font(bold=True, size=18, color="FFFFFF")
        ws["A1"].fill = title_fill
        ws["A1"].alignment = left

        meta_rows = [
            ("Report", report_name),
            ("Category", _report_category_title(category)),
            ("Department", report_department_display(dept)),
            ("Range", f"{start_date} to {end_date}"),
            ("Scope Mode", scope_mode.title()),
            ("Scope", _safe_text(r.get("generated_for") or r.get("scope_section") or report_department_display(dept))),
            ("Generated", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            ("Metrics", ", ".join([metric_label(m, category) for m in (r.get("metrics") or [])]) or "—"),
        ]
        row = 3
        for label, value in meta_rows:
            ws.cell(row=row, column=1, value=label)
            ws.cell(row=row, column=2, value=value)
            ws.cell(row=row, column=1).font = bold
            ws.cell(row=row, column=1).fill = light_fill
            ws.cell(row=row, column=1).border = border
            ws.cell(row=row, column=2).border = border
            ws.cell(row=row, column=1).alignment = left
            ws.cell(row=row, column=2).alignment = wrap
            row += 1

        row += 1
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
        ws.cell(row=row, column=1, value=f"{_report_category_title(category)} Metrics")
        ws.cell(row=row, column=1).font = bold_white
        ws.cell(row=row, column=1).fill = dark_fill
        row += 1
        headers = ["Metric", "Value", "Insight", "Status / Context", "Management Use"]
        for cidx, label in enumerate(headers, start=1):
            cell = ws.cell(row=row, column=cidx, value=label)
            cell.font = bold_white
            cell.fill = dark_fill
            cell.border = border
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        row += 1
        cards = selected_cards or [{"label": str(k), "value": v, "key": str(k)} for k, v in (analysis.get("kpis") or {}).items()]
        for card in cards:
            metric_key = card.get("key") or ""
            metric_label_txt = card.get("label") or metric_label(metric_key, category)
            metric_value = card.get("value") if card.get("value") not in (None, "") else "—"
            insight = _metric_exec_note(metric_key, metric_label_txt, metric_value, analysis, category)
            status = "Stable" if str(metric_value).strip() not in ("—", "0", "0.0") else "Needs review"
            manage_use = "Use for management review, escalation, and action planning."
            for cidx, value in enumerate([metric_label_txt, _safe_text(metric_value), _safe_text(insight), status, manage_use], start=1):
                cell = ws.cell(row=row, column=cidx, value=value)
                cell.border = border
                cell.alignment = wrap
            row += 1

        def _add_table_sheet(title, headers, rows):
            sh = wb.create_sheet(title)
            for idx, header in enumerate(headers, start=1):
                cell = sh.cell(row=1, column=idx, value=header)
                cell.font = bold_white
                cell.fill = dark_fill
                cell.border = border
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            for ridx, data_row in enumerate(rows, start=2):
                for cidx, value in enumerate(data_row, start=1):
                    cell = sh.cell(row=ridx, column=cidx, value=value)
                    cell.border = border
                    cell.alignment = wrap
            _xls_autofit(sh)
            sh.freeze_panes = "A2"
            sh.auto_filter.ref = sh.dimensions
            return sh

        if top_causes:
            _add_table_sheet("Top Causes", ["Cause", "Count"], [[_safe_text(cause), _safe_float(cnt)] for cause, cnt in top_causes])
        if top_assets:
            _add_table_sheet(
                "Top Assets",
                ["Asset", "Incidents", "Downtime (hrs)"],
                [[_safe_text(name), _safe_float((meta or {}).get("incidents")), _safe_float((meta or {}).get("downtime_hours"))] for name, meta in top_assets],
            )
        if inventory_top_value:
            _add_table_sheet(
                "Inventory Value",
                ["Item", "Quantity", "Unit Cost", "Value"],
                [[_safe_text(row.get("name")), _safe_float(row.get("qty")), _safe_float(row.get("unit_cost")), _safe_float(row.get("value"))] for row in inventory_top_value],
            )
        if action_plan:
            _add_table_sheet(
                "Executive Actions",
                ["Priority", "Action", "Owner", "Timeline"],
                [[_safe_text(row.get("priority")), _safe_text(row.get("action")), _safe_text(row.get("owner")), _safe_text(row.get("timeline"))] for row in action_plan],
            )

        breakdown_rows = []
        for b in breakdowns[:5000]:
            breakdown_rows.append([
                _safe_text(b.get("asset_name") or b.get("machine_name") or b.get("asset") or b.get("asset_code") or ""),
                _safe_text(b.get("reported_dt") or b.get("created_at") or b.get("start_time") or b.get("reported_at") or ""),
                _safe_text(b.get("resolved_at") or b.get("end_time") or b.get("closed_at") or ""),
                _safe_float(b.get("duration_mins") or b.get("duration_min") or b.get("downtime_mins") or b.get("duration") or 0),
                _safe_text(b.get("root_cause") or b.get("cause") or b.get("failure_mode") or ""),
                _safe_text(b.get("status") or ""),
            ])
        if breakdown_rows:
            _add_table_sheet("Breakdowns", ["Asset", "Start", "End/Resolved", "Downtime (mins)", "Cause", "Status"], breakdown_rows)

        task_rows = []
        for t in tasks[:5000]:
            task_rows.append([
                _safe_text(t.get("asset_name") or t.get("machine_name") or t.get("asset") or t.get("asset_code") or ""),
                _safe_text(t.get("task") or t.get("title") or t.get("description") or ""),
                _safe_text(t.get("task_type") or t.get("type") or ""),
                _safe_text(t.get("due_date") or t.get("scheduled_date") or t.get("date") or ""),
                _safe_text(t.get("completed_at") or t.get("done_at") or ""),
                _safe_text(t.get("status") or ""),
                _safe_text(t.get("frequency") or t.get("repeat") or ""),
            ])
        if task_rows:
            _add_table_sheet("Maintenance", ["Asset", "Task", "Type", "Due", "Completed", "Status", "Frequency"], task_rows)

        inventory_rows = []
        for p in inventory_parts[:5000]:
            qty = _safe_float(p.get("qty") or p.get("quantity") or 0)
            cost = _safe_float(p.get("unit_cost") or p.get("cost") or 0)
            inventory_rows.append([
                _safe_text(p.get("name") or p.get("part_name") or p.get("item") or ""),
                _safe_text(p.get("category") or p.get("type") or ""),
                qty,
                cost,
                qty * cost,
                _safe_text(p.get("min_level") or p.get("reorder_level") or ""),
            ])
        if inventory_rows:
            _add_table_sheet("Inventory", ["Item", "Category", "Qty", "Unit Cost", "Value", "Min Level"], inventory_rows)

        timeline = analysis.get("timeline") or []
        if timeline:
            sh = wb.create_sheet("Trend Data")
            sh.append(["Period", "Count"])
            for row_item in timeline:
                sh.append([_safe_text(row_item.get("label")), _safe_float(row_item.get("count"))])
            _xls_autofit(sh)
            sh.freeze_panes = "A2"
            sh.auto_filter.ref = sh.dimensions
            if len(timeline) >= 2:
                chart = LineChart()
                chart.title = f"{_report_category_title(category)} Trend"
                chart.y_axis.title = "Value"
                chart.x_axis.title = "Period"
                data = Reference(sh, min_col=2, min_row=1, max_row=1 + len(timeline))
                cats = Reference(sh, min_col=1, min_row=2, max_row=1 + len(timeline))
                chart.add_data(data, titles_from_data=True)
                chart.set_categories(cats)
                chart.height = 8
                chart.width = 18
                sh.add_chart(chart, "D2")

        _xls_autofit(ws)
        ws.freeze_panes = "A3"
        wb.save(abs_path)

    r["files"][fmt] = filename
    if fmt == "pdf":
        r["filename"] = filename
        r["format"] = "pdf"
    elif not r.get("filename"):
        r["filename"] = filename
        r["format"] = fmt
    r["status"] = "READY"
    _save_store_from_memory()

    _report_progress_update(job_id, 88, f"{fmt.upper()} export ready")
    return send_file(
        abs_path,
        as_attachment=not inline,
        download_name=_safe_download_name(fmt),
        mimetype={
            "pdf": "application/pdf",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "csv": "text/csv",
        }.get(fmt, "application/octet-stream"),
    )


def _report_category_title(cat: str) -> str:
    return {
        "asset_reliability": "Asset Reliability",
        "breakdown_analytics": "Breakdown Analytics",
        "maintenance_compliance": "Maintenance Compliance",
        "inventory_spares": "Inventory & Spares",
        "strategic_roi": "Strategic ROI",
    }.get((cat or "").strip(), "Report")


def _format_label(fmt: str) -> str:
    f = (fmt or "").lower()
    return {"pdf": "PROFESSIONAL PDF", "xlsx": "EXCEL (XLSX)", "csv": "CSV"}.get(f, "PROFESSIONAL PDF")


def _range_label_from_dates(start_date: str, end_date: str) -> str:
    sd = parse_date_only(start_date)
    ed = parse_date_only(end_date)
    if not sd or not ed:
        return "—"

    q_starts = {1: (1, 1), 2: (4, 1), 3: (7, 1), 4: (10, 1)}
    q_ends = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}

    for q in (1, 2, 3, 4):
        sm, sday = q_starts[q]
        em, eday = q_ends[q]
        if sd.month == sm and sd.day == sday and ed.month == em and ed.day == eday and sd.year == ed.year:
            return f"Q{q} {sd.year} ({sd.strftime('%b %d')} - {ed.strftime('%b %d')})"

    return f"{sd.strftime('%Y-%m-%d')} to {ed.strftime('%Y-%m-%d')}"


def _default_report_name(category: str, start_date: str, end_date: str) -> str:
    title = _report_category_title(category)
    period = _range_label_from_dates(start_date, end_date)
    return f"{title} • {period}"


def _draw_pdf_brand_banner(c, page_w, page_h, *, left_margin: float = 18, right_margin: float = 18, top_margin: float = 18):
    from reportlab.lib import colors
    from reportlab.lib.utils import ImageReader
    top_y = page_h - top_margin
    logo_w = 124 if float(page_w or 0) >= 700 else 116
    logo_h = 44
    logo_x = max(10, left_margin - 8)
    logo_y = top_y - logo_h
    if os.path.exists(ULTRAVETIS_LOGO):
        try:
            img = ImageReader(ULTRAVETIS_LOGO)
            c.drawImage(img, logo_x, logo_y, width=logo_w, height=logo_h, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    address_x = page_w / 2
    c.setFillColor(colors.HexColor("#334155"))
    c.setFont("Helvetica-Bold", 10.2 if float(page_w or 0) >= 700 else 9.7)
    for idx, line in enumerate(ULTRAVETIS_ADDRESS_LINES):
        c.drawCentredString(address_x, top_y - 10 - (idx * 13), line)
    return min(logo_y, top_y - 10 - ((len(ULTRAVETIS_ADDRESS_LINES) - 1) * 13) - 10)


def _pdf_header_height(page_w=None):
    return 112 if (page_w and float(page_w) > 600) else 104

def _draw_pdf_header(c, page_w, page_h, *, department, start_date, end_date, report_title="", page_title="", machine_name="", serial_number="", reported_by=""):
    """Header used on every non-cover page with a crisp logo/address layout."""
    from reportlab.lib import colors

    left_margin = 18
    right_margin = 18
    header_bottom_y = _draw_pdf_brand_banner(c, page_w, page_h, left_margin=left_margin, right_margin=right_margin, top_margin=18) - 12

    department_display = report_department_display(department)

    c.setFillColor(colors.HexColor("#334155"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left_margin, header_bottom_y, department_display.upper())

    c.setStrokeColor(colors.HexColor("#CBD5E1"))
    c.setLineWidth(0.7)
    c.line(left_margin, header_bottom_y - 6, page_w - right_margin, header_bottom_y - 6)

    left_title = (report_title or "").strip()
    if page_title:
        left_title = f"{left_title} | {page_title}" if left_title else page_title
    c.setFillColor(colors.HexColor("#0F172A"))
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(left_margin, header_bottom_y - 20, left_title or "Report")

    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#475569"))
    period_text = f"{department_display} | {start_date} to {end_date}" if end_date else f"{department_display} | {start_date}"
    c.drawString(left_margin, header_bottom_y - 32, period_text)

    right_ctx = ""
    if (machine_name or "").strip():
        right_ctx = (machine_name or "").strip()
        if (serial_number or "").strip():
            right_ctx += f" (S/N: {serial_number.strip()})"
    if right_ctx:
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(colors.HexColor("#0F172A"))
        c.drawRightString(page_w - right_margin, header_bottom_y - 20, right_ctx)

    if reported_by:
        c.setFont("Helvetica", 8.5)
        c.setFillColor(colors.HexColor("#475569"))
        c.drawRightString(page_w - right_margin, header_bottom_y - 32, f"Created by: {reported_by}")

    line_y = header_bottom_y - 38
    c.setStrokeColor(colors.HexColor("#CBD5E1"))
    c.line(left_margin, line_y, page_w - right_margin, line_y)
    c.setFillColor(colors.black)
    c.setStrokeColor(colors.black)
    return line_y - 8


def _date_in_range(dt_str: str | None, start: date, end: date) -> bool:
    d = parse_date_only(dt_str or "")
    if not d:
        return False
    return start <= d <= end

def _safe_float(x, default=0.0):
    try:
        if x is None:
            return default
        s = str(x).strip()
        if s == "":
            return default
        return float(s)
    except Exception:
        if default is None:
            return None
        try:
            return float(default)
        except Exception:
            return None

def _norm_str(v: object) -> str:
    return str(v or '').strip().lower()

def _asset_scope_sets(assets: list[dict]) -> tuple[set[str], set[str]]:
    """Return (uidset, nameset) for robust record matching."""
    uidset: set[str] = set()
    nameset: set[str] = set()
    for a in assets or []:
        uid = _norm_str(a.get('uid') or a.get('asset_uid') or a.get('asset_id'))
        if uid:
            uidset.add(uid)
        nm = _norm_str(a.get('asset_name') or a.get('name') or a.get('machine_name') or a.get('asset_code'))
        if nm:
            nameset.add(nm)
    return uidset, nameset

def _record_asset_tokens(rec: dict) -> set[str]:
    """Extract possible asset identifiers from a breakdown/task record."""
    tokens: set[str] = set()
    for k in ('asset_uid','uid','asset_id','asset_code','asset_name','machine_name','name','machine','asset'):
        v = _norm_str(rec.get(k))
        if v:
            tokens.add(v)
    return tokens

def _filter_records_by_asset_scope(records: list[dict], uidset: set[str], nameset: set[str]) -> list[dict]:
    if not records:
        return []
    if not uidset and not nameset:
        return list(records)
    out: list[dict] = []
    for r in records:
        toks = _record_asset_tokens(r)
        if uidset and (toks & uidset):
            out.append(r)
            continue
        if nameset and (toks & nameset):
            out.append(r)
            continue
    return out

def _analyze_report(category_key: str, metrics: list[str], start_date: str, end_date: str,
                    assets: list, breakdowns: list, tasks: list, inventory_parts: list, kpis: dict) -> dict:
    """Turn raw lists into executive-ready metrics + insights.

    This intentionally stays robust even if some datasets are empty.
    """
    sd = parse_date_only(start_date) or date.today()
    ed = parse_date_only(end_date) or sd
    if ed < sd:
        sd, ed = ed, sd

    # --- Filter to reporting period ---
    b_in = [b for b in (breakdowns or []) if _date_in_range(b.get("reported_dt") or b.get("created_at"), sd, ed)]
    def _task_date_for_range(t: dict):
        for k in ("due_date","scheduled_date","schedule_date","planned_date","next_due","start_date","date","created_at"):
            v = t.get(k)
            if v:
                return v
        return None

    t_in = [t for t in (tasks or []) if _date_in_range(_task_date_for_range(t), sd, ed)]
    inv = list(inventory_parts or [])

    # --- Breakdown stats ---
    # Resolved/closed are used for MTTR, but downtime for availability should include ANY record
    # that has a duration entered (even if status is still open).
    resolved = [b for b in b_in if (b.get("status") or "").lower() in ("resolved", "closed", "complete", "completed")]

    def _mins(rec: dict) -> float:
        v = _safe_float(rec.get("duration_mins"), 0.0) or 0.0
        # some datasets may store duration as "duration" in minutes
        if not v:
            v = _safe_float(rec.get("duration"), 0.0) or 0.0
        return max(0.0, float(v))

    downtime_hours = sum(_mins(b) for b in b_in) / 60.0
    resolved_downtime_hours = sum(_mins(b) for b in resolved) / 60.0
    incidents = len(b_in)

    period_hours = max(1.0, (ed - sd).days * 24.0 + 24.0)  # inclusive-ish
    asset_count = max(1, len(assets or []))
    total_possible_hours = period_hours * asset_count
    availability = max(0.0, min(1.0, (total_possible_hours - downtime_hours) / total_possible_hours))

    mttr_hours = (resolved_downtime_hours / len(resolved)) if resolved else None
    # crude MTBF estimate: total uptime hours per failure
    mtbf_hours = ((total_possible_hours - downtime_hours) / incidents) if incidents else None
    failure_rate_per_day = (incidents / max(1, (ed - sd).days + 1))

# Root cause distribution
    by_cause = {}
    for b in b_in:
        cause = (b.get("failure_category") or "Uncategorized").strip() or "Uncategorized"
        by_cause[cause] = by_cause.get(cause, 0) + 1
    top_causes = sorted(by_cause.items(), key=lambda x: x[1], reverse=True)[:5]

    # Per-asset hotspot
    by_asset = {}
    asset_cause_counts = {}
    for b in b_in:
        key = (b.get("asset_name") or b.get("asset_id") or "Unknown").strip()
        by_asset.setdefault(key, {"incidents": 0, "downtime_hours": 0.0})
        by_asset[key]["incidents"] += 1
        cause = (b.get("failure_category") or "Uncategorized").strip() or "Uncategorized"
        asset_cause_counts.setdefault(key, {})
        asset_cause_counts[key][cause] = asset_cause_counts[key].get(cause, 0) + 1
    # downtime by asset should also include any entered duration (even if not closed yet)
    for b in b_in:
        key = (b.get("asset_name") or b.get("asset_id") or "Unknown").strip()
        by_asset.setdefault(key, {"incidents": 0, "downtime_hours": 0.0})
        by_asset[key]["downtime_hours"] += (_safe_float(b.get("duration_mins"), 0.0) or 0.0) / 60.0
    for key, meta in by_asset.items():
        causes = asset_cause_counts.get(key) or {}
        dominant = sorted(causes.items(), key=lambda x: x[1], reverse=True)[0][0] if causes else "—"
        meta["dominant_cause"] = dominant
    top_assets = sorted(by_asset.items(), key=lambda x: (x[1]["downtime_hours"], x[1]["incidents"]), reverse=True)[:5]

    # Incidents timeline (daily)
    daily = {}
    for b in b_in:
        d = parse_date_only(b.get("reported_dt") or b.get("created_at"))
        if not d:
            continue
        daily[d] = daily.get(d, 0) + 1
    days = []
    cur = sd
    while cur <= ed:
        days.append(cur)
        cur += timedelta(days=1)
    timeline = [{"date": d.strftime("%Y-%m-%d"), "count": int(daily.get(d, 0))} for d in days]

    # --- Maintenance compliance ---
    total_tasks = len(t_in)
    completed = [t for t in t_in if (t.get("status") or "").lower() in ("completed", "complete", "done")]
    completed_count = len(completed)
    adherence = (completed_count / total_tasks) if total_tasks else None

    on_time = 0
    for t in completed:
        due = parse_date_only(t.get("due_date") or "")
        comp = parse_date_only(t.get("completed_at") or "")
        if due and comp and comp <= due:
            on_time += 1
    on_time_rate = (on_time / completed_count) if completed_count else None

    
    # PM status buckets (truthful & simple)
    today_dt = datetime.now().date()
    pm_completed = [t for t in t_in if (t.get("status") or "").lower() in ("completed", "complete", "done")]
    pm_open = [t for t in t_in if (t.get("status") or "").lower() not in ("completed", "complete", "done")]
    pm_overdue = []
    for t in pm_open:
        due = parse_date_only(t.get("due_date") or "")
        if due and due < sd:
            # older than period start (still relevant backlog)
            pm_overdue.append(t)
        elif due and due < today_dt:
            pm_overdue.append(t)

    pm_status_counts = {
        "scheduled": int(total_tasks),
        "completed": int(len(pm_completed)),
        "open": int(max(0, len(pm_open) - len(pm_overdue))),
        "overdue": int(len(pm_overdue)),
    }
# --- Inventory health ---
    stockouts = [p for p in inv if _safe_float(p.get("qty"), 0) <= 0]
    critical_low = [p for p in inv if _safe_float(p.get("qty"), 0) <= _safe_float(p.get("min_qty"), 0) and _safe_float(p.get("min_qty"), 0) > 0]
    inventory_value = sum(_safe_float(p.get("qty"), 0) * _safe_float(p.get("unit_price"), 0) for p in inv)
    maintenance_cost_subtotal = round(sum((_safe_float(t.get("cost_subtotal"), 0.0) or 0.0) for t in t_in), 2)
    breakdown_cost_subtotal = round(sum((_safe_float(b.get("cost_subtotal"), 0.0) or 0.0) for b in b_in), 2)
    maintenance_cost_total = round(sum((_safe_float(t.get("cost_total"), 0.0) or 0.0) for t in t_in), 2)
    breakdown_cost_total = round(sum((_safe_float(b.get("cost_total"), 0.0) or 0.0) for b in b_in), 2)
    maintenance_vat_total = round(sum((_safe_float(t.get("cost_vat_amount"), 0.0) or 0.0) for t in t_in), 2)
    breakdown_vat_total = round(sum((_safe_float(b.get("cost_vat_amount"), 0.0) or 0.0) for b in b_in), 2)
    actual_costed_tasks = [t for t in completed if bool(t.get("cost_collected"))]
    maintenance_actual_cost_subtotal = round(sum((_safe_float(t.get("cost_subtotal"), 0.0) or 0.0) for t in actual_costed_tasks), 2)
    maintenance_actual_vat_total = round(sum((_safe_float(t.get("cost_vat_amount"), 0.0) or 0.0) for t in actual_costed_tasks), 2)
    maintenance_actual_cost_total = round(sum((_safe_float(t.get("cost_total"), 0.0) or 0.0) for t in actual_costed_tasks), 2)
    planned_task_count = sum(1 for t in t_in if parse_date_only(t.get("due_date") or ""))
    costed_task_count = sum(1 for t in t_in if _safe_float(t.get("cost_total"), None) is not None or _safe_float(t.get("cost_subtotal"), None) is not None)
    vat_rates = sorted({round(_safe_float(x.get("cost_vat_pct"), 0.0) or 0.0, 2) for x in list(t_in) + list(b_in) if (_safe_float(x.get("cost_vat_pct"), None) is not None)})
    vat_rate_label = ", ".join((f"{r:g}%" for r in vat_rates if r > 0)) or "No VAT applied"

    # Top inventory items by value (qty * unit_price)
    inventory_top_value = []
    try:
        items = []
        for p in inv:
            name = (p.get("part_name") or p.get("name") or p.get("part") or "Item").strip()
            cat = (p.get("category") or p.get("type") or "").strip()
            qty = _safe_float(p.get("qty"), 0.0) or 0.0
            price = _safe_float(p.get("unit_price"), 0.0) or 0.0
            value = qty * price
            items.append({"name": name, "category": cat, "qty": qty, "unit_price": price, "value": value})
        items.sort(key=lambda x: x["value"], reverse=True)
        inventory_top_value = items[:10]
    except Exception:
        inventory_top_value = []
# --- Compose KPI map (used by PDF/XLSX builders) ---
    estimated_loss = round(downtime_hours * float(DOWNTIME_COST_PER_HOUR), 2)
    health_score = None
    if availability is not None:
        mttr_penalty = min(18.0, float(mttr_hours or 0.0) * 2.0)
        health_score = max(0.0, min(100.0, round((availability * 100.0) - mttr_penalty + 8.0, 1)))

    overdue_ratio = (len(pm_overdue) / total_tasks) if total_tasks else 0.0
    audit_readiness_pct = None
    if total_tasks:
        components = [
            (adherence or 0.0) * 100.0,
            (on_time_rate or 0.0) * 100.0,
            max(0.0, 100.0 - overdue_ratio * 100.0),
        ]
        audit_readiness_pct = round(sum(components) / len(components), 1)
    sop_validation_pct = round((((adherence or 0.0) * 0.7) + ((on_time_rate or 0.0) * 0.3)) * 100.0, 1) if total_tasks else None

    technician_rankings = []
    tech_map = {}
    for t in t_in:
        tech = (t.get("technician") or t.get("lead_technician") or "Unassigned").strip() or "Unassigned"
        row = tech_map.setdefault(tech, {"assigned": 0, "completed": 0, "on_time": 0, "overdue": 0})
        row["assigned"] += 1
        st = (t.get("status") or "").strip().lower()
        if st in ("completed", "complete", "done"):
            row["completed"] += 1
            due = parse_date_only(t.get("due_date") or "")
            comp = parse_date_only(t.get("completed_at") or "")
            if due and comp and comp <= due:
                row["on_time"] += 1
        else:
            due = parse_date_only(t.get("due_date") or "")
            if due and due < today_dt:
                row["overdue"] += 1
    for name, row in tech_map.items():
        assigned = row["assigned"] or 1
        score = round(((row["completed"] / assigned) * 70.0) + ((row["on_time"] / assigned) * 30.0), 1)
        technician_rankings.append({"technician": name, "assigned": row["assigned"], "completed": row["completed"], "on_time": row["on_time"], "overdue": row["overdue"], "score": score})
    technician_rankings.sort(key=lambda x: (x["score"], x["completed"]), reverse=True)

    dead_stock_items = []
    for p in inv:
        linked = p.get("compatible_assets") or []
        qty = _safe_float(p.get("qty"), 0.0) or 0.0
        if qty > 0 and not linked:
            dead_stock_items.append(p)
    avg_stock = (sum((_safe_float(p.get("qty"), 0.0) or 0.0) for p in inv) / len(inv)) if inv else 0.0
    stock_turnover = round(((completed_count + incidents) / max(1.0, avg_stock)), 2) if inv else None
    avg_lead = (sum((_safe_float(p.get("lead_time_days"), 0.0) or 0.0) for p in inv) / len(inv)) if inv else 0.0
    vendor_reliability_pct = round(max(0.0, 100.0 - min(60.0, avg_lead * 2.5)), 1) if inv else None
    consumption_proc_ratio = round(((completed_count + incidents) / max(1.0, sum((_safe_float(p.get("qty"), 0.0) or 0.0) for p in inv))), 3) if inv else None

    value_realized = round(max(0.0, (availability * 100.0 - 85.0)) * 0.01 * estimated_loss, 2)
    roi_base = max(1.0, inventory_value if inventory_value > 0 else (estimated_loss * 0.35 + 1.0))
    roi_multiplier = round(value_realized / roi_base, 2) if roi_base else None
    life_extension_years = round(max(0.0, ((adherence or 0.0) * 2.5) + ((availability or 0.0) * 1.5)), 1) if (total_tasks or incidents) else None
    break_even_months = round(roi_base / max(1.0, estimated_loss / max(1, (ed - sd).days + 1) * 30.0), 1) if estimated_loss > 0 else None
    strategic_projects = []
    for name, meta in top_assets[:5]:
        strategic_projects.append({
            "project": f"Stabilize {name}",
            "incidents": int(meta.get("incidents", 0)),
            "downtime_hours": round(float(meta.get("downtime_hours", 0.0)), 1),
            "estimated_loss": round(float(meta.get("downtime_hours", 0.0)) * float(DOWNTIME_COST_PER_HOUR), 2),
        })
    pillar_breakdown = [
        {"pillar": "Reliability", "score": round(availability * 100.0, 1)},
        {"pillar": "Compliance", "score": round(audit_readiness_pct or 0.0, 1)},
        {"pillar": "Cost Control", "score": round(max(0.0, 100.0 - min(100.0, (estimated_loss / max(1.0, roi_base)) * 100.0)), 1)},
    ]

    kpi_map = {
        "incidents": incidents,
        "downtime_hours": round(downtime_hours, 1),
        "availability_pct": round(availability * 100.0, 1),
        "mttr_hours": round(mttr_hours, 2) if mttr_hours is not None else None,
        "mtbf_hours": round(mtbf_hours, 1) if mtbf_hours is not None else None,
        "failure_rate_per_day": round(failure_rate_per_day, 3),
        "health_score": health_score,
        "loss_estimate": estimated_loss,
        "pm_total": total_tasks,
        "pm_completed": completed_count,
        "pm_adherence_pct": round(adherence * 100.0, 1) if adherence is not None else None,
        "pm_on_time_pct": round(on_time_rate * 100.0, 1) if on_time_rate is not None else None,
        "audit_readiness_pct": audit_readiness_pct,
        "sop_validation_pct": sop_validation_pct,
        "late_tasks": len(pm_overdue),
        "inventory_value": round(inventory_value, 2),
        "maintenance_cost_subtotal": maintenance_cost_subtotal,
        "breakdown_cost_subtotal": breakdown_cost_subtotal,
        "combined_cost_subtotal": round(maintenance_cost_subtotal + breakdown_cost_subtotal, 2),
        "maintenance_cost_total": maintenance_cost_total,
        "breakdown_cost_total": breakdown_cost_total,
        "maintenance_vat_total": maintenance_vat_total,
        "breakdown_vat_total": breakdown_vat_total,
        "combined_vat_total": round(maintenance_vat_total + breakdown_vat_total, 2),
        "vat_rate_label": vat_rate_label,
        "combined_cost_total": round(maintenance_cost_total + breakdown_cost_total, 2),
        "maintenance_actual_cost_subtotal": maintenance_actual_cost_subtotal,
        "maintenance_actual_vat_total": maintenance_actual_vat_total,
        "maintenance_actual_cost_total": maintenance_actual_cost_total,
        "planned_task_count": planned_task_count,
        "costed_task_count": costed_task_count,
        "stockouts": len(stockouts),
        "critical_low": len(critical_low),
        "dead_stock": len(dead_stock_items),
        "turnover": stock_turnover,
        "consumption_vs_proc": consumption_proc_ratio,
        "vendor_reliability_pct": vendor_reliability_pct,
        "value_realized": value_realized,
        "roi_multiplier": roi_multiplier,
        "life_extension_years": life_extension_years,
        "breakeven_months": break_even_months,
    }

    # --- Executive insights (simple rules that stay truthful) ---
    insights = []
    if incidents == 0:
        insights.append("No breakdown incidents were recorded in the selected period for the chosen scope.")
    else:
        if mttr_hours is not None and mttr_hours > 4:
            insights.append("Repair cycles are taking longer than ideal; prioritize response time and spares readiness.")
        if availability < 0.95:
            insights.append("Operational availability is below the 95% target; focus on the top downtime contributors.")
        if top_causes:
            insights.append(f"Most incidents are driven by {top_causes[0][0]} — address repeat causes with targeted PM/RCA actions.")

    if total_tasks:
        if adherence is not None and adherence < 0.9:
            insights.append("PM schedule adherence is below 90%; review staffing and production windows to protect planned maintenance.")
        if on_time_rate is not None and on_time_rate < 0.9:
            insights.append("On-time completion is below 90%; tighten due-date planning and escalation rules.")
    else:
        # Stay truthful: tasks may exist but none fall inside this reporting window (or dates are stored under non-standard keys).
        all_tasks = list(tasks or [])
        if all_tasks:
            insights.append("No PM tasks are due inside the selected reporting window for this scope; review the period filter or upcoming schedule.")
        else:
            insights.append("No PM tasks are available for this scope — load or import the PM plan to enable maintenance compliance reporting.")

    if inv:
        if len(stockouts) > 0:
            insights.append("There are stock-outs in inventory; resolve immediately to prevent extended downtime.")
        if len(critical_low) > 0:
            insights.append("Several parts are at or below minimum stock; consider dynamic reorder points for critical spares.")
    else:
        insights.append("Inventory analytics are limited because no spare parts data is available in the system yet.")

    # De-duplicate repeated narrative while preserving order, then trim.
    deduped_insights = []
    seen_insights = set()
    for insight in insights:
        key = str(insight or "").strip().lower()
        if not key or key in seen_insights:
            continue
        seen_insights.add(key)
        deduped_insights.append(insight)
    insights = deduped_insights[:4]

    # Metrics selection: map UI metric keys to kpi_map keys
    # (supports unknown keys without crashing)
    selected = []
    for m in (metrics or []):
        key = (m or "").strip().lower()
        selected.append(key)


    # --- Availability by section (for Asset Reliability views) ---
    availability_by_section = []
    try:
        # Map asset uid -> section
        uid_to_section = {}
        for a in (assets or []):
            uid = (a.get("uid") or "").strip()
            sec = (a.get("section") or "").strip() or "Unassigned"
            if uid:
                uid_to_section[uid] = sec

        # downtime & incidents by section (uses any entered duration, not just closed)
        sec_downtime = {}
        sec_incidents = {}
        for b in b_in:
            uid = (b.get("asset_uid") or "").strip()
            sec = uid_to_section.get(uid) or (b.get("section") or "").strip() or "Unassigned"
            sec_incidents[sec] = sec_incidents.get(sec, 0) + 1
            sec_downtime[sec] = sec_downtime.get(sec, 0.0) + (_mins(b) / 60.0)

        secs = sorted(set(list(sec_incidents.keys()) + list(sec_downtime.keys())))
        for sec in secs:
            dt_h = float(sec_downtime.get(sec, 0.0))
            inc = int(sec_incidents.get(sec, 0))
            av = max(0.0, min(1.0, (period_hours - dt_h) / period_hours))
            availability_by_section.append({
                "section": sec,
                "availability_pct": round(av * 100.0, 1),
                "incidents": inc,
                "downtime_hours": round(dt_h, 1),
            })
        availability_by_section.sort(key=lambda x: x["availability_pct"], reverse=True)
        availability_by_section = availability_by_section[:8]
    except Exception:
        availability_by_section = []

    metric_key_map = {
        "mtbf": "mtbf_hours",
        "mttr": "mttr_hours",
        "availability": "availability_pct",
        "downtime": "downtime_hours",
        "failure_rate": "failure_rate_per_day",
        "health_score": "health_score",
        "incidents": "incidents",
        "loss_estimate": "loss_estimate",
        "root_cause": None,
        "heatmap": None,
        "pm_adherence": "pm_adherence_pct",
        "sop_validation": "sop_validation_pct",
        "audit_readiness": "audit_readiness_pct",
        "technician_ranking": None,
        "critical_gaps": None,
        "late_tasks": "late_tasks",
        "inventory_value": "inventory_value",
        "turnover": "turnover",
        "dead_stock": "dead_stock",
        "stockouts": "stockouts",
        "consumption_vs_proc": "consumption_vs_proc",
        "vendor_reliability": "vendor_reliability_pct",
        "value_realized": "value_realized",
        "roi_multiplier": "roi_multiplier",
        "life_extension": "life_extension_years",
        "pillar_breakdown": None,
        "breakeven": "breakeven_months",
        "projects": None,
    }
    critical_gaps = []
    if pm_overdue:
        critical_gaps.append(f"{len(pm_overdue)} PM task(s) are overdue.")
    if any((t.get('technician') or '').strip() == '' for t in t_in):
        critical_gaps.append("Some PM tasks have no technician assigned.")
    if stockouts:
        critical_gaps.append(f"{len(stockouts)} spare part(s) are fully stocked out.")
    if incidents and not top_causes:
        critical_gaps.append("Breakdown category data is incomplete for RCA reporting.")
    critical_gaps = critical_gaps[:5]

    selected_metric_cards = []
    for key in selected:
        label = metric_label(key, category_key)
        map_key = metric_key_map.get(key)
        value = None
        if map_key:
            value = kpi_map.get(map_key)
        elif key == "root_cause":
            value = top_causes[0][0] if top_causes else "—"
        elif key == "heatmap":
            value = f"{len(availability_by_section)} sections mapped" if availability_by_section else "—"
        elif key == "technician_ranking":
            value = technician_rankings[0]["technician"] if technician_rankings else "—"
        elif key == "critical_gaps":
            value = len(critical_gaps)
        elif key == "pillar_breakdown":
            value = " / ".join(f"{x['pillar']} {x['score']}%" for x in pillar_breakdown)
        elif key == "projects":
            value = len(strategic_projects)
        selected_metric_cards.append({"key": key, "label": label, "value": value if value is not None else "—"})

    cost_summary_rows = [
        {"label": "Estimated downtime cost exposure", "value": round(estimated_loss, 2), "note": "Derived from logged downtime and the configured cost per hour."},
        {"label": "Actual maintenance cost", "value": round(maintenance_actual_cost_total, 2), "note": "Only completed tasks with confirmed actual cost."},
        {"label": "Planned maintenance cost in period", "value": round(maintenance_cost_total, 2), "note": "All scheduled maintenance cost currently captured in the selected period."},
        {"label": "Breakdown repair cost", "value": round(breakdown_cost_total, 2), "note": "Recorded corrective / breakdown spend in scope."},
        {"label": "Inventory value in scope", "value": round(inventory_value, 2), "note": "Current spare parts holding value for the selected scope."},
    ]

    data_quality = {
        "breakdowns_with_root_cause": sum(1 for b in b_in if (b.get("failure_category") or "").strip()),
        "tasks_with_cost": costed_task_count,
        "tasks_with_confirmed_actual_cost": len(actual_costed_tasks),
        "tasks_with_technician": sum(1 for t in t_in if (t.get("technician") or t.get("lead_technician") or "").strip()),
        "inventory_items_with_price": sum(1 for p in inv if _safe_float(p.get("unit_price"), None) is not None),
    }

    strategic_cards = [
        {"label": "Incidents", "value": incidents, "detail": "Breakdowns captured in the selected window."},
        {"label": "Downtime (hrs)", "value": round(downtime_hours, 1), "detail": "Logged downtime against the selected assets / section / department."},
        {"label": "Availability", "value": f"{round(availability * 100.0, 1)}%", "detail": "Operational uptime based on recorded downtime."},
        {"label": "Downtime cost exposure", "value": _kes_label(estimated_loss), "detail": "Directional cost-at-risk from downtime only."},
        {"label": "Actual maintenance cost", "value": _kes_label(maintenance_actual_cost_total), "detail": "Completed work with confirmed actual cost only."},
        {"label": "Overdue PM tasks", "value": len(pm_overdue), "detail": "Backlog still needing action."},
    ]

    action_plan = []
    if top_assets:
        asset_name, asset_meta = top_assets[0]
        action_plan.append({
            "priority": "Critical" if float(asset_meta.get("downtime_hours") or 0.0) >= 8 else "High",
            "focus": "Top downtime asset",
            "issue": f"{asset_name} generated {round(float(asset_meta.get('downtime_hours') or 0.0), 1)} hrs across {int(asset_meta.get('incidents') or 0)} incidents.",
            "impact": _kes_label(round(float(asset_meta.get("downtime_hours") or 0.0) * float(DOWNTIME_COST_PER_HOUR), 2)),
            "owner": "Engineering / Maintenance",
            "action": f"Complete focused RCA on {asset_name}, review PM sequence, and secure the critical spares tied to its repeat failure mode ({asset_meta.get('dominant_cause') or 'Uncategorized'}).",
            "horizon": "14 days",
            "success_metric": "Reduce repeat incidents and downtime on this asset next reporting cycle.",
        })
    if top_causes:
        cause_name, cause_count = top_causes[0]
        action_plan.append({
            "priority": "High",
            "focus": "Repeat root cause",
            "issue": f"{cause_name} appears in {cause_count} incident(s).",
            "impact": f"{cause_count} incident(s) affected reliability in the selected period.",
            "owner": "Reliability / Engineering",
            "action": f"Standardize corrective action for {cause_name}, verify SOP compliance, and convert the fix into a controlled PM / inspection step.",
            "horizon": "30 days",
            "success_metric": f"Lower {cause_name} incidence in the next report window.",
        })
    if pm_overdue:
        action_plan.append({
            "priority": "High" if len(pm_overdue) >= 3 else "Medium",
            "focus": "PM backlog",
            "issue": f"{len(pm_overdue)} PM task(s) are overdue.",
            "impact": "Backlog increases failure risk and weakens schedule compliance.",
            "owner": "Maintenance Planner",
            "action": "Recover the PM backlog, resequence dates against production windows, and escalate overdue tasks until closed.",
            "horizon": "7 days",
            "success_metric": "Overdue PM count trends down and on-time completion improves.",
        })
    if stockouts or critical_low:
        action_plan.append({
            "priority": "High" if stockouts else "Medium",
            "focus": "Critical spares",
            "issue": f"{len(stockouts)} stock-out(s) and {len(critical_low)} item(s) at or below minimum stock.",
            "impact": "Spare shortages can prolong repair time and missed PM execution.",
            "owner": "Stores / Maintenance",
            "action": "Replenish critical spares, review min-max levels, and tie reorder points to asset criticality and failure history.",
            "horizon": "14 days",
            "success_metric": "Zero stock-outs on critical spares and fewer maintenance delays.",
        })
    if any((t.get('technician') or '').strip() == '' for t in t_in):
        action_plan.append({
            "priority": "Medium",
            "focus": "Execution ownership",
            "issue": "Some maintenance tasks have no technician assigned.",
            "impact": "Unclear ownership slows task execution and accountability.",
            "owner": "Maintenance Supervisor",
            "action": "Assign named owners to all open tasks and use technician load to balance the plan.",
            "horizon": "Immediate",
            "success_metric": "All open tasks carry a named owner.",
        })
    if not action_plan:
        action_plan.append({
            "priority": "Sustain",
            "focus": "Control",
            "issue": "No high-severity exceptions were detected in the selected data window.",
            "impact": "Reliability performance is currently stable within recorded data.",
            "owner": "Engineering",
            "action": "Sustain current controls, keep PM discipline high, and continue logging cost and cause data consistently.",
            "horizon": "Next cycle",
            "success_metric": "Stability maintained with complete data capture.",
        })
    action_plan = action_plan[:5]

    project_candidates = []
    for name, meta in top_assets[:5]:
        dt_hours = round(float(meta.get("downtime_hours") or 0.0), 1)
        est_loss = round(dt_hours * float(DOWNTIME_COST_PER_HOUR), 2)
        share = round((dt_hours / downtime_hours) * 100.0, 1) if downtime_hours > 0 else 0.0
        project_candidates.append({
            "project": f"Stabilize {name}",
            "asset": name,
            "dominant_cause": meta.get("dominant_cause") or (top_causes[0][0] if top_causes else "—"),
            "incidents": int(meta.get("incidents") or 0),
            "downtime_hours": dt_hours,
            "estimated_loss": est_loss,
            "share_pct": share,
            "recommended_owner": "Engineering / Maintenance",
        })

    roi_data_requirements = [
        {"field": "Improvement initiative / project name", "status": "Missing", "note": "Needed to tie actions to an approved strategic program."},
        {"field": "Approved investment amount (capex / opex)", "status": "Missing", "note": "Required for true ROI and payback calculation."},
        {"field": "Baseline operational KPI", "status": "Captured", "note": "Downtime, incidents, availability, PM backlog, and cost exposure already exist in the system."},
        {"field": "Target KPI after intervention", "status": "Missing", "note": "Needed to measure expected vs actual improvement."},
        {"field": "Verified realized savings / gain", "status": "Missing", "note": "The system does not yet store signed-off savings by project."},
        {"field": "Owner and due date per improvement", "status": "Partial", "note": "Owner exists for maintenance tasks, but not for cross-functional strategic actions."},
    ]

    return {
        "category_key": category_key,
        "start": sd,
        "end": ed,
        "kpis": kpi_map,
        "insights": insights,
        "top_causes": top_causes,
        "top_assets": top_assets,
        "timeline": timeline,
        "availability_by_section": availability_by_section,
        "pm_status_counts": pm_status_counts,
        "inventory_top_value": inventory_top_value,
        "raw": {
            "breakdowns": b_in,
            "tasks": t_in,
            "inventory_parts": inv,
        },
        "selected_metrics": selected,
        "selected_metric_cards": selected_metric_cards,
        "technician_rankings": technician_rankings[:8],
        "critical_gaps": critical_gaps,
        "dead_stock_items": dead_stock_items[:10],
        "pillar_breakdown": pillar_breakdown,
        "strategic_projects": strategic_projects,
        "strategic_cards": strategic_cards,
        "cost_summary_rows": cost_summary_rows,
        "data_quality": data_quality,
        "action_plan": action_plan,
        "project_candidates": project_candidates,
        "roi_data_requirements": roi_data_requirements,
        "center_kpis": kpis or {},
    }



def _build_report_pdf_guarded(**kwargs):
    """Generate PDF but never fail the request.

    If anything goes wrong during the rich PDF build (tables/charts),
    fall back to a minimal business-safe PDF so downloads always work.
    """
    c = kwargs.get("c")
    try:
        # Call the real builder (NOT this guard)
        return _build_report_pdf(
            c=c,
            report_name=kwargs.get("report_name") or "",
            category_key=kwargs.get("category_key") or "",
            category_title=kwargs.get("category_title") or "",
            department=kwargs.get("department") or "",
            start_date=kwargs.get("start_date") or "",
            end_date=kwargs.get("end_date") or "",
            generated_for=kwargs.get("generated_for") or "",
            section=kwargs.get("section") or "",
            asset_uid=kwargs.get("asset_uid") or "",
            assets=kwargs.get("assets") or [],
            breakdowns=kwargs.get("breakdowns") or [],
            tasks=kwargs.get("tasks") or [],
            inventory_parts=kwargs.get("inventory_parts") or [],
            metrics=kwargs.get("metrics") or [],
            kpis=kwargs.get("kpis") or {},
            reported_by=kwargs.get("reported_by") or "",
            include_cover=bool(kwargs.get("include_cover", True)),
        )
    except Exception:

        # Minimal fallback (no charts) – keep exports usable, avoid 500 errors.
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.lib import colors

        if c is None:
            return

        W, H = A4
        c.setFillColor(colors.HexColor("#111827"))
        c.setFont("Helvetica-Bold", 16)
        c.drawString(15 * mm, H - 30 * mm, (kwargs.get("category_title") or "Report"))

        c.setFont("Helvetica-Bold", 12)
        c.drawString(15 * mm, H - 42 * mm, (kwargs.get("report_name") or "Opsloom Report"))

        c.setFont("Helvetica", 10)
        c.setFillColor(colors.HexColor("#374151"))
        dept = kwargs.get("department") or ""
        sd = kwargs.get("start_date") or ""
        ed = kwargs.get("end_date") or ""
        c.drawString(15 * mm, H - 54 * mm, f"Department: {report_department_display(dept)}")
        c.drawString(15 * mm, H - 64 * mm, f"Period: {sd} to {ed}")

        rb = (kwargs.get("reported_by") or "").strip()
        if rb:
            c.drawString(15 * mm, H - 74 * mm, f"Reported by: {rb}")

        c.setFillColor(colors.HexColor("#6B7280"))
        c.setFont("Helvetica", 9)
        c.drawString(15 * mm, H - 90 * mm, "Charts were not rendered for this export. The summary remains accurate for the selected scope/period.")
        c.showPage()
        return




def _build_report_pdf(
    c,
    report_name: str,
    category_key: str,
    category_title: str,
    department: str,
    start_date: str,
    end_date: str,
    generated_for: str,
    section: str,
    asset_uid: str,
    assets: list,
    breakdowns: list,
    tasks: list,
    inventory_parts: list,
    metrics: list,
    kpis: dict,
    reported_by: str = "",
    include_cover: bool = True,
):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.lib import colors

    W, H = A4

    # Build analysis once (drives tables, charts, and narrative)
    analysis = _analyze_report(
        category_key=category_key,
        metrics=metrics or [],
        start_date=start_date,
        end_date=end_date,
        assets=assets or [],
        breakdowns=breakdowns or [],
        tasks=tasks or [],
        inventory_parts=inventory_parts or [],
        kpis=kpis or {},
    )




    # Resolve machine identity for headers (single-asset scope)
    machine_name = ""
    serial_number = ""
    if asset_uid:
        a = next((x for x in (assets or []) if _norm_str(x.get("uid")) == _norm_str(asset_uid)), None)
        if a:
            machine_name = (a.get("asset_name") or a.get("name") or "").strip()
            serial_number = (a.get("serial_number") or a.get("serial") or a.get("sn") or "").strip()

    # Stash into analysis for consistent header rendering across pages
    try:
        analysis["report_title"] = report_name
        analysis["machine_name"] = machine_name
        analysis["serial_number"] = serial_number
        analysis["reported_by"] = reported_by
    except Exception:
        pass

    def cover_page():
        # Formal cover page using the standard corporate header.
        c.setFillColor(colors.white)
        c.rect(0, 0, W, H, fill=1, stroke=0)

        _draw_pdf_brand_banner(c, W, H, left_margin=20 * mm, right_margin=20 * mm, top_margin=16)

        department_display = report_department_display(department)
        c.setFillColor(colors.HexColor("#0F172A"))
        c.setFont("Helvetica-Bold", 11)
        c.drawString(20 * mm, H - 42 * mm, department_display.upper())
        c.setFont("Helvetica-Bold", 24)
        c.drawString(20 * mm, H - 58 * mm, f"{category_title}")
        c.setFont("Helvetica-Bold", 20)
        c.drawString(20 * mm, H - 72 * mm, "Performance Report")
        c.setFont("Helvetica", 10)
        c.setFillColor(colors.HexColor("#475569"))
        c.drawString(20 * mm, H - 82 * mm, "Controlled management report for executive review, audit filing, and decision support.")

        scope_label = ("Machine" if asset_uid else ("Section" if section else "Department"))
        scope_target = machine_name or section or get_scope_unit_display(department)

        box_y = H - 125 * mm
        box_h = 52 * mm
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.roundRect(20*mm, box_y, W - 40*mm, box_h, 8, stroke=1, fill=0)
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(colors.HexColor("#64748B"))
        labels = [("Report Scope", scope_label), ("Scope Target", scope_target or "—"), ("Reporting Period", _range_label_from_dates(start_date, end_date)), ("Created By", reported_by or "—")]
        col_x = [24*mm, 78*mm, 132*mm, 24*mm]
        row_y = [box_y + box_h - 12*mm, box_y + box_h - 28*mm, box_y + box_h - 12*mm, box_y + box_h - 28*mm]
        for (lab, val), x, yv in zip(labels, col_x, row_y):
            c.drawString(x, yv, lab.upper())
            c.setFillColor(colors.HexColor("#0F172A"))
            c.setFont("Helvetica-Bold", 11)
            c.drawString(x, yv - 5*mm, str(val or "—"))
            c.setFont("Helvetica-Bold", 8)
            c.setFillColor(colors.HexColor("#64748B"))

        c.showPage()

    def table_kv(title, rows, x, y):
        from reportlab.platypus import Table, TableStyle

        data = [[k, v] for k, v in rows]
        t = Table([[title, ""]] + data, colWidths=[55 * mm, 120 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
            ("BACKGROUND", (0, 1), (-1, -1), colors.white),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        t.wrapOn(c, 0, 0)
        t.drawOn(c, x, y - t._height)
        return y - t._height - 10

    def table_exec_summary(title, bullets, x, y):
        """Full-width executive summary table for cleaner structure."""
        from reportlab.platypus import Table, TableStyle
        lines = [[title], *[[b] for b in (bullets or [])]]
        t = Table(lines, colWidths=[175 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#111827")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        t.wrapOn(c, 0, 0)
        t.drawOn(c, x, y - t._height)
        return y - t._height - 10

    # 1) Optional cover
    if include_cover:
        cover_page()

    # 2) Content page with header + structured tables
    # ✅ 3B FIX: Use the dedicated header and start body below it (prevents overlap)
    # NOTE: _draw_pdf_header must exist in your app.py (the helper you added earlier).
    body_top = _draw_pdf_header(
        c,
        W,
        H,
        department=department,
        start_date=start_date,
        end_date=end_date,
        report_title=report_name,
        page_title="Executive Summary",
        machine_name=machine_name,
        serial_number=serial_number,
        reported_by=reported_by,
    )
    y = body_top - 20

    
    scope_label = "Machine" if asset_uid else ("Section" if section else "Department")
    scope_target = machine_name or section or get_scope_unit_display(department)
    meta_rows = [
        ("Category", category_title),
        ("Scope", scope_label),
        ("Scope Target", scope_target or "—"),
        ("Reporting Period", _range_label_from_dates(start_date, end_date)),
        ("Generated At", datetime.now().strftime("%d %b %Y %H:%M")),
        ("Created By", reported_by or "—"),
    ]
    y = table_kv("Report Metadata", meta_rows, 15 * mm, y)

    # --- Executive summary (rule-based, data-driven) ---
    bullets = [str(s) for s in (analysis.get("insights") or []) if str(s).strip()]
    if bullets:
        y = table_exec_summary("Executive Summary (Insights)", bullets, 15 * mm, y)

    # --- Selected metrics (from configuration) ---
    metric_labels = {
        "mtbf": ("MTBF (hrs)", "mtbf_hours"),
        "mttr": ("MTTR (hrs)", "mttr_hours"),
        "availability": ("Operational Availability (%)", "availability_pct"),
        "downtime": ("Unscheduled Downtime (hrs)", "downtime_hours"),
        "failure_rate": ("Failure Rate (per day)", "failure_rate_per_day"),
        "health_score": ("Asset Health Score", "health_score"),
        "incidents": ("Total Incidents", "incidents"),
        "loss_estimate": ("Estimated Production Loss", "loss_estimate"),
        "pm_adherence": ("PM Adherence (%)", "pm_adherence_pct"),
        "pm_on_time": ("PM On-time (%)", "pm_on_time_pct"),
        "sop_validation": ("SOP Validation (%)", "sop_validation_pct"),
        "audit_readiness": ("Audit Readiness (%)", "audit_readiness_pct"),
        "late_tasks": ("Late / Overdue PM Tasks", "late_tasks"),
        "stockouts": ("Stock-outs (count)", "stockouts"),
        "inventory_value": ("Inventory Value", "inventory_value"),
        "turnover": ("Stock Turnover Ratio", "turnover"),
        "dead_stock": ("Dead Stock Items", "dead_stock"),
        "consumption_vs_proc": ("Consumption vs Procurement", "consumption_vs_proc"),
        "vendor_reliability": ("Vendor Reliability (%)", "vendor_reliability_pct"),
        "value_realized": ("Value Realized", "value_realized"),
        "roi_multiplier": ("ROI Multiplier", "roi_multiplier"),
        "life_extension": ("Asset Life Extension (yrs)", "life_extension_years"),
        "breakeven": ("Break-even (months)", "breakeven_months"),
    }

    sel = analysis.get("selected_metrics") or []
    if not sel:
        sel = []

    metric_rows = []
    for key in sel:
        if key in metric_labels:
            label, kkey = metric_labels[key]
            val = (analysis.get("kpis") or {}).get(kkey)
            if val is None:
                val = "—"
            metric_rows.append((label, str(val)))

    # Fallback: show center KPIs if nothing was selected/mapped
    if not metric_rows:
        metric_rows = [(str(k).replace("_", " ").upper(), str(v)) for k, v in (analysis.get("center_kpis") or {}).items()]

    if metric_rows:
        y = table_kv("Key Metrics", metric_rows, 15 * mm, y)

    cost_rows = [
        ("Amount Before VAT", _kes_label((analysis.get("kpis") or {}).get("combined_cost_subtotal"))),
        ("Maintenance VAT", _kes_label((analysis.get("kpis") or {}).get("maintenance_vat_total"))),
        ("Breakdown VAT", _kes_label((analysis.get("kpis") or {}).get("breakdown_vat_total"))),
        ("VAT Rate(s)", str((analysis.get("kpis") or {}).get("vat_rate_label") or "—")),
        ("Total Cost", _kes_label((analysis.get("kpis") or {}).get("combined_cost_total"))),
    ]
    y = table_kv("Cost & VAT Summary", cost_rows, 15 * mm, y)

    # --- Hotspots (top contributors) ---
    ta = analysis.get("top_assets") or []
    if ta:
        rows = [("Asset", "Incidents / Downtime (hrs)")]
        for name, stats in ta:
            rows.append((name, f"{int(stats.get('incidents',0))} / {round(float(stats.get('downtime_hours',0.0)),1)}"))
        # render as KV table with blank left header style
        y = table_kv("Top Asset Hotspots", rows[1:], 15 * mm, y)

    tc = analysis.get("top_causes") or []
    if tc:
        rows = [(cause, str(cnt)) for cause, cnt in tc]
        y = table_kv("Top Root Causes", rows, 15 * mm, y)

        # Move to next page before charts (charts function can manage its own layout)
        c.showPage()

        # 3) Charts page
        _add_charts_page_pdf(c, category_key, department, start_date, end_date, analysis)

        # Done (do NOT call c.showPage() again here, charts page should decide its own pagination)



def _add_charts_page_pdf(c, category_key: str, department: str, start_date: str, end_date: str, analysis: dict):
    """Charts page (matplotlib -> embedded PNGs).

    Uses the same analysis dict that drives the narrative, so charts always match the selected scope/period.
    """
    import io
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.lib import colors

    W, H = A4
    body_top = _draw_pdf_header(c, W, H, department=department, start_date=start_date, end_date=end_date, report_title=(analysis.get('report_title') or 'Performance Report'), page_title="Charts & Patterns", machine_name=(analysis.get("machine_name") or ""), serial_number=(analysis.get("serial_number") or ""), reported_by=(analysis.get("reported_by") or ""))
    y = body_top - 12 * mm

    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(15 * mm, y, "Charts & Patterns")
    y -= 10 * mm

    timeline = analysis.get("timeline") or []
    top_causes = analysis.get("top_causes") or []
    top_assets = analysis.get("top_assets") or []
    availability_by_section = analysis.get("availability_by_section") or []
    pm_status_counts = analysis.get("pm_status_counts") or {}
    inventory_top_value = analysis.get("inventory_top_value") or []

    charts = []

    def _add_line_chart(title: str, xs, ys, xlab="Date", ylab="Count"):
        fig = plt.figure(figsize=(8, 2.6))
        ax = fig.add_subplot(111)
        ax.plot(xs, ys, marker="o")
        try:
            if ys and max(ys) == min(ys):
                top = float(max(ys))
                ax.set_ylim(0, max(1.0, top * 1.2 + 1.0))
        except Exception:
            pass
        ax.set_title(title)
        ax.set_xlabel(xlab)
        ax.set_ylabel(ylab)
        ax.tick_params(axis="x", rotation=45)
        buf = io.BytesIO()
        fig.tight_layout()
        fig.savefig(buf, format="png", dpi=160)
        plt.close(fig)
        buf.seek(0)
        charts.append((title, buf))

    def _add_bar_chart(title: str, labels, vals):
        fig = plt.figure(figsize=(8, 2.6))
        ax = fig.add_subplot(111)
        ax.bar(labels, vals)
        ax.set_title(title)
        ax.tick_params(axis="x", rotation=30)
        buf = io.BytesIO()
        fig.tight_layout()
        fig.savefig(buf, format="png", dpi=160)
        plt.close(fig)
        buf.seek(0)
        charts.append((title, buf))

    # Always include incidents timeline if available
    if timeline:
        # Reduce overplotting: prefer non-zero days; if still dense, aggregate.
        pts = [(p.get("date"), int(p.get("count") or 0)) for p in timeline]
        nz = [(d,cnt) for (d,cnt) in pts if cnt > 0]
        use = nz if len(nz) >= 5 else pts

        def _parse(d):
            try:
                return datetime.strptime(d, "%Y-%m-%d").date()
            except Exception:
                return None

        # If too many points, aggregate by week/month.
        # IMPORTANT: check the larger threshold first.
        label = "daily"
        if len(use) > 180:
            label = "monthly"
            buckets={}
            for d,cnt in use:
                dd=_parse(d)
                if not dd: continue
                k=dd.strftime("%Y-%m")
                buckets[k]=buckets.get(k,0)+cnt
            xs=sorted(buckets.keys())
            ys=[buckets[k] for k in xs]
        elif len(use) > 90:
            label = "weekly"
            buckets = {}
            for d,cnt in use:
                dd=_parse(d)
                if not dd: continue
                y,w,_=dd.isocalendar()
                k=f"{y}-W{int(w):02d}"
                buckets[k]=buckets.get(k,0)+cnt
            xs=sorted(buckets.keys())
            ys=[buckets[k] for k in xs]
        else:
            xs=[d for d,_ in use]
            ys=[c for _,c in use]

        _add_line_chart(f"Incidents Trend ({label})", xs, ys, ylab="Incidents")

    # Category-specific charts (stay truthful: only render when underlying data exists)
    if category_key == "maintenance_compliance":
        if pm_status_counts:
            labels = ["Scheduled", "Completed", "Open", "Overdue"]
            vals = [
                int(pm_status_counts.get("scheduled") or 0),
                int(pm_status_counts.get("completed") or 0),
                int(pm_status_counts.get("open") or 0),
                int(pm_status_counts.get("overdue") or 0),
            ]
            _add_bar_chart("PM Task Status (count)", labels, vals)

    elif category_key == "inventory_spares":
        if inventory_top_value:
            labels = [x.get("name","Item")[:18] for x in inventory_top_value]
            vals = [float(x.get("value") or 0.0) for x in inventory_top_value]
            _add_bar_chart("Top Inventory Items by Value", labels, vals)

    elif category_key == "asset_reliability":
        if availability_by_section:
            labels = [x.get("section","Section")[:18] for x in availability_by_section]
            vals = [float(x.get("availability_pct") or 0.0) for x in availability_by_section]
            _add_bar_chart("Availability by Section (%)", labels, vals)
        if top_assets:
            labels = [x[0][:18] for x in top_assets]
            vals = [float(x[1].get("downtime_hours", 0.0)) for x in top_assets]
            _add_bar_chart("Top Assets by Downtime (hrs)", labels, vals)

    else:
        # breakdown_analytics + strategic_roi fallback
        if top_causes:
            labels = [x[0][:18] for x in top_causes]
            vals = [int(x[1]) for x in top_causes]
            _add_bar_chart("Top Root Causes (count)", labels, vals)
        if top_assets:
            labels = [x[0][:18] for x in top_assets]
            vals = [float(x[1].get("downtime_hours", 0.0)) for x in top_assets]
            _add_bar_chart("Top Assets by Downtime (hrs)", labels, vals)
    if not charts:
        c.setFont("Helvetica", 11)
        c.setFillColor(colors.HexColor("#374151"))
        c.drawString(15 * mm, y, "No chartable data was found for this scope/period.")
        c.showPage()
        return

    # Draw up to 2 charts per page
    for i, (title, buf) in enumerate(charts):
        img = ImageReader(buf)
        c.drawImage(img, 15 * mm, y - 65 * mm, width=W - 30 * mm, height=60 * mm, preserveAspectRatio=True, mask="auto")
        y -= 75 * mm
        if y < 40 * mm and i != len(charts) - 1:
            c.showPage()
            body_top = _draw_pdf_header(c, W, H, department=department, start_date=start_date, end_date=end_date, report_title=(analysis.get('report_title') or 'Performance Report'), page_title="Charts & Patterns (cont.)", machine_name=(analysis.get("machine_name") or ""), serial_number=(analysis.get("serial_number") or ""), reported_by=(analysis.get("reported_by") or ""))
            y = body_top - 12 * mm
            c.setFillColor(colors.HexColor("#111827"))
            c.setFont("Helvetica-Bold", 14)
            c.drawString(15 * mm, y, "Charts & Patterns (cont.)")
            y -= 10 * mm

    c.showPage()



def _wizard_get() -> dict:
    return session.get("report_wizard", {}) or {}


def _wizard_set(patch: dict):
    w = _wizard_get()
    w.update(patch or {})
    session["report_wizard"] = w


def _wizard_clear():
    session.pop("report_wizard", None)
    session.pop("report_wizard_category", None)


@app.get("/settings")
@permission_required("settings_manage")
def settings_admin():
    ctx = base_ctx("settings")
    ctx.update(
        settings=SYSTEM_SETTINGS,
        technicians=TECHNICIAN_DIRECTORY,
        admin_users=ADMIN_USERS,
        total_assets=len(ASSETS),
        total_breakdowns=len(BREAKDOWNS),
        total_tasks=len(MAINTENANCE_TASKS),
        total_reports=len(REPORT_EXPORTS),
    )
    return render_template("settings/settings_admin.html", **ctx)


@app.post("/settings")
@permission_required("settings_manage")
def settings_admin_save():
    SYSTEM_SETTINGS.update({
        "mail_signature_name": (request.form.get("mail_signature_name") or "").strip() or SYSTEM_SETTINGS.get("mail_signature_name") or "Engineering Reliability Office",
        "mail_signature_title": (request.form.get("mail_signature_title") or "").strip() or SYSTEM_SETTINGS.get("mail_signature_title") or "Opsloom Reports Automation",
        "mail_signature_footer": (request.form.get("mail_signature_footer") or "").strip() or SYSTEM_SETTINGS.get("mail_signature_footer") or "Opsloom",
        "mail_signature_font": (request.form.get("mail_signature_font") or "").strip() or SYSTEM_SETTINGS.get("mail_signature_font") or "Inter",
        "mail_signature_color": (request.form.get("mail_signature_color") or "").strip() or SYSTEM_SETTINGS.get("mail_signature_color") or "#1554FF",
        "mail_signature_style": (request.form.get("mail_signature_style") or "").strip() or SYSTEM_SETTINGS.get("mail_signature_style") or "formal",
        "mail_signature_image_url": (request.form.get("mail_signature_image_url") or "").strip(),
        "company_contact_email": (request.form.get("company_contact_email") or "").strip(),
        "company_contact_phone": (request.form.get("company_contact_phone") or "").strip(),
        "smtp_host": (request.form.get("smtp_host") or "").strip(),
        "smtp_port": int(request.form.get("smtp_port") or SYSTEM_SETTINGS.get("smtp_port") or 587),
        "smtp_user": (request.form.get("smtp_user") or "").strip(),
        "smtp_pass": (request.form.get("smtp_pass") or SYSTEM_SETTINGS.get("smtp_pass") or "").strip(),
        "smtp_from": (request.form.get("smtp_from") or "").strip(),
        "report_watermark": (request.form.get("report_watermark") or "").strip() or "Internal Use",
        "default_report_recipients": [e.strip() for e in (request.form.get("default_report_recipients") or "").replace(";", ",").split(",") if e.strip()],
    })
    push_notification("Settings updated", "System communication settings were updated successfully.", "success", href=url_for("settings_admin"))
    flash("Settings saved.", "success")
    return redirect(url_for("settings_admin"))


@app.get("/technicians")
@permission_required("technicians_manage")
def technicians_management():
    ctx = base_ctx("settings")
    workload = technician_workload_snapshot(get_current_department())
    ctx.update(
        technicians=workload,
        technician_summary={
            "count": len(workload),
            "open_pm": sum(int(x.get("open_pm") or 0) for x in workload),
            "active_breakdowns": sum(int(x.get("active_breakdowns") or 0) for x in workload),
            "avg_availability": round(sum(int(x.get("availability_score") or 0) for x in workload) / max(1, len(workload)), 1),
        },
    )
    return render_template("settings/technicians_management.html", **ctx)


@app.get("/api/technicians/<tech_id>/profile")
@permission_required("technicians_manage")
def technician_profile_api(tech_id):
    profile = technician_profile_payload(tech_id, get_current_department())
    if not profile:
        abort(404)
    return jsonify(profile)


@app.post("/technicians")
@permission_required("technicians_manage")
def technicians_create():
    name = (request.form.get("name") or "").strip()
    if not name:
        flash("Technician name is required.", "error")
        return redirect(url_for("technicians_management"))
    TECHNICIAN_DIRECTORY.insert(0, {
        "id": f"TECH-{uuid4().hex[:6].upper()}",
        "name": name,
        "role": (request.form.get("role") or "Technician").strip(),
        "discipline": (request.form.get("discipline") or "General").strip(),
        "phone": (request.form.get("phone") or "").strip(),
        "email": (request.form.get("email") or "").strip(),
        "active": True,
    })
    refresh_technician_names()
    push_notification("Technician added", f"{name} was added to the technician directory.", "success", href=url_for("technicians_management"))
    return redirect(url_for("technicians_management"))


@app.post("/technicians/<tech_id>/toggle")
@permission_required("technicians_manage")
def technicians_toggle(tech_id):
    row = next((t for t in TECHNICIAN_DIRECTORY if t.get("id") == tech_id), None)
    if not row:
        abort(404)
    row["active"] = not bool(row.get("active", True))
    refresh_technician_names()
    push_notification("Technician updated", f"{row.get('name')} status changed to {'Active' if row.get('active') else 'Inactive'}.", "info", href=url_for("technicians_management"))
    return redirect(url_for("technicians_management"))


@app.post("/technicians/<tech_id>/delete")
@permission_required("technicians_manage")
def technicians_delete(tech_id):
    idx = next((i for i, t in enumerate(TECHNICIAN_DIRECTORY) if t.get("id") == tech_id), None)
    if idx is None:
        abort(404)
    deleted = TECHNICIAN_DIRECTORY.pop(idx)
    refresh_technician_names()
    push_notification("Technician removed", f"{deleted.get('name')} was removed from the directory.", "warning", href=url_for("technicians_management"))
    return redirect(url_for("technicians_management"))


@app.get("/admin/users")
@permission_required("users_manage")
def admin_users_page():
    ctx = base_ctx("settings")
    users = [_normalize_user_record(u) for u in ADMIN_USERS]
    edit_id = (request.args.get("edit") or "").strip()
    edit_user = next((u for u in users if (u.get("id") or "") == edit_id), None)
    ctx.update(admin_users=users, edit_user=edit_user)
    return render_template("settings/admin_users.html", **ctx)


@app.post("/admin/users")
@permission_required("users_manage")
def admin_users_create():
    user_id = (request.form.get("user_id") or "").strip()
    name = (request.form.get("name") or "").strip()
    email = (request.form.get("email") or "").strip().lower()
    if not name or not email:
        flash("Name and email are required for user access setup.", "error")
        return redirect(url_for("admin_users_page", edit=user_id) if user_id else url_for("admin_users_page"))

    role = (request.form.get("role") or "Viewer").strip()
    access_scope = (request.form.get("access_scope") or "Department").strip()
    department = (request.form.get("department") or "Engineering").strip()
    permissions = [p.strip() for p in request.form.getlist("permissions") if (p or "").strip()]
    if not permissions:
        permissions = default_permissions_for_role(role)
    password = (request.form.get("password") or "").strip()
    active = request.form.get("active") == "1"

    payload = _normalize_user_record({
        "id": user_id or f"USR-{uuid4().hex[:6].upper()}",
        "name": name,
        "email": email,
        "role": role,
        "access_scope": access_scope,
        "department": department if department in DEPARTMENTS else "Engineering",
        "active": active,
        "permissions": permissions,
        "signature_name": (request.form.get("signature_name") or name).strip(),
        "signature_title": (request.form.get("signature_title") or role).strip(),
        "signature_font": (request.form.get("signature_font") or SYSTEM_SETTINGS.get("mail_signature_font") or "Inter").strip(),
        "signature_color": (request.form.get("signature_color") or SYSTEM_SETTINGS.get("mail_signature_color") or "#1554FF").strip(),
        "signature_style": (request.form.get("signature_style") or SYSTEM_SETTINGS.get("mail_signature_style") or "formal").strip(),
        "signature_image_url": (request.form.get("signature_image_url") or "").strip(),
    })
    existing_idx = next((i for i, u in enumerate(ADMIN_USERS) if (u.get("id") or "") == user_id), None) if user_id else None
    if existing_idx is None and not password:
        flash("Create the user with an initial password.", "error")
        return redirect(url_for("admin_users_page"))
    if password:
        payload["password_hash"] = generate_password_hash(password)

    if existing_idx is not None:
        existing = _normalize_user_record(ADMIN_USERS[existing_idx])
        if not payload.get("password_hash") and existing.get("password_hash"):
            payload["password_hash"] = existing.get("password_hash")
        ADMIN_USERS[existing_idx] = payload
        push_notification("User access updated", f"{name} profile and privileges were updated.", "success", href=url_for("admin_users_page"), module="users")
    else:
        ADMIN_USERS.insert(0, payload)
        push_notification("User access updated", f"{name} was added to the admin access register.", "success", href=url_for("admin_users_page"), module="users")
    return redirect(url_for("admin_users_page"))


@app.post("/admin/users/<user_id>/toggle")
@permission_required("users_manage")
def admin_users_toggle(user_id):
    row = next((u for u in ADMIN_USERS if u.get("id") == user_id), None)
    if not row:
        abort(404)
    row["active"] = not bool(row.get("active", True))
    push_notification("User access updated", f"{row.get('name')} is now {'active' if row.get('active') else 'inactive'}.", "info", href=url_for("admin_users_page"), module="users")
    return redirect(url_for("admin_users_page"))


@app.post("/admin/users/<user_id>/delete")
@permission_required("users_manage")
def admin_users_delete(user_id):
    idx = next((i for i, u in enumerate(ADMIN_USERS) if u.get("id") == user_id), None)
    if idx is None:
        abort(404)
    deleted = ADMIN_USERS.pop(idx)
    if session.get("user_id") == user_id:
        session.clear()
        flash("Your user record was removed. Sign in again with another account.", "info")
        return redirect(url_for("login"))
    push_notification("User deleted", f"{deleted.get('name')} was removed from the access register.", "warning", href=url_for("admin_users_page"), module="users")
    return redirect(url_for("admin_users_page"))


@app.get("/logout")
def logout():
    try:
        _save_store_from_memory()
        _write_persistence_backups(force=True)
    except Exception:
        pass
    session.clear()
    flash("You have been signed out.", "success")
    return redirect(url_for("login"))


def _notification_target_href(row: dict | None) -> str:
    row = row or {}
    href = (row.get("href") or "").strip()
    title = (row.get("title") or "").lower()
    message = (row.get("message") or "").lower()
    if href.startswith("/"):
        return href
    if "credential" in title or "password reset" in title or "user access" in title or "google sign-in" in title:
        return url_for("admin_users_page")
    if "support" in title or "help" in title:
        return url_for("help_page")
    if "technician" in title:
        return url_for("technicians_management")
    if "report" in title or "emailed" in message:
        return url_for("reports_center")
    if "inventory" in title or "stock" in message:
        return url_for("inventory_management")
    if "maintenance" in title or "pm" in message:
        return url_for("maintenance_management")
    if "breakdown" in title or "downtime" in message:
        return url_for("breakdowns_management")
    return url_for("dashboard")


@app.get("/notifications/<notification_id>/open")
def notifications_open(notification_id):
    row = next((n for n in SYSTEM_NOTIFICATIONS if n.get("id") == notification_id), None)
    if not row:
        abort(404)
    row["is_read"] = True
    return redirect(_notification_target_href(row))


@app.post("/notifications/<notification_id>/dismiss")
def notifications_dismiss(notification_id):
    row = next((n for n in SYSTEM_NOTIFICATIONS if n.get("id") == notification_id), None)
    if not row:
        abort(404)
    row["is_read"] = True
    return ("", 204)


@app.get("/notifications")
def notifications():
    ctx = base_ctx("settings")
    items = sorted(SYSTEM_NOTIFICATIONS, key=lambda n: n.get("created_at") or "", reverse=True)
    ctx.update(notifications=items)
    return render_template("settings/notifications.html", **ctx)


@app.post("/notifications/read-all")
def notifications_read_all():
    for row in SYSTEM_NOTIFICATIONS:
        row["is_read"] = True
    return redirect(url_for("notifications"))


@app.post("/notifications/<notification_id>/toggle")
def notifications_toggle(notification_id):
    row = next((n for n in SYSTEM_NOTIFICATIONS if n.get("id") == notification_id), None)
    if not row:
        abort(404)
    row["is_read"] = not bool(row.get("is_read"))
    return redirect(url_for("notifications"))


@app.get("/messages")
def messages_center():
    ctx = base_ctx("settings")
    email = (ctx.get("current_user_email") or "").strip().lower()
    q = (request.args.get("q") or "").strip().lower()
    folder = (request.args.get("folder") or "inbox").strip().lower()
    if folder not in {"inbox", "sent", "drafts", "outbox"}:
        folder = "inbox"
    open_id = (request.args.get("open") or "").strip()
    reply_to = (request.args.get("reply") or "").strip()
    forward_id = (request.args.get("forward") or "").strip()

    def _match_query(row: dict) -> bool:
        if not q:
            return True
        hay = " ".join([row.get("sender_name") or "", row.get("subject") or "", row.get("body") or "", ", ".join(row.get("recipient_emails") or [])]).lower()
        return q in hay

    if folder == "sent":
        items = [m for m in INTERNAL_MESSAGES if (m.get("sender_email") or "").strip().lower() == email and _match_query(m)]
    elif folder == "drafts":
        items = [m for m in DRAFT_MESSAGES if (m.get("sender_email") or "").strip().lower() == email and _match_query(m)]
    elif folder == "outbox":
        items = [m for m in OUTBOX_MESSAGES if (m.get("sender_email") or "").strip().lower() == email and _match_query(m)]
    else:
        items = []
        for m in INTERNAL_MESSAGES:
            recips = [str(x).strip().lower() for x in (m.get("recipient_emails") or []) if str(x).strip()]
            if email in recips and _match_query(m):
                items.append(m)
    items.sort(key=lambda x: x.get("updated_at") or x.get("created_at") or "", reverse=True)
    open_row = next((m for m in items if m.get("id") == open_id), None) or (items[0] if items else None)
    if folder == "inbox" and open_row:
        seen = {str(x).strip().lower() for x in (open_row.get("is_read_by") or []) if str(x).strip()}
        if email and email not in seen:
            open_row.setdefault("is_read_by", []).append(email)
    users = [_normalize_user_record(u) for u in ADMIN_USERS if u.get("active", True)]
    prefill = {"subject": "", "body": "", "recipient_emails": [], "thread_id": "", "forwarded_from": "", "draft_id": "", "outbox_id": ""}
    if folder in {"drafts", "outbox"} and open_row:
        prefill = {
            "subject": open_row.get("subject") or "",
            "body": open_row.get("body") or "",
            "recipient_emails": open_row.get("recipient_emails") or [],
            "thread_id": open_row.get("thread_id") or "",
            "forwarded_from": open_row.get("forwarded_from") or "",
            "draft_id": open_row.get("id") if folder == "drafts" else "",
            "outbox_id": open_row.get("id") if folder == "outbox" else "",
        }
    if reply_to:
        src = next((m for m in INTERNAL_MESSAGES if m.get("id") == reply_to), None)
        if src:
            prefill = {
                "subject": src.get("subject") if str(src.get("subject") or "").lower().startswith("re:") else f"Re: {src.get('subject') or ''}",
                "body": f"\n\n--- Original message ---\nFrom: {src.get('sender_name')}\n{src.get('body') or ''}",
                "recipient_emails": [(src.get("sender_email") or "").strip().lower()],
                "thread_id": src.get("thread_id") or src.get("id"),
                "forwarded_from": "",
                "draft_id": "",
                "outbox_id": "",
            }
    elif forward_id:
        src = next((m for m in INTERNAL_MESSAGES if m.get("id") == forward_id), None)
        if src:
            prefill = {
                "subject": src.get("subject") if str(src.get("subject") or "").lower().startswith("fwd:") else f"Fwd: {src.get('subject') or ''}",
                "body": f"\n\n--- Forwarded message ---\nFrom: {src.get('sender_name')}\nTo: {', '.join(src.get('recipient_emails') or [])}\n{src.get('body') or ''}",
                "recipient_emails": [],
                "thread_id": src.get("thread_id") or src.get("id"),
                "forwarded_from": src.get("id"),
                "draft_id": "",
                "outbox_id": "",
            }
    folder_counts = _message_folder_counts(email)
    ctx.update(messages=items, open_message=open_row, message_q=q, users=users, compose_prefill=prefill, selected_folder=folder, folder_counts=folder_counts)
    return render_template("settings/messages_center.html", **ctx)


@app.post("/messages/send")
def messages_send():
    ctx = base_ctx("settings")
    sender_email = (ctx.get("current_user_email") or "opsloom.ke@gmail.com").strip().lower()
    sender_name = (ctx.get("current_user_name") or "System").strip()
    recipients = [str(x).strip().lower() for x in request.form.getlist("recipient_emails") if str(x).strip()]
    manual = [x.strip().lower() for x in (request.form.get("recipient_manual") or "").replace(";", ",").split(",") if x.strip()]
    recipients.extend(manual)
    subject = (request.form.get("subject") or "").strip()
    body = (request.form.get("body") or "").strip()
    thread_id = (request.form.get("thread_id") or "").strip() or None
    forwarded_from = (request.form.get("forwarded_from") or "").strip()
    action = (request.form.get("message_action") or "send").strip().lower()
    draft_id = (request.form.get("draft_id") or "").strip()
    outbox_id = (request.form.get("outbox_id") or "").strip()
    attachments = []
    for f in request.files.getlist("attachments"):
        if not f or not f.filename:
            continue
        try:
            url = save_uploaded_doc(f, MESSAGE_UPLOAD_DIR, "uploads/messages")
        except ValueError:
            flash("Message attachments must be supported documents/images and under 10MB.", "error")
            return redirect(url_for("messages_center", folder=action if action in ("draft", "outbox") else "inbox"))
        attachments.append({"name": secure_filename(f.filename), "url": url})
    if action == "draft":
        if not any([subject, body, recipients, attachments]):
            flash("Add at least a subject, message, recipient, or attachment before saving a draft.", "error")
            return redirect(url_for("messages_center", folder="drafts"))
        row = next((m for m in DRAFT_MESSAGES if m.get("id") == draft_id and (m.get("sender_email") or "").strip().lower() == sender_email), None)
        if row:
            row.update({"recipient_emails": recipients, "subject": subject or row.get("subject") or "Untitled message", "body": body, "thread_id": thread_id or row.get("thread_id"), "forwarded_from": forwarded_from or row.get("forwarded_from"), "updated_at": datetime.now().isoformat(timespec="seconds")})
            if attachments:
                row["attachments"] = (row.get("attachments") or []) + attachments
            msg_id = row.get("id")
        else:
            row = _build_message_record(sender_email, sender_name, recipients, subject, body, attachments=attachments, thread_id=thread_id, forwarded_from=forwarded_from, delivery_status="draft")
            DRAFT_MESSAGES.insert(0, row)
            del DRAFT_MESSAGES[300:]
            msg_id = row.get("id")
        push_notification("Draft saved", f"{subject or 'Untitled message'} was saved to drafts.", "info", href=url_for("messages_center", folder="drafts", open=msg_id), toast=True, module="messages")
        flash("Draft saved.", "success")
        return redirect(url_for("messages_center", folder="drafts", open=msg_id))
    if action == "outbox":
        if not recipients or not subject or not body:
            flash("Recipient, subject, and message body are required to queue an outbox message.", "error")
            return redirect(url_for("messages_center", folder="outbox"))
        row = next((m for m in OUTBOX_MESSAGES if m.get("id") == outbox_id and (m.get("sender_email") or "").strip().lower() == sender_email), None)
        if row:
            row.update({"recipient_emails": recipients, "subject": subject, "body": body, "thread_id": thread_id or row.get("thread_id"), "forwarded_from": forwarded_from or row.get("forwarded_from"), "updated_at": datetime.now().isoformat(timespec="seconds")})
            if attachments:
                row["attachments"] = (row.get("attachments") or []) + attachments
            msg_id = row.get("id")
        else:
            row = _build_message_record(sender_email, sender_name, recipients, subject, body, attachments=attachments, thread_id=thread_id, forwarded_from=forwarded_from, delivery_status="queued")
            OUTBOX_MESSAGES.insert(0, row)
            del OUTBOX_MESSAGES[300:]
            msg_id = row.get("id")
        push_notification("Outbox updated", f"{subject or 'Message'} is queued in outbox.", "info", href=url_for("messages_center", folder="outbox", open=msg_id), toast=True, module="messages")
        flash("Message queued in outbox.", "success")
        return redirect(url_for("messages_center", folder="outbox", open=msg_id))
    if not recipients or not subject or not body:
        flash("Recipient, subject, and message body are required.", "error")
        return redirect(url_for("messages_center", folder="inbox"))
    msg = push_internal_message(sender_email, sender_name, recipients, subject, body, attachments=attachments, thread_id=thread_id, forwarded_from=forwarded_from)
    if draft_id:
        DRAFT_MESSAGES[:] = [m for m in DRAFT_MESSAGES if not (m.get("id") == draft_id and (m.get("sender_email") or "").strip().lower() == sender_email)]
    if outbox_id:
        OUTBOX_MESSAGES[:] = [m for m in OUTBOX_MESSAGES if not (m.get("id") == outbox_id and (m.get("sender_email") or "").strip().lower() == sender_email)]
    flash("Message sent.", "success")
    return redirect(url_for("messages_center", folder="sent", open=msg["id"]))


@app.post("/messages/drafts/<message_id>/delete")
def messages_delete_draft(message_id):
    sender_email = (base_ctx("settings").get("current_user_email") or "").strip().lower()
    before = len(DRAFT_MESSAGES)
    DRAFT_MESSAGES[:] = [m for m in DRAFT_MESSAGES if not (m.get("id") == message_id and (m.get("sender_email") or "").strip().lower() == sender_email)]
    if len(DRAFT_MESSAGES) != before:
        push_notification("Draft removed", "The selected draft was removed.", "warning", href=url_for("messages_center", folder="drafts"), toast=True, module="messages")
        flash("Draft deleted.", "success")
    return redirect(url_for("messages_center", folder="drafts"))


@app.post("/messages/outbox/<message_id>/delete")
def messages_delete_outbox(message_id):
    sender_email = (base_ctx("settings").get("current_user_email") or "").strip().lower()
    before = len(OUTBOX_MESSAGES)
    OUTBOX_MESSAGES[:] = [m for m in OUTBOX_MESSAGES if not (m.get("id") == message_id and (m.get("sender_email") or "").strip().lower() == sender_email)]
    if len(OUTBOX_MESSAGES) != before:
        push_notification("Outbox message removed", "The selected outbox message was removed.", "warning", href=url_for("messages_center", folder="outbox"), toast=True, module="messages")
        flash("Outbox message deleted.", "success")
    return redirect(url_for("messages_center", folder="outbox"))


@app.post("/messages/outbox/<message_id>/send")
def messages_send_outbox(message_id):
    ctx = base_ctx("settings")
    sender_email = (ctx.get("current_user_email") or "").strip().lower()
    sender_name = (ctx.get("current_user_name") or "System").strip()
    row = next((m for m in OUTBOX_MESSAGES if m.get("id") == message_id and (m.get("sender_email") or "").strip().lower() == sender_email), None)
    if not row:
        abort(404)
    msg = push_internal_message(sender_email, sender_name, row.get("recipient_emails") or [], row.get("subject") or "Untitled message", row.get("body") or "", attachments=row.get("attachments") or [], thread_id=row.get("thread_id"), forwarded_from=row.get("forwarded_from") or "")
    OUTBOX_MESSAGES[:] = [m for m in OUTBOX_MESSAGES if m.get("id") != message_id]
    flash("Outbox message sent.", "success")
    return redirect(url_for("messages_center", folder="sent", open=msg["id"]))


@app.get("/audit-trail")
@permission_required("settings_manage")
def audit_trail_page():
    ctx = base_ctx("settings")
    q_raw = (request.args.get("q") or "").strip()
    module_raw = (request.args.get("module") or "").strip()
    items = _filtered_audit_rows(q_raw, module_raw)
    modules = sorted({str(r.get("module") or "general").strip() for r in AUDIT_TRAIL if str(r.get("module") or "").strip()})
    ctx.update(audit_rows=items[:200], audit_q=q_raw, selected_module=module_raw, audit_modules=modules)
    return render_template("settings/audit_trail.html", **ctx)




def _filtered_audit_rows(q_raw: str = "", module_raw: str = "") -> list[dict]:
    q = (q_raw or "").strip().lower()
    module = (module_raw or "").strip().lower()
    items = list(AUDIT_TRAIL)
    if q:
        items = [r for r in items if q in " ".join([str(r.get("action") or ""), str(r.get("detail") or ""), str(r.get("user_name") or ""), str(r.get("user_email") or "")]).lower()]
    if module:
        items = [r for r in items if str(r.get("module") or "").strip().lower() == module]
    items.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return items


@app.get("/audit-trail/export")
@permission_required("settings_manage")
def audit_trail_export():
    fmt = (request.args.get("format") or "pdf").strip().lower()
    inline = (request.args.get("inline") or "").strip().lower() in ("1", "true", "yes")
    q_raw = (request.args.get("q") or "").strip()
    module_raw = (request.args.get("module") or "").strip()
    items = _filtered_audit_rows(q_raw, module_raw)
    dept = get_current_department()

    if fmt in ("preview", "html") or (fmt == "pdf" and inline):
        ctx = base_ctx("settings")
        ctx.update(audit_rows=items[:1000], audit_q=q_raw, selected_module=module_raw, export_mode=True, total_audit_rows=len(items), audit_generated_at=datetime.now().strftime("%Y-%m-%d %H:%M"))
        return render_template("settings/audit_trail_print.html", **ctx)

    if fmt == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        wb = Workbook()
        ws = wb.active
        ws.title = "Audit Trail"
        title_fill = PatternFill("solid", fgColor="1554FF")
        head_fill = PatternFill("solid", fgColor="0B1020")
        white_bold = Font(bold=True, color="FFFFFF")
        thin = Side(style="thin", color="CBD5E1")
        border = Border(left=thin, right=thin, top=thin, bottom=thin)
        wrap = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells("A1:F1")
        ws["A1"] = "Opsloom Audit Trail Export"
        ws["A1"].font = Font(bold=True, size=16, color="FFFFFF")
        ws["A1"].fill = title_fill
        ws["A1"].alignment = Alignment(horizontal="center")
        ws.merge_cells("A2:F2")
        ws["A2"] = f"Department: {report_department_display(dept)} | Rows: {len(items)} | Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        headers = ["Time", "Action", "Module", "User", "Detail", "Open Link"]
        for idx, head in enumerate(headers, start=1):
            cell = ws.cell(row=4, column=idx, value=head)
            cell.font = white_bold
            cell.fill = head_fill
            cell.border = border
            cell.alignment = Alignment(horizontal="center")
        row_no = 5
        for row in items:
            vals = [
                str(row.get("created_at") or "").replace("T", " "),
                row.get("action") or "",
                row.get("module") or "",
                row.get("user_name") or "",
                row.get("detail") or "",
                row.get("href") or "",
            ]
            for col, val in enumerate(vals, start=1):
                cell = ws.cell(row=row_no, column=col, value=val)
                cell.border = border
                cell.alignment = wrap
            row_no += 1
        widths = {1: 22, 2: 28, 3: 18, 4: 22, 5: 68, 6: 28}
        for col, width in widths.items():
            ws.column_dimensions[chr(64 + col)].width = width
        ws.freeze_panes = "A5"
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return send_file(buf, as_attachment=not inline, download_name=f"audit_trail_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx", mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    if fmt != "pdf":
        abort(404)

    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    from reportlab.lib.utils import simpleSplit

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    left = 18
    right = 18
    col_specs = [(66, "Time"), (92, "Action"), (54, "Module"), (72, "User"), (W - left - right - (66 + 92 + 54 + 72), "Detail")]

    def draw_page(page_no: int):
        top_y = _draw_pdf_header(
            c,
            W,
            H,
            department=dept,
            start_date="Audit Trail",
            end_date=datetime.now().strftime("%Y-%m-%d"),
            report_title="Audit Trail",
            page_title=f"Operational Trace • Page {page_no}",
            reported_by=base_ctx("settings")["current_user_name"],
        )
        c.setFont("Helvetica", 8.5)
        c.setFillColor(colors.HexColor("#475569"))
        filter_bits = []
        if q_raw:
            filter_bits.append(f"Search: {q_raw}")
        if module_raw:
            filter_bits.append(f"Module: {module_raw}")
        filter_bits.append(f"Rows: {len(items)}")
        c.drawString(left, top_y, " | ".join(filter_bits))
        y = top_y - 16
        x = left
        c.setFillColor(colors.HexColor("#F8FAFC"))
        c.rect(left, y - 14, W - left - right, 16, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#334155"))
        c.setFont("Helvetica-Bold", 8.5)
        for width, label in col_specs:
            c.drawString(x + 3, y - 4, label)
            x += width
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.line(left, y - 16, W - right, y - 16)
        return y - 22

    page_no = 1
    y = draw_page(page_no)
    bottom_limit = 36
    for row in items:
        data = [
            str(row.get("created_at") or "").replace("T", " "),
            row.get("action") or "",
            row.get("module") or "",
            row.get("user_name") or "",
            row.get("detail") or "",
        ]
        line_sets = [simpleSplit(str(value or ""), "Helvetica", 7.8, max(12, width - 6)) or [""] for (width, _label), value in zip(col_specs, data)]
        row_height = max(18, max(len(lines) for lines in line_sets) * 9 + 6)
        if y - row_height < bottom_limit:
            c.showPage()
            page_no += 1
            y = draw_page(page_no)
        x = left
        c.setStrokeColor(colors.HexColor("#E2E8F0"))
        c.rect(left, y - row_height + 4, W - left - right, row_height, fill=0, stroke=1)
        c.setFillColor(colors.HexColor("#0F172A"))
        for idx, ((width, _label), lines) in enumerate(zip(col_specs, line_sets)):
            yy = y - 8
            c.setFont("Helvetica", 7.8)
            for line in lines:
                c.drawString(x + 3, yy, line[:200])
                yy -= 9
            x += width
            if idx < len(col_specs) - 1:
                c.line(x, y - row_height + 4, x, y + 4)
        y -= row_height
    c.save()
    buf.seek(0)
    return send_file(buf, as_attachment=not inline, download_name=f"audit_trail_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf", mimetype="application/pdf")


@app.route("/help", methods=["GET", "POST"])
def help_page():
    if request.method == "POST":
        subject = (request.form.get("subject") or "").strip() or "General support"
        message = (request.form.get("message") or "").strip()
        push_notification("Support request logged", f"{subject} has been captured for follow-up.", "info", href=url_for("help_page"))
        flash("Support request captured.", "success")
        return redirect(url_for("help_page"))
    help_articles = [
        {"title": "How reports scope works", "body": "Use Selected Machines for specific assets, Section for one production area, and Department for a complete department-wide report.", "tags": ["reports", "scope", "department"]},
        {"title": "How email delivery works", "body": "Report emails will send through SMTP once credentials are saved in Settings / Admin.", "tags": ["email", "smtp", "reports"]},
        {"title": "How to keep printouts formal", "body": "Use the Print action on detail pages and reports to open the business print layout instead of browser-style page screenshots.", "tags": ["print", "reports"]},
        {"title": "How technician assignment works", "body": "Assign technicians from the active technician directory so workload and notifications remain accurate.", "tags": ["technicians", "maintenance"]},
        {"title": "How to manage roles and privileges", "body": "Use Admin Credentials & Users to define access scope, module permissions, and custom sign-off details for each user.", "tags": ["users", "security", "permissions"]},
    ]
    q = (request.args.get("q") or "").strip().lower()
    if q:
        help_articles = [a for a in help_articles if q in (a.get("title") or "").lower() or q in (a.get("body") or "").lower() or any(q in str(t).lower() for t in (a.get("tags") or []))]
    ctx = base_ctx("settings")
    ctx.update(help_articles=help_articles, help_q=q)
    return render_template("settings/help.html", **ctx)


@app.get("/profile")
def profile():
    ctx = base_ctx("settings")
    current = _current_user_record() or (_normalize_user_record(ADMIN_USERS[0]) if ADMIN_USERS else {})
    ctx.update(profile=current, settings=SYSTEM_SETTINGS)
    return render_template("settings/profile.html", **ctx)


@app.post("/profile")
def profile_save():
    current = _current_user_record()
    if not current:
        return redirect(url_for("login"))
    row = next((u for u in ADMIN_USERS if (u.get("id") or "") == current.get("id")), None)
    if not row:
        abort(404)

    row["signature_name"] = (request.form.get("signature_name") or row.get("name") or "").strip()
    row["signature_title"] = (request.form.get("signature_title") or row.get("role") or "").strip()
    row["signature_font"] = (request.form.get("signature_font") or row.get("signature_font") or SYSTEM_SETTINGS.get("mail_signature_font") or "Inter").strip()
    row["signature_color"] = (request.form.get("signature_color") or row.get("signature_color") or SYSTEM_SETTINGS.get("mail_signature_color") or "#1554FF").strip()
    row["signature_style"] = (request.form.get("signature_style") or row.get("signature_style") or SYSTEM_SETTINGS.get("mail_signature_style") or "formal").strip()
    row["signature_image_url"] = (request.form.get("signature_image_url") or row.get("signature_image_url") or "").strip()

    remove_profile_image = request.form.get("remove_profile_image") == "1"
    uploaded_profile = request.files.get("profile_image")
    if remove_profile_image:
        row["profile_image_url"] = ""
    if uploaded_profile and uploaded_profile.filename:
        try:
            row["profile_image_url"] = save_uploaded_image(uploaded_profile, USER_PROFILE_UPLOAD_DIR, "uploads/users")
        except Exception as exc:
            flash(str(exc) if str(exc) else "Invalid profile image upload.", "error")
            return redirect(url_for("profile"))

    push_notification("Profile updated", "Your communication signature details were updated.", "success", href=url_for("profile"))
    flash("Profile updated.", "success")
    return redirect(url_for("profile"))


# Sets department + persists it
@app.get("/department/<department>")
def set_department(department):
    if department not in DEPARTMENTS:
        abort(404)
    session["current_department"] = department
    return redirect(request.referrer or url_for("home"))


if __name__ == "__main__":
    host = os.environ.get("OPSLOOM_HOST") or os.environ.get("FLASK_RUN_HOST") or "0.0.0.0"
    port = int(os.environ.get("PORT") or os.environ.get("OPSLOOM_PORT") or 5000)
    debug_flag = (os.environ.get("FLASK_DEBUG") or os.environ.get("OPSLOOM_DEBUG") or "0").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host=host, port=port, debug=debug_flag)