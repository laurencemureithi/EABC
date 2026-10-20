const dal = require('./src/db/dal');

async function seedProductionDatabase() {
  console.log('--- Initializing Authoritative PostgreSQL Database ---');

  // 1. Ensure comp-001 exists with full branding & KPI targets
  const comp001 = {
    id: 'comp-001',
    name: 'Ultravetis East Africa Ltd',
    code: 'UEAL',
    primary_color: '#7E22CE',
    secondary_color: '#F59E0B',
    logo_light_url: '/static/brand/ultravetis_logo.png',
    logo_dark_url: '/static/brand/ultravetis_logo.png',
    show_name_next_to_logo: false,
    logo_height: 48,
    logo_width_pct: 100,
    logo_alignment: 'left',
    logo_fit: 'contain',
    designation_line_1: 'Ultravetis East Africa Ltd (UEAL)',
    designation_line_2: 'Veterinary, Agro-Inputs & Manufacturing Operations',
    designation_line_3: 'Contact: info@ultravetis.com • Reliability Office',
    departments: ['Engineering', 'Production', 'Logistics & Warehousing', 'Premises'],
    kpi_targets: {
      uptime_target_pct: 85.0,
      oee_benchmark_pct: 92.0,
      pm_compliance_target_pct: 90.0,
      mttr_target_hours: 2.0,
      mtbf_target_hours: 120.0,
      monthly_maintenance_budget: 2500000,
      spares_inventory_budget: 1500000,
      inventory_health_target_pct: 95.0,
      max_critical_breakdowns: 1,
      max_active_breakdowns: 3,
      max_oos_assets: 2,
      max_overdue_pm: 2
    },
    created_at: '2026-01-01T00:00:00.000Z'
  };
  await dal.upsertCompany(comp001);
  console.log('✅ Company comp-001 configured in PostgreSQL');

  // 2. Clean up test companies and orphaned breakdowns/tasks
  await dal.query("DELETE FROM breakdowns WHERE asset_uid NOT IN (SELECT uid FROM assets) AND asset_id NOT IN (SELECT asset_id FROM assets);");
  await dal.query("DELETE FROM maintenance_tasks WHERE asset_uid NOT IN (SELECT uid FROM assets) AND asset_id NOT IN (SELECT asset_id FROM assets);");
  console.log('✅ Cleaned up orphaned test records');

  // 3. Ensure primary assets exist in PostgreSQL for comp-001
  const standardAssets = [
    {
      uid: 'asset-ueal-001',
      company_id: 'comp-001',
      asset_id: 'AST-01',
      asset_name: 'Rotary Bottle Filling & Capping Line',
      section: 'Pharma',
      department: 'Engineering',
      status: 'operational',
      criticality: 'A',
      serial_no: 'RBF-2024-9981',
      manufacturer: 'Bosch Packaging Technology',
      model_number: 'FX-Rotary-200',
      power_rating: '45 kW',
      supplier: 'Bosch Packaging East Africa',
      installation_date: '2024-03-15',
      year_of_manufacture: '2024',
      warranty_expiry: '2027-03-15',
      technical_notes: 'Class-A cleanroom filling line with 24-head peristaltic servo pumps.',
      category: 'Pharma Production Equipment',
      location: 'Pharma Sterile Suite Line 1',
      service_provider: 'Bosch Field Engineering',
      asset_value: 'KES 18,500,000',
      registered_at: '2024-03-16 09:00',
      created_at: '2024-03-16T09:00:00.000Z'
    },
    {
      uid: 'asset-ueal-002',
      company_id: 'comp-001',
      asset_id: 'AST-02',
      asset_name: 'High-Speed Case Packer Line 1',
      section: 'Packaging',
      department: 'Engineering',
      status: 'operational',
      criticality: 'A',
      serial_no: 'HSP-2023-4412',
      manufacturer: 'Cama Group',
      model_number: 'IN-Case-500',
      power_rating: '30 kW',
      supplier: 'Cama Packaging Ltd',
      installation_date: '2023-08-10',
      year_of_manufacture: '2023',
      warranty_expiry: '2026-08-10',
      technical_notes: 'Continuous carton collation and robotic case packing with vacuum suction grippers.',
      category: 'Packaging Automation',
      location: 'Packaging Floor Section B',
      service_provider: 'Cama Service Division',
      asset_value: 'KES 12,000,000',
      registered_at: '2023-08-11 10:30',
      created_at: '2023-08-11T10:30:00.000Z'
    },
    {
      uid: 'asset-ueal-003',
      company_id: 'comp-001',
      asset_id: 'AST-03',
      asset_name: 'Industrial Steam Boiler 5000L',
      section: 'Utilities',
      department: 'Engineering',
      status: 'operational',
      criticality: 'A',
      serial_no: 'BLR-2022-7721',
      manufacturer: 'Thermax Global',
      model_number: 'Combipac-5T',
      power_rating: '75 kW',
      supplier: 'Thermax East Africa',
      installation_date: '2022-11-05',
      year_of_manufacture: '2022',
      warranty_expiry: '2025-11-05',
      technical_notes: 'Dual-fuel industrial steam generation boiler operating at 10.5 bar design pressure.',
      category: 'Plant Utilities',
      location: 'Central Utilities Plant House',
      service_provider: 'Thermax Boiler Reliability Team',
      asset_value: 'KES 24,000,000',
      registered_at: '2022-11-06 08:00',
      created_at: '2022-11-06T08:00:00.000Z'
    },
    {
      uid: 'asset-ueal-004',
      company_id: 'comp-001',
      asset_id: 'AST-04',
      asset_name: 'Centrifugal Slurry Transfer Pump P-102',
      section: 'Liquid',
      department: 'Engineering',
      status: 'operational',
      criticality: 'B',
      serial_no: 'PMP-2023-1190',
      manufacturer: 'KSB Pumps',
      model_number: 'Etaprime-B-80',
      power_rating: '18.5 kW',
      supplier: 'KSB Kenya Ltd',
      installation_date: '2023-05-20',
      year_of_manufacture: '2023',
      warranty_expiry: '2026-05-20',
      technical_notes: 'Heavy-duty self-priming centrifugal chemical slurry transfer pump with double mechanical seal.',
      category: 'Liquid Processing',
      location: 'Liquid Bulk Processing Bay 2',
      service_provider: 'KSB Authorized Engineering',
      asset_value: 'KES 3,800,000',
      registered_at: '2023-05-21 11:15',
      created_at: '2023-05-21T11:15:00.000Z'
    },
    {
      uid: 'asset-ueal-005',
      company_id: 'comp-001',
      asset_id: 'AST-05',
      asset_name: 'Twin-Screw Powder Granulator Unit',
      section: 'Powder',
      department: 'Engineering',
      status: 'degraded',
      criticality: 'A',
      serial_no: 'GRN-2023-8834',
      manufacturer: 'Glatt Process Technology',
      model_number: 'VG-Pro-300',
      power_rating: '55 kW',
      supplier: 'Glatt Engineering AG',
      installation_date: '2023-09-12',
      year_of_manufacture: '2023',
      warranty_expiry: '2026-09-12',
      technical_notes: 'Continuous wet and dry high-shear powder granulation unit with torque sensor monitoring.',
      category: 'Powder Processing',
      location: 'Powder Production Room 4',
      service_provider: 'Glatt Field Services',
      asset_value: 'KES 15,200,000',
      registered_at: '2023-09-13 14:00',
      created_at: '2023-09-13T14:00:00.000Z'
    },
    {
      uid: 'asset-ueal-006',
      company_id: 'comp-001',
      asset_id: 'AST-06',
      asset_name: 'Heavy-Duty Screw Air Compressor Atlas',
      section: 'Utilities',
      department: 'Engineering',
      status: 'operational',
      criticality: 'B',
      serial_no: 'CMP-2022-3329',
      manufacturer: 'Atlas Copco',
      model_number: 'GA-75-VSD+',
      power_rating: '75 kW',
      supplier: 'Atlas Copco Kenya',
      installation_date: '2022-06-18',
      year_of_manufacture: '2022',
      warranty_expiry: '2025-06-18',
      technical_notes: 'Oil-injected variable speed drive screw compressor supplying clean dry air at 8.0 bar.',
      category: 'Compressed Air Utilities',
      location: 'Compressor Room East',
      service_provider: 'Atlas Copco Service Care',
      asset_value: 'KES 9,400,000',
      registered_at: '2022-06-19 12:00',
      created_at: '2022-06-19T12:00:00.000Z'
    }
  ];

  for (const ast of standardAssets) {
    await dal.upsertAsset(ast);
  }
  console.log(`✅ Seeded ${standardAssets.length} standard industrial assets in PostgreSQL`);

  // 4. Seed realistic historical breakdowns linked to these assets
  const standardBreakdowns = [
    {
      breakdown_id: 'BD-2026-101',
      company_id: 'comp-001',
      asset_uid: 'asset-ueal-002',
      asset_id: 'AST-02',
      asset_name: 'High-Speed Case Packer Line 1',
      section: 'Packaging',
      department: 'Engineering',
      incident_title: 'Vacuum Suction Gripper Misalignment Stoppage',
      severity: 'High',
      failure_category: 'Pneumatic',
      status: 'resolved',
      technician_name: 'David Kimani',
      technician_phone: '+254 722 000 111',
      technician_email: 'david.kimani@opsloom.co.ke',
      reported_dt: '2026-10-10 08:30',
      duration_mins: 90,
      symptoms: 'Carton gripper arm failed to achieve vacuum seal, causing case packer stoppage on Line 1.',
      notes: 'Replaced pneumatic cup seals and recalibrated vacuum transducer sensor.',
      resolved_at: '2026-10-10T10:00:00.000Z',
      created_at: '2026-10-10T08:30:00.000Z'
    },
    {
      breakdown_id: 'BD-2026-102',
      company_id: 'comp-001',
      asset_uid: 'asset-ueal-005',
      asset_id: 'AST-05',
      asset_name: 'Twin-Screw Powder Granulator Unit',
      section: 'Powder',
      department: 'Engineering',
      incident_title: 'Drive Motor High Temperature Thermal Trip',
      severity: 'Critical',
      failure_category: 'Electrical',
      status: 'in_progress',
      technician_name: 'Alex Ochieng',
      technician_phone: '+254 733 222 333',
      technician_email: 'alex.ochieng@opsloom.co.ke',
      reported_dt: '2026-10-18 14:15',
      duration_mins: 150,
      symptoms: 'Motor temperature sensor reached 98°C during dense powder batch, triggering VFD overload trip.',
      notes: 'Investigating cooling fan impeller wear and bearing friction on twin screw gearbox.',
      created_at: '2026-10-18T14:15:00.000Z'
    },
    {
      breakdown_id: 'BD-2026-103',
      company_id: 'comp-001',
      asset_uid: 'asset-ueal-004',
      asset_id: 'AST-04',
      asset_name: 'Centrifugal Slurry Transfer Pump P-102',
      section: 'Liquid',
      department: 'Engineering',
      incident_title: 'Mechanical Seal Weep and Pressure Drop',
      severity: 'Medium',
      failure_category: 'Mechanical',
      status: 'resolved',
      technician_name: 'Grace Wambui',
      technician_phone: '+254 711 444 555',
      technician_email: 'grace.wambui@opsloom.co.ke',
      reported_dt: '2026-10-12 11:00',
      duration_mins: 75,
      symptoms: 'Minor fluid seepage at drive-end mechanical seal faces during batch transfer.',
      notes: 'Replaced SiC mechanical seal cartridge and flushed barrier fluid reservoir.',
      resolved_at: '2026-10-12T12:15:00.000Z',
      created_at: '2026-10-12T11:00:00.000Z'
    }
  ];

  for (const bd of standardBreakdowns) {
    await dal.upsertBreakdown(bd);
  }
  console.log(`✅ Seeded ${standardBreakdowns.length} breakdowns in PostgreSQL`);

  // 5. Seed maintenance tasks
  const standardTasks = [
    {
      task_id: 'TASK-2026-001',
      company_id: 'comp-001',
      asset_uid: 'asset-ueal-001',
      asset_id: 'AST-01',
      asset_name: 'Rotary Bottle Filling & Capping Line',
      maintenance_type: 'PM',
      frequency: 'Monthly',
      section: 'Pharma',
      technician: 'David Kimani',
      task_title: 'Peristaltic Pump Head & Servo Calibration',
      task_description: 'Inspect 24 filling heads, verify dosing accuracy (±0.2 ml), inspect silicone tubing.',
      due_date: '2026-10-25',
      status: 'upcoming',
      priority: 'high',
      notes: 'Standard pharmaceutical calibration work order.',
      created_at: '2026-10-01T08:00:00.000Z'
    },
    {
      task_id: 'TASK-2026-002',
      company_id: 'comp-001',
      asset_uid: 'asset-ueal-003',
      asset_id: 'AST-03',
      asset_name: 'Industrial Steam Boiler 5000L',
      maintenance_type: 'PM',
      frequency: 'Weekly',
      section: 'Utilities',
      technician: 'Alex Ochieng',
      task_title: 'Boiler Blowdown, Water Softener & Burner Inspection',
      task_description: 'Daily/Weekly TDS blowdown test, check chemical dosing pump, inspect burner flame detector.',
      due_date: '2026-10-22',
      status: 'upcoming',
      priority: 'critical',
      notes: 'Statutory boiler safety protocol.',
      created_at: '2026-10-01T08:00:00.000Z'
    },
    {
      task_id: 'TASK-2026-003',
      company_id: 'comp-001',
      asset_uid: 'asset-ueal-006',
      asset_id: 'AST-06',
      asset_name: 'Heavy-Duty Screw Air Compressor Atlas',
      maintenance_type: 'PM',
      frequency: 'Monthly',
      section: 'Utilities',
      technician: 'Grace Wambui',
      task_title: 'Oil Filter Replacement & Dew Point Verification',
      task_description: 'Replace oil separator cartridge, check refrigerated air dryer refrigerant pressure and dew point.',
      due_date: '2026-10-15',
      status: 'completed',
      priority: 'medium',
      notes: 'Filter replacement completed with genuine Atlas Copco consumables.',
      completed_at: '2026-10-15T11:30:00.000Z',
      completion_notes: 'Service satisfied. Running at 7.8 bar nominal pressure with -40°C pressure dew point.',
      created_at: '2026-10-01T08:00:00.000Z'
    }
  ];

  for (const t of standardTasks) {
    await dal.upsertMaintenanceTask(t);
  }
  console.log(`✅ Seeded ${standardTasks.length} preventive maintenance tasks in PostgreSQL`);

  // 6. Seed critical inventory parts
  const standardInventory = [
    {
      uid: 'part-ueal-001',
      company_id: 'comp-001',
      part_name: 'Food-Grade Thermal Coupler Sensor K-Type',
      sku: 'TC-500-FG',
      category: 'Electrical & Instrumentation',
      qty: 15,
      min_qty: 5,
      storage_location: 'Bin E-12',
      unit_price: '4500',
      supplier: 'Sensors East Africa Ltd',
      is_critical: true,
      lead_time_days: 5,
      created_at: '2026-01-01T00:00:00.000Z'
    },
    {
      uid: 'part-ueal-002',
      company_id: 'comp-001',
      part_name: 'Pneumatic Gripper Vacuum Suction Pad (Silicone)',
      sku: 'VAC-GRIP-40',
      category: 'Pneumatics',
      qty: 24,
      min_qty: 8,
      storage_location: 'Bin P-04',
      unit_price: '1850',
      supplier: 'Festo East Africa',
      is_critical: true,
      lead_time_days: 7,
      created_at: '2026-01-01T00:00:00.000Z'
    },
    {
      uid: 'part-ueal-003',
      company_id: 'comp-001',
      part_name: 'SiC Cartridge Mechanical Seal 45mm',
      sku: 'SEAL-45-SIC',
      category: 'Mechanical Seals',
      qty: 6,
      min_qty: 3,
      storage_location: 'Bin M-08',
      unit_price: '18500',
      supplier: 'EagleBurgmann East Africa',
      is_critical: true,
      lead_time_days: 14,
      created_at: '2026-01-01T00:00:00.000Z'
    },
    {
      uid: 'part-ueal-004',
      company_id: 'comp-001',
      part_name: 'Solid State Relay 3-Phase 50A 480VAC',
      sku: 'SSR-50A-3P',
      category: 'Electrical & Automation',
      qty: 8,
      min_qty: 4,
      storage_location: 'Bin E-02',
      unit_price: '7200',
      supplier: 'Schneider Electric Kenya',
      is_critical: true,
      lead_time_days: 7,
      created_at: '2026-01-01T00:00:00.000Z'
    }
  ];

  for (const part of standardInventory) {
    await dal.upsertInventoryPart(part);
  }
  console.log(`✅ Seeded ${standardInventory.length} inventory parts in PostgreSQL`);

  // 7. Seed technicians
  const standardTechs = [
    {
      id: 'TECH-001',
      company_id: 'comp-001',
      name: 'David Kimani',
      role: 'Lead Automation Engineer',
      discipline: 'Electrical & Automation',
      department: 'Engineering',
      phone: '+254 722 000 111',
      email: 'david.kimani@opsloom.co.ke',
      active: true,
      status: 'Active'
    },
    {
      id: 'TECH-002',
      company_id: 'comp-001',
      name: 'Alex Ochieng',
      role: 'Boiler & Utilities Specialist',
      discipline: 'Mechanical',
      department: 'Engineering',
      phone: '+254 733 222 333',
      email: 'alex.ochieng@opsloom.co.ke',
      active: true,
      status: 'Active'
    },
    {
      id: 'TECH-003',
      company_id: 'comp-001',
      name: 'Grace Wambui',
      role: 'Packaging Line Technician',
      discipline: 'Pneumatics & Packaging',
      department: 'Production',
      phone: '+254 711 444 555',
      email: 'grace.wambui@opsloom.co.ke',
      active: true,
      status: 'Active'
    }
  ];

  for (const tech of standardTechs) {
    await dal.upsertTechnician(tech);
  }
  console.log(`✅ Seeded ${standardTechs.length} technicians in PostgreSQL`);

  console.log('🎉 Production database initialization completed successfully!');
}

seedProductionDatabase().catch(err => {
  console.error('Database seeding error:', err);
  process.exit(1);
});
