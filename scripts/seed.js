/**
 * EABC / Opsloom Development & Demo Seeder
 * Explicitly invoked script to seed demonstration data for local testing & demos.
 * NOTE: Never invoked automatically in production environments!
 * Usage: node scripts/seed.js [--company=comp-001]
 */

try {
  require('dotenv').config();
} catch (e) {}

const dal = require('../src/db/dal');

async function seedDevelopmentData() {
  console.log('\n====================================================');
  console.log('🌱 EABC DEVELOPMENT DEMO SEEDER');
  console.log('====================================================\n');

  try {
    const isReady = await dal.isAvailable();
    if (!isReady) {
      console.error('❌ Database connection pool is not configured. Check environment variables.');
      process.exit(1);
    }

    const targetCompanyId = 'comp-001';
    console.log(`Checking target organization (${targetCompanyId})...`);

    let company = await dal.getCompanyById(targetCompanyId);
    if (!company) {
      console.log('Creating demo organization (Opsloom Engineering Ltd)...');
      company = {
        id: targetCompanyId,
        name: 'Opsloom Engineering Ltd',
        code: 'OPS',
        primary_color: '#7E22CE',
        secondary_color: '#C084FC',
        show_name_next_to_logo: true,
        logo_height: 44,
        logo_width_pct: 85,
        designation_line_1: 'Industrial Reliability Division',
        designation_line_2: 'East Africa Manufacturing Hub',
        created_at: new Date().toISOString()
      };
      await dal.upsertCompany(company);
      console.log('✅ Demo organization created.');
    }

    // Check existing assets for this company
    const existingAssets = await dal.getAssets(targetCompanyId);
    if (existingAssets.length > 0) {
      console.log(`ℹ️ Organization already has ${existingAssets.length} asset(s). Skipping demo asset seeding to preserve existing data.`);
    } else {
      console.log('Seeding demo assets...');
      const demoAssets = [
        {
          uid: 'asset-demo-001',
          company_id: targetCompanyId,
          asset_id: 'CAP-PRO-01',
          asset_name: 'High-Speed Rotary Capping Machine',
          section: 'Packaging Bay A',
          department: 'Packaging & Dispatch',
          status: 'operational',
          criticality: 'A',
          serial_no: 'HSR-CAP-2024-88',
          manufacturer: 'Bosch Packaging Technology',
          model_number: 'HSC-600',
          power_rating: '15 kW',
          supplier: 'Allied Machinery East Africa',
          installation_date: '2024-03-15',
          category: 'Packaging Machinery',
          location: 'Nairobi Plant - Line 1',
          registered_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        },
        {
          uid: 'asset-demo-002',
          company_id: targetCompanyId,
          asset_id: 'FIL-STER-02',
          asset_name: 'Aseptic Monoblock Liquid Filler',
          section: 'Sterile Filling Bay',
          department: 'Liquid Formulations',
          status: 'operational',
          criticality: 'A',
          serial_no: 'AML-FIL-2023-104',
          manufacturer: 'Tetra Pak Processing',
          model_number: 'TPA-900',
          power_rating: '22 kW',
          supplier: 'Tetra Pak Technical Services',
          installation_date: '2023-08-20',
          category: 'Filling Machinery',
          location: 'Nairobi Plant - Sterile Room 2',
          registered_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }
      ];

      for (const a of demoAssets) {
        await dal.upsertAsset(a);
      }
      console.log(`✅ Seeded ${demoAssets.length} demo asset(s).`);
    }

    // Check existing inventory parts
    const existingParts = await dal.getInventoryParts(targetCompanyId);
    if (existingParts.length > 0) {
      console.log(`ℹ️ Organization already has ${existingParts.length} inventory part(s).`);
    } else {
      console.log('Seeding demo inventory parts...');
      const demoParts = [
        {
          uid: 'part-demo-001',
          company_id: targetCompanyId,
          part_name: 'Food-Grade Thermal Coupler Sensor',
          sku: 'TC-FOOD-001',
          category: 'Instrumentation',
          qty: 12,
          min_qty: 4,
          storage_location: 'Rack B-04',
          unit_price: '4500',
          supplier: 'Siemens Industrial Automation',
          lead_time_days: 5,
          is_critical: true,
          created_at: new Date().toISOString()
        },
        {
          uid: 'part-demo-002',
          company_id: targetCompanyId,
          part_name: 'High-Torque Drive Timing Belt 120T',
          sku: 'TB-120T-002',
          category: 'Mechanical',
          qty: 8,
          min_qty: 3,
          storage_location: 'Bin M-12',
          unit_price: '7800',
          supplier: 'Gates Power Transmission',
          lead_time_days: 7,
          is_critical: true,
          created_at: new Date().toISOString()
        }
      ];

      for (const p of demoParts) {
        await dal.upsertInventoryPart(p);
      }
      console.log(`✅ Seeded ${demoParts.length} demo inventory part(s).`);
    }

    console.log('\n====================================================');
    console.log('🎉 DEMO SEEDING COMPLETED SUCCESSFULLY.');
    console.log('====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SEEDING FAILED:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  seedDevelopmentData();
}

module.exports = { seedDevelopmentData };
