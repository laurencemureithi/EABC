import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const SEED_DATASTORE_PATH = path.resolve(__dirname, '../data/datastore.json');
const RUNTIME_DATASTORE_PATH = IS_SERVERLESS
  ? path.join('/tmp', 'opsloom_datastore.json')
  : SEED_DATASTORE_PATH;

// Default initial state
let store = {
  version: 4,
  saved_at: new Date().toISOString(),
  COMPANIES: [],
  ASSETS: [],
  BREAKDOWNS: [],
  MAINTENANCE_TASKS: [],
  INVENTORY_PARTS: [],
  SPARE_PARTS: [],
  ASSET_DOCUMENTS: [],
  REPORT_EXPORTS: [],
  AUDIT_TRAIL: [],
  SYSTEM_SETTINGS: {},
  SYSTEM_NOTIFICATIONS: [],
  TECHNICIAN_DIRECTORY: [],
  ADMIN_USERS: [],
  INTERNAL_MESSAGES: [],
  DRAFT_MESSAGES: [],
  OUTBOX_MESSAGES: []
};

let activeCompanyId = 'comp-opsloom';
let currentDepartment = 'Engineering';

export function loadDatastore() {
  try {
    // 1. First load from bundled seed datastore if it exists
    if (fs.existsSync(SEED_DATASTORE_PATH)) {
      try {
        const seedRaw = fs.readFileSync(SEED_DATASTORE_PATH, 'utf8');
        const seedParsed = JSON.parse(seedRaw);
        store = { ...store, ...seedParsed };
      } catch (seedErr) {
        console.warn('Warning: Failed to parse seed datastore.json:', seedErr.message);
      }
    }

    // 2. If runtime datastore exists (e.g. in /tmp on Vercel or local), overlay user mutations
    if (fs.existsSync(RUNTIME_DATASTORE_PATH)) {
      try {
        const runtimeRaw = fs.readFileSync(RUNTIME_DATASTORE_PATH, 'utf8');
        const runtimeParsed = JSON.parse(runtimeRaw);
        store = { ...store, ...runtimeParsed };
      } catch (runtimeErr) {
        console.warn('Warning: Failed to parse runtime datastore.json:', runtimeErr.message);
      }
    } else if (IS_SERVERLESS && fs.existsSync(SEED_DATASTORE_PATH)) {
      // In serverless, create runtime copy in /tmp
      try {
        const dir = path.dirname(RUNTIME_DATASTORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(SEED_DATASTORE_PATH, RUNTIME_DATASTORE_PATH);
      } catch (copyErr) {
        console.warn('Could not initialize /tmp datastore:', copyErr.message);
      }
    }
  } catch (err) {
    console.error('Failed to load datastore:', err);
  }

  ensureDefaults();
  return store;
}

export function saveDatastore() {
  try {
    store.saved_at = new Date().toISOString();
    const dir = path.dirname(RUNTIME_DATASTORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(RUNTIME_DATASTORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to save datastore.json (in-memory state retained):', err.message);
  }
}

export const saveStore = saveDatastore;

function ensureDefaults() {
  if (!store.COMPANIES || store.COMPANIES.length === 0) {
    store.COMPANIES = [
      {
        id: 'comp-opsloom',
        name: 'Opsloom Engineering Core',
        code: 'OPSLOOM',
        industry: 'Engineering Reliability & Plant Asset Management',
        contact_email: 'opsloom.ke@gmail.com',
        contact_phone: '+254 20 2358205',
        address: 'Shanghai Road, Industrial Area',
        city: 'Nairobi',
        country: 'Kenya',
        logo_url: '/static/brand/opsloom_wordmark_light.png',
        logo_light_url: '/static/brand/opsloom_wordmark_light.png',
        logo_dark_url: '/static/brand/opsloom_wordmark_dark.png',
        show_brand_name: false,
        sidebar_logo_height: 42,
        sidebar_logo_width: '190px',
        sidebar_logo_area: 'standard',
        sidebar_logo_fit: 'contain',
        sidebar_logo_align: 'left',
        primary_color: '#1554FF',
        secondary_color: '#0B1020',
        accent_color: '#F59E0B',
        created_at: '2026-01-01T00:00:00',
        is_active: true,
        is_default: true
      },
      {
        id: 'comp-ultravetis',
        name: 'Ultravetis East Africa',
        code: 'ULTRAVETIS',
        industry: 'Veterinary Pharmaceuticals & Crop Protection',
        contact_email: 'info@ultravetis.com',
        contact_phone: '+254 20 2358200',
        address: 'Shanghai Road, Off Enterprise Road, Industrial Area',
        city: 'Nairobi',
        country: 'Kenya',
        logo_url: '/static/brand/ultravetis_logo.png',
        logo_light_url: '/static/brand/ultravetis_logo.png',
        logo_dark_url: '/static/brand/ultravetis_logo.png',
        show_brand_name: false,
        sidebar_logo_height: 44,
        sidebar_logo_width: '190px',
        sidebar_logo_area: 'standard',
        sidebar_logo_fit: 'contain',
        sidebar_logo_align: 'left',
        primary_color: '#059669',
        secondary_color: '#064e3b',
        accent_color: '#10b981',
        created_at: '2026-01-15T00:00:00',
        is_active: true,
        is_default: false
      }
    ];
  }

  if (!store.ADMIN_USERS || store.ADMIN_USERS.length === 0) {
    store.ADMIN_USERS = [
      {
        id: 'USR-001',
        name: 'Laurence Magondu',
        email: 'opsloom.ke@gmail.com',
        role: 'Administrator',
        access_scope: 'Full System',
        department: 'Engineering',
        active: true,
        permissions: [
          'dashboard',
          'assets',
          'breakdowns',
          'maintenance',
          'inventory',
          'reports',
          'settings_manage',
          'users_manage',
          'notifications_manage',
          'technicians_manage'
        ],
        signature_name: 'Laurence Magondu',
        signature_title: 'Head of Engineering Reliability',
        signature_font: 'Inter',
        signature_color: '#1554FF',
        signature_style: 'formal',
        signature_image_url: '',
        profile_image_url: ''
      }
    ];
  }

  if (!store.TECHNICIAN_DIRECTORY || store.TECHNICIAN_DIRECTORY.length === 0) {
    store.TECHNICIAN_DIRECTORY = [
      { id: 'TECH-001', name: 'David Kimani', role: 'Mechanical Technician', discipline: 'Mechanical', phone: '+254700000101', email: 'david.kimani@opsloom.co.ke', active: true },
      { id: 'TECH-002', name: 'Sarah Njeri', role: 'Electrical Technician', discipline: 'Electrical', phone: '+254700000102', email: 'sarah.njeri@opsloom.co.ke', active: true },
      { id: 'TECH-003', name: 'James Omondi', role: 'Maintenance Planner', discipline: 'Planning', phone: '+254700000103', email: 'james.omondi@opsloom.co.ke', active: true },
      { id: 'TECH-004', name: 'Faith Mumbua', role: 'Instrumentation Technician', discipline: 'Controls', phone: '+254700000104', email: 'faith.mumbua@opsloom.co.ke', active: true }
    ];
  }

  // Seed sample operational data if ASSETS is empty
  if (!store.ASSETS || store.ASSETS.length === 0) {
    store.ASSETS = [
      {
        uid: 'ast-krones-vfs',
        asset_id: 'AST-001',
        asset_name: 'High-Speed Rotary Filling Machine',
        section: 'Filling Line',
        serial_no: 'KR-2023-8841',
        manufacturer: 'Krones AG',
        department: 'Engineering',
        model_number: 'Modulfill VFS-60',
        power_rating: '45 kW',
        supplier: 'Krones East Africa Ltd',
        installation_date: '2023-04-10',
        year_of_manufacture: '2023',
        warranty_expiry: '2027-04-10',
        technical_notes: 'Primary bottling unit. 60-valve counter-pressure monoblock with clean-in-place manifolds.',
        status: 'operational',
        criticality: 'A',
        registered_at: '2024-01-10T08:30:00',
        downtime_hours: 3.5,
        status_history: [{ status: 'operational', timestamp: '2024-01-10T08:30:00', reason: 'Commissioning' }]
      },
      {
        uid: 'ast-smi-packer',
        asset_id: 'AST-002',
        asset_name: 'Automatic Case Packer WP-600',
        section: 'Packaging',
        serial_no: 'SMI-CP-992',
        manufacturer: 'SMI Group',
        department: 'Engineering',
        model_number: 'WP 600 Continuous',
        power_rating: '22 kW',
        supplier: 'Packaging Systems Kenya',
        installation_date: '2022-09-15',
        year_of_manufacture: '2022',
        warranty_expiry: '2025-09-15',
        technical_notes: 'Wraparound corrugated case packer with hot-melt Nordson adhesive unit.',
        status: 'operational',
        criticality: 'B',
        registered_at: '2024-01-11T10:00:00',
        downtime_hours: 1.75,
        status_history: [{ status: 'operational', timestamp: '2024-01-11T10:00:00', reason: 'Initial load' }]
      },
      {
        uid: 'ast-tetra-cip',
        asset_id: 'AST-003',
        asset_name: 'Ultra-Clean CIP Sanitation Skid',
        section: 'Utilities',
        serial_no: 'TP-CIP-441',
        manufacturer: 'Tetra Pak',
        department: 'Engineering',
        model_number: 'Sanitary Plus 4-Channel',
        power_rating: '30 kW',
        supplier: 'Tetra Pak Nairobi',
        installation_date: '2024-02-01',
        year_of_manufacture: '2024',
        warranty_expiry: '2028-02-01',
        technical_notes: 'Automated 4-tank CIP loop with conductivity-controlled caustic and acid dosing.',
        status: 'operational',
        criticality: 'A',
        registered_at: '2024-02-02T11:20:00',
        downtime_hours: 0.8,
        status_history: [{ status: 'operational', timestamp: '2024-02-02T11:20:00', reason: 'New install' }]
      },
      {
        uid: 'ast-thermax-boiler',
        asset_id: 'AST-004',
        asset_name: 'Industrial Steam Boiler 5T',
        section: 'Utilities',
        serial_no: 'TX-BLR-012',
        manufacturer: 'Thermax Ltd',
        department: 'Engineering',
        model_number: 'Combipac 5000',
        power_rating: '75 kW',
        supplier: 'Thermax Steam Systems',
        installation_date: '2021-06-20',
        year_of_manufacture: '2021',
        warranty_expiry: '2024-06-20',
        technical_notes: 'Packaged smoke tube boiler rated for 12 bar gauge operating pressure.',
        status: 'maintenance',
        criticality: 'A',
        registered_at: '2024-01-05T09:00:00',
        downtime_hours: 8.0,
        status_history: [{ status: 'maintenance', timestamp: '2026-09-17T08:00:00', reason: 'Scheduled Quarter Descaling' }]
      },
      {
        uid: 'ast-enercon-sealer',
        asset_id: 'AST-005',
        asset_name: 'Continuous Induction Foil Sealer',
        section: 'Filling Line',
        serial_no: 'EN-FS-103',
        manufacturer: 'Enercon Industries',
        department: 'Engineering',
        model_number: 'Super Seal Touch 700',
        power_rating: '6 kW',
        supplier: 'Enercon UK / Techchem',
        installation_date: '2023-11-12',
        year_of_manufacture: '2023',
        warranty_expiry: '2026-11-12',
        technical_notes: 'High-frequency cap foil induction sealing head with water-cooled flux tunnel.',
        status: 'breakdown',
        criticality: 'B',
        registered_at: '2024-01-15T14:00:00',
        downtime_hours: 4.5,
        status_history: [{ status: 'breakdown', timestamp: '2026-09-17T14:30:00', reason: 'Inverter thermal fault' }]
      },
      {
        uid: 'ast-abb-palletizer',
        asset_id: 'AST-006',
        asset_name: 'Automated Palletizing Robotic Cell',
        section: 'Logistics & Warehousing',
        serial_no: 'IRB-660-312',
        manufacturer: 'ABB Robotics',
        department: 'Engineering',
        model_number: 'IRB 660-250/3.15',
        power_rating: '18 kW',
        supplier: 'ABB Automation Kenya',
        installation_date: '2024-03-05',
        year_of_manufacture: '2024',
        warranty_expiry: '2027-03-05',
        technical_notes: '4-axis articulated industrial robot cell with integrated vacuum gripper tooling.',
        status: 'operational',
        criticality: 'B',
        registered_at: '2024-03-06T10:30:00',
        downtime_hours: 1.2,
        status_history: [{ status: 'operational', timestamp: '2024-03-06T10:30:00', reason: 'Commissioning' }]
      }
    ];
  }

  if (!store.BREAKDOWNS || store.BREAKDOWNS.length === 0) {
    store.BREAKDOWNS = [
      {
        id: 'bk-aa2aa014',
        breakdown_id: 'BK-2026-004',
        asset_uid: 'ast-4a026627',
        asset_id: 'EABC/UTI/470',
        asset_name: 'Industrial Centrifugal Pump CP-04',
        section: 'Utilities',
        incident_title: 'Hydraulic Seal Leakage & Pressure Loss',
        problem_description: 'Primary gland packing and mechanical seal failed under 6 bar operating pressure. Fluid dripping on motor coupling.',
        severity: 'High',
        reported_by: 'Jackson Mwangi',
        assigned_to: 'David Kimani',
        root_cause: 'Worn nitrile O-ring and thermal degradation',
        action_taken: 'Isolating inlet valve, preparing Viton seal replacement',
        status: 'open',
        downtime_hours: 2.5,
        duration_mins: 150,
        reported_dt: '2026-09-20 07:30'
      },
      {
        id: 'bk-53ad3dc9',
        breakdown_id: 'BK-2026-003',
        asset_uid: 'ast-krones-vfs',
        asset_id: 'AST-001',
        asset_name: 'High-Speed Rotary Filling Machine',
        section: 'Filling Line',
        incident_title: 'Rotary Carousel Indexer Jam & Torque Overload',
        problem_description: 'Main rotary carousel stopped mid-cycle due to indexer slip. Motor overload protection tripped with code ERR-08.',
        severity: 'High',
        reported_by: 'Test Engineer',
        assigned_to: 'Sarah Njeri',
        root_cause: 'Cam track friction and lubricant breakdown in main turret drive',
        action_taken: 'Stripped turret housing, flushing gears, re-lubricating',
        status: 'open',
        downtime_hours: 5.5,
        duration_mins: 330,
        reported_dt: '2026-09-18 10:04'
      },
      {
        id: 'bk-2026-001',
        breakdown_id: 'BK-2026-001',
        asset_uid: 'ast-enercon-sealer',
        asset_id: 'AST-005',
        asset_name: 'Continuous Induction Foil Sealer',
        section: 'Filling Line',
        incident_title: 'Induction Coil Overheating & Inverter Thermal Trip',
        problem_description: 'Induction tunnel temperature spiked above 85°C causing the main IGBT inverter board to trip with Error E-04. Caps passing through without hermetic seal.',
        reported_by: 'David Kimani',
        assigned_to: 'Sarah Njeri',
        reported_dt: '2026-09-17 14:30',
        severity: 'Critical',
        status: 'open',
        downtime_hours: 4.5,
        duration_mins: 270,
        root_cause: 'Cooling fluid flow restriction and sediment buildup in primary heat exchanger coil.',
        action_taken: 'Inspected recirculating chiller pump and flushed sediment from heat exchanger.',
        parts_replaced: [],
        resolution_notes: '',
        resolved_at: null
      },
      {
        id: 'bk-2026-002',
        breakdown_id: 'BK-2026-002',
        asset_uid: 'ast-smi-packer',
        asset_id: 'AST-002',
        asset_name: 'Automatic Case Packer WP-600',
        section: 'Packaging',
        incident_title: 'Pneumatic Gripper Cylinder Jamming on Infeed Table',
        problem_description: 'Case feed pusher cylinder failed to retract within cycle timeout (1200ms). Carton blanks misaligned and blocked the infeed magazine.',
        reported_by: 'James Omondi',
        assigned_to: 'David Kimani',
        reported_dt: '2026-09-14 09:15',
        severity: 'Medium',
        status: 'resolved',
        downtime_hours: 1.75,
        duration_mins: 105,
        root_cause: 'Worn piston cup seal and contamination in 5/2 pilot solenoid valve.',
        action_taken: 'Replaced pneumatic cylinder seal kit and flushed airline FRL filter.',
        parts_replaced: ['Pneumatic Gripper Seal Kit 40mm'],
        resolution_notes: 'System re-calibrated. Ran 150 test cycles under load with zero misfeeds.',
        resolved_at: '2026-09-14 11:00'
      }
    ];
  }

  if (!store.MAINTENANCE_TASKS || store.MAINTENANCE_TASKS.length === 0) {
    store.MAINTENANCE_TASKS = [
      {
        id: 'pm-2026-001',
        task_id: 'PM-2026-001',
        title: 'Monthly Valve Timing, Lubrication & Rotary Seal Overhaul',
        asset_uid: 'ast-krones-vfs',
        asset_id: 'AST-001',
        asset_name: 'High-Speed Rotary Filling Machine',
        section: 'Filling Line',
        task_type: 'Preventive',
        frequency: 'Monthly',
        priority: 'High',
        due_date: '2026-09-25',
        assigned_to: 'David Kimani',
        status: 'scheduled',
        cost: 18500,
        cost_collected: false,
        notes: 'Check all 60 filling head diaphragm seals, torque rotary manifold bolts, check food-grade grease reservoirs.'
      },
      {
        id: 'pm-2026-002',
        task_id: 'PM-2026-002',
        title: 'Quarterly Boiler Safety Relief Valve Testing & Descaling',
        asset_uid: 'ast-thermax-boiler',
        asset_id: 'AST-004',
        asset_name: 'Industrial Steam Boiler 5T',
        section: 'Utilities',
        task_type: 'Preventive',
        frequency: 'Quarterly',
        priority: 'High',
        due_date: '2026-09-19',
        assigned_to: 'Faith Mumbua',
        status: 'in_progress',
        cost: 45000,
        cost_collected: false,
        notes: 'Hydrostatic check on dual safety relief valves. Chemical descaling circulation through water tube banks.'
      },
      {
        id: 'pm-2026-003',
        task_id: 'PM-2026-003',
        title: 'Bi-Weekly CIP Conductivity Meter & Flow Sensor Calibration',
        asset_uid: 'ast-tetra-cip',
        asset_id: 'AST-003',
        asset_name: 'Ultra-Clean CIP Sanitation Skid',
        section: 'Utilities',
        task_type: 'Inspection',
        frequency: 'Bi-Weekly',
        priority: 'Medium',
        due_date: '2026-09-22',
        assigned_to: 'Sarah Njeri',
        status: 'scheduled',
        cost: 8000,
        cost_collected: false,
        notes: 'Buffer solution 1413 µS/cm calibration on Endress+Hauser conductivity probes.'
      },
      {
        id: 'pm-2026-004',
        task_id: 'PM-2026-004',
        title: 'Weekly Palletizer Harmonic Drive Greasing & Cable Harness Check',
        asset_uid: 'ast-abb-palletizer',
        asset_id: 'AST-006',
        asset_name: 'Automated Palletizing Robotic Cell',
        section: 'Logistics & Warehousing',
        task_type: 'Preventive',
        frequency: 'Weekly',
        priority: 'Medium',
        due_date: '2026-09-15',
        completed_at: '2026-09-15T15:30:00',
        assigned_to: 'James Omondi',
        status: 'completed',
        cost: 12000,
        cost_collected: true,
        notes: 'Lubricated axis 1-4 gearboxes with Molywhite RE No.00 grease. Inspected flex energy chain.'
      }
    ];
  }

  if (!store.INVENTORY_PARTS || store.INVENTORY_PARTS.length === 0) {
    store.INVENTORY_PARTS = [
      {
        id: 'prt-001',
        uid: 'prt-001',
        part_number: 'PRT-PN-040',
        part_name: 'Pneumatic Gripper Seal Kit 40mm',
        category: 'Pneumatic',
        qty: 8,
        min_qty: 5,
        unit_price: 4200,
        location: 'Rack B-03',
        supplier: 'Festo Kenya',
        critical: true,
        notes: 'Fits SMI WP-600 Case Packer infeed and Krones secondary pick-up.'
      },
      {
        id: 'prt-002',
        uid: 'prt-002',
        part_number: 'PRT-MC-025',
        part_name: 'High-Temperature Silicone Tri-Clamp Gasket 2.5"',
        category: 'Mechanical',
        qty: 24,
        min_qty: 10,
        unit_price: 1850,
        location: 'Bin M-12',
        supplier: 'Spirax Sarco',
        critical: false,
        notes: 'Food-grade EPDM/PTFE lined for CIP sanitation skids.'
      },
      {
        id: 'prt-003',
        uid: 'prt-003',
        part_number: 'PRT-EL-018',
        part_name: 'Photoelectric Optical Sensor M18 PNP NO/NC',
        category: 'Sensors & Controls',
        qty: 3,
        min_qty: 6,
        unit_price: 8500,
        location: 'Drawer E-04',
        supplier: 'Omron Electronics',
        critical: true,
        notes: 'Low stock warning! Used on conveyor accumulation gates.'
      },
      {
        id: 'prt-004',
        uid: 'prt-004',
        part_number: 'PRT-EL-040',
        part_name: 'Solid State Relay 40A 240VAC Hockey Puck',
        category: 'Electrical',
        qty: 12,
        min_qty: 4,
        unit_price: 3600,
        location: 'Cabinet E-02',
        supplier: 'Schneider Electric',
        critical: false,
        notes: 'Heating element PID controllers.'
      },
      {
        id: 'prt-005',
        uid: 'prt-005',
        part_number: 'PRT-MC-045',
        part_name: 'Rotary Shaft Oil Seal 45x65x10 NBR Dual Lip',
        category: 'Mechanical',
        qty: 15,
        min_qty: 8,
        unit_price: 1250,
        location: 'Bin M-07',
        supplier: 'SKF Bearings Nairobi',
        critical: false,
        notes: 'General rotary pump seal replacements.'
      }
    ];
  }

  if (!store.SYSTEM_NOTIFICATIONS || store.SYSTEM_NOTIFICATIONS.length === 0) {
    store.SYSTEM_NOTIFICATIONS = [
      {
        id: 'notif-1',
        title: 'Breakdown Alert: Foil Sealer',
        message: 'Continuous Induction Foil Sealer reported overheating fault by David Kimani.',
        type: 'error',
        created_at: '2026-09-17T14:32:00',
        read: false,
        href: '/breakdowns/bk-2026-001',
        module: 'breakdowns'
      },
      {
        id: 'notif-2',
        title: 'Low Stock Advisory',
        message: 'Photoelectric Optical Sensor M18 has fallen to 3 units (threshold: 6).',
        type: 'warning',
        created_at: '2026-09-17T09:15:00',
        read: false,
        href: '/inventory',
        module: 'inventory'
      }
    ];
  }

  if (!store.INTERNAL_MESSAGES || store.INTERNAL_MESSAGES.length === 0) {
    store.INTERNAL_MESSAGES = [
      {
        id: 'msg-1',
        sender_name: 'James Omondi',
        sender_email: 'james.omondi@opsloom.co.ke',
        recipient_name: 'Laurence Magondu',
        recipient_email: 'opsloom.ke@gmail.com',
        subject: 'Q3 Preventive Maintenance Shutdown Schedule Finalized',
        body: 'Hi Laurence,\n\nWe have aligned the Q3 boiler descaling and bottling line valve overhaul with the production downtime window next Tuesday.\n\nAll spare parts are verified in store except the optical sensors which have been ordered from Omron.\n\nRegards,\nJames Omondi',
        created_at: '2026-09-16T11:45:00',
        read: true
      }
    ];
  }

  if (!store.AUDIT_TRAIL || store.AUDIT_TRAIL.length === 0) {
    store.AUDIT_TRAIL = [
      { id: 'aud-1', timestamp: new Date(Date.now() - 3600000).toISOString(), user_name: 'Laurence Magondu', action: 'System Login', module: 'Auth', details: 'Successful administrator login', ip: '127.0.0.1' },
      { id: 'aud-2', timestamp: new Date(Date.now() - 7200000).toISOString(), user_name: 'David Kimani', action: 'Breakdown Logged', module: 'Breakdowns', details: 'Logged BK-2026-001 on Foil Sealer', ip: '127.0.0.1' },
      { id: 'aud-3', timestamp: new Date(Date.now() - 18000000).toISOString(), user_name: 'James Omondi', action: 'PM Task Completed', module: 'Maintenance', details: 'Completed PM-2026-004 Palletizer service', ip: '127.0.0.1' }
    ];
  }
}

// Data accessors
export function getStore() {
  return store;
}

export function getActiveCompanyId() {
  return activeCompanyId;
}

export function setActiveCompanyId(id) {
  if (store.COMPANIES.some(c => c.id === id)) {
    activeCompanyId = id;
    return true;
  }
  return false;
}

export function getActiveCompany() {
  const comp = store.COMPANIES.find(c => c.id === activeCompanyId);
  const active = comp || store.COMPANIES[0] || {
    id: 'comp-opsloom',
    name: 'Opsloom Engineering Core',
    primary_color: '#1554FF',
    secondary_color: '#0B1020',
    accent_color: '#F59E0B'
  };
  if (!active.sidebar_logo_height) active.sidebar_logo_height = 42;
  if (!active.sidebar_logo_width) active.sidebar_logo_width = '190px';
  if (!active.sidebar_logo_area) active.sidebar_logo_area = 'standard';
  if (!active.sidebar_logo_fit) active.sidebar_logo_fit = 'contain';
  if (!active.sidebar_logo_align) active.sidebar_logo_align = 'left';
  return active;
}

export function getAllCompanies() {
  return store.COMPANIES || [];
}

export function addCompany(company) {
  if (!company.id) {
    company.id = `comp-${(company.code || 'comp').toLowerCase()}-${Date.now().toString(36)}`;
  }
  if (!store.COMPANIES) store.COMPANIES = [];
  store.COMPANIES.push(company);
  saveDatastore();
  return company;
}

export function updateCompany(id, updates) {
  if (!store.COMPANIES) return null;
  const comp = store.COMPANIES.find(c => c.id === id);
  if (comp) {
    Object.assign(comp, updates);
    saveDatastore();
    return comp;
  }
  return null;
}

export function deleteCompany(id) {
  if (!store.COMPANIES || store.COMPANIES.length <= 1) return false;
  const idx = store.COMPANIES.findIndex(c => c.id === id);
  if (idx !== -1) {
    store.COMPANIES.splice(idx, 1);
    if (activeCompanyId === id) {
      activeCompanyId = store.COMPANIES[0].id;
    }
    saveDatastore();
    return true;
  }
  return false;
}

export function getCurrentDepartment() {
  return currentDepartment;
}

export function setCurrentDepartment(dept) {
  currentDepartment = dept || 'Engineering';
}

export function getAssets() {
  return store.ASSETS || [];
}

export function getAssetByUid(uid) {
  return (store.ASSETS || []).find(a => a.uid === uid || a.asset_id === uid);
}

export function addAsset(asset) {
  if (!asset.uid) asset.uid = 'ast-' + crypto.randomUUID().slice(0, 8);
  if (!asset.registered_at) asset.registered_at = new Date().toISOString();
  if (!asset.status_history) {
    asset.status_history = [{ status: asset.status || 'operational', timestamp: new Date().toISOString(), reason: 'Created' }];
  }
  store.ASSETS.unshift(asset);
  saveDatastore();
  return asset;
}

export function updateAsset(uid, updates) {
  const idx = (store.ASSETS || []).findIndex(a => a.uid === uid || a.asset_id === uid);
  if (idx !== -1) {
    store.ASSETS[idx] = { ...store.ASSETS[idx], ...updates };
    saveDatastore();
    return store.ASSETS[idx];
  }
  return null;
}

export function deleteAsset(uid) {
  const idx = (store.ASSETS || []).findIndex(a => a.uid === uid || a.asset_id === uid);
  if (idx !== -1) {
    const deleted = store.ASSETS.splice(idx, 1);
    saveDatastore();
    return deleted[0];
  }
  return null;
}

export function getBreakdowns() {
  return store.BREAKDOWNS || [];
}

export function getBreakdownById(id) {
  return (store.BREAKDOWNS || []).find(b => b.id === id || b.breakdown_id === id);
}

export function addBreakdown(bk) {
  if (!bk.id) bk.id = 'bk-' + crypto.randomUUID().slice(0, 8);
  if (!bk.breakdown_id) {
    const num = String(store.BREAKDOWNS.length + 1).padStart(3, '0');
    bk.breakdown_id = `BK-${new Date().getFullYear()}-${num}`;
  }
  if (!bk.reported_dt) bk.reported_dt = new Date().toISOString().replace('T', ' ').slice(0, 16);
  store.BREAKDOWNS.unshift(bk);

  // Update corresponding asset status
  if (bk.asset_uid) {
    updateAsset(bk.asset_uid, { status: 'breakdown' });
  }

  saveDatastore();
  return bk;
}

export function updateBreakdown(id, updates) {
  const idx = (store.BREAKDOWNS || []).findIndex(b => b.id === id || b.breakdown_id === id);
  if (idx !== -1) {
    store.BREAKDOWNS[idx] = { ...store.BREAKDOWNS[idx], ...updates };
    saveDatastore();
    return store.BREAKDOWNS[idx];
  }
  return null;
}

export function deleteBreakdown(id) {
  const idx = (store.BREAKDOWNS || []).findIndex(b => b.id === id || b.breakdown_id === id);
  if (idx !== -1) {
    const deleted = store.BREAKDOWNS.splice(idx, 1);
    saveDatastore();
    return deleted[0];
  }
  return null;
}

export function getMaintenanceTasks() {
  return store.MAINTENANCE_TASKS || [];
}

export function getMaintenanceTaskById(id) {
  return (store.MAINTENANCE_TASKS || []).find(t => t.id === id || t.task_id === id);
}

export function addMaintenanceTask(task) {
  if (!task.id) task.id = 'pm-' + crypto.randomUUID().slice(0, 8);
  if (!task.task_id) {
    const num = String(store.MAINTENANCE_TASKS.length + 1).padStart(3, '0');
    task.task_id = `PM-${new Date().getFullYear()}-${num}`;
  }
  store.MAINTENANCE_TASKS.unshift(task);
  saveDatastore();
  return task;
}

export function updateMaintenanceTask(id, updates) {
  const idx = (store.MAINTENANCE_TASKS || []).findIndex(t => t.id === id || t.task_id === id);
  if (idx !== -1) {
    store.MAINTENANCE_TASKS[idx] = { ...store.MAINTENANCE_TASKS[idx], ...updates };
    saveDatastore();
    return store.MAINTENANCE_TASKS[idx];
  }
  return null;
}

export function deleteMaintenanceTask(id) {
  const idx = (store.MAINTENANCE_TASKS || []).findIndex(t => t.id === id || t.task_id === id);
  if (idx !== -1) {
    const deleted = store.MAINTENANCE_TASKS.splice(idx, 1);
    saveDatastore();
    return deleted[0];
  }
  return null;
}

export function getInventoryParts() {
  return store.INVENTORY_PARTS || [];
}

export function getInventoryPartById(id) {
  return (store.INVENTORY_PARTS || []).find(p => p.id === id || p.uid === id || p.part_number === id);
}

export function addInventoryPart(part) {
  if (!part.id) part.id = 'prt-' + crypto.randomUUID().slice(0, 8);
  if (!part.uid) part.uid = part.id;
  store.INVENTORY_PARTS.unshift(part);
  saveDatastore();
  return part;
}

export function updateInventoryPart(id, updates) {
  const idx = (store.INVENTORY_PARTS || []).findIndex(p => p.id === id || p.uid === id);
  if (idx !== -1) {
    store.INVENTORY_PARTS[idx] = { ...store.INVENTORY_PARTS[idx], ...updates };
    saveDatastore();
    return store.INVENTORY_PARTS[idx];
  }
  return null;
}

export function deleteInventoryPart(id) {
  const idx = (store.INVENTORY_PARTS || []).findIndex(p => p.id === id || p.uid === id || p.part_number === id);
  if (idx !== -1) {
    const deleted = store.INVENTORY_PARTS.splice(idx, 1);
    saveDatastore();
    return deleted[0];
  }
  return null;
}

export function getDocumentsForAsset(assetUid) {
  return (store.ASSET_DOCUMENTS || []).filter(d => d.asset_uid === assetUid || d.asset_id === assetUid);
}

export function addDocument(doc) {
  if (!doc.id) doc.id = 'doc-' + crypto.randomUUID().slice(0, 8);
  if (!doc.uploaded_at) doc.uploaded_at = new Date().toISOString().slice(0, 10);
  if (!store.ASSET_DOCUMENTS) store.ASSET_DOCUMENTS = [];
  store.ASSET_DOCUMENTS.unshift(doc);
  saveDatastore();
  return doc;
}

export function deleteDocument(docId) {
  const idx = (store.ASSET_DOCUMENTS || []).findIndex(d => d.id === docId || d.doc_id === docId);
  if (idx !== -1) {
    const deleted = store.ASSET_DOCUMENTS.splice(idx, 1);
    saveDatastore();
    return deleted[0];
  }
  return null;
}

export function addAuditEntry(userName, action, module, details, ip = '127.0.0.1') {
  const entry = {
    id: 'aud-' + Date.now(),
    timestamp: new Date().toISOString(),
    user_name: userName || 'System User',
    action: action || 'General Action',
    module: module || 'General',
    details: details || '',
    ip
  };
  if (!store.AUDIT_TRAIL) store.AUDIT_TRAIL = [];
  store.AUDIT_TRAIL.unshift(entry);
  if (store.AUDIT_TRAIL.length > 200) store.AUDIT_TRAIL.length = 200;
  saveDatastore();
  return entry;
}

export function addNotification(title, message, type = 'info', href = '#', module = 'system') {
  const notif = {
    id: 'notif-' + Date.now(),
    title,
    message,
    type,
    created_at: new Date().toISOString(),
    read: false,
    href,
    module
  };
  if (!store.SYSTEM_NOTIFICATIONS) store.SYSTEM_NOTIFICATIONS = [];
  store.SYSTEM_NOTIFICATIONS.unshift(notif);
  saveDatastore();
  return notif;
}

// Initial load
loadDatastore();
