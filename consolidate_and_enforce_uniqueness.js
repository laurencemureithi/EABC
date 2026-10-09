const dal = require('./src/db/dal');

async function runDeduplicationAndConsolidation() {
  console.log('====================================================');
  console.log('🚀 EXECUTING DATABASE DEDUPLICATION & CONSOLIDATION');
  console.log('====================================================');

  const client = await dal.getPool().connect();
  try {
    await client.query('BEGIN;');

    // 1. Define Canonical Mappings
    const consolidations = [
      {
        canonicalId: 'comp-1791377523403',
        canonicalName: 'Alpha Manufacturing Group',
        canonicalCode: 'ALPH',
        duplicates: [
          'comp-1791460742482',
          'comp-1791460793948',
          'comp-1791460815127',
          'comp-1791463723302'
        ]
      },
      {
        canonicalId: 'comp-1791377523426',
        canonicalName: 'Beta Logistics East Africa',
        canonicalCode: 'BETA',
        duplicates: [
          'comp-1791460742526',
          'comp-1791460794084',
          'comp-1791460815270',
          'comp-1791463723360'
        ]
      },
      {
        canonicalId: 'comp-1791373486653',
        canonicalName: 'Nairobi Packaging Plant',
        canonicalCode: 'NPP',
        duplicates: [
          'comp-1791460820985',
          'comp-1791460899198',
          'comp-1791460963944',
          'comp-1791463729029'
        ]
      }
    ];

    // Other test workspaces to remove
    const testWorkspacesToRemove = [
      'comp-1791460149443',
      'test-123',
      'comp-1791460059987',
      'comp-1791459969297',
      'comp-1791460597628'
    ];

    const tablesWithCompanyId = [
      'assets',
      'users',
      'breakdowns',
      'maintenance_tasks',
      'inventory_parts',
      'recycle_bin',
      'technicians',
      'audit_trail'
    ];

    for (const group of consolidations) {
      console.log(`\nConsolidating into Canonical [${group.canonicalId}] "${group.canonicalName}" (${group.canonicalCode})...`);
      for (const dupId of group.duplicates) {
        for (const tbl of tablesWithCompanyId) {
          const updRes = await client.query(`UPDATE ${tbl} SET company_id = $1 WHERE company_id = $2;`, [group.canonicalId, dupId]);
          if (updRes.rowCount > 0) {
            console.log(`  -> Migrated ${updRes.rowCount} rows in ${tbl} from ${dupId} to ${group.canonicalId}`);
          }
        }
        await client.query('DELETE FROM companies WHERE id = $1;', [dupId]);
        console.log(`  -> Deleted duplicate company row: ${dupId}`);
      }

      // Ensure canonical has the pristine name and code
      await client.query(
        'UPDATE companies SET name = $1, code = $2 WHERE id = $3;',
        [group.canonicalName, group.canonicalCode, group.canonicalId]
      );
    }

    // Clean up test workspaces
    for (const testId of testWorkspacesToRemove) {
      for (const tbl of tablesWithCompanyId) {
        await client.query(`UPDATE ${tbl} SET company_id = 'comp-001' WHERE company_id = $1;`, [testId]);
      }
      await client.query('DELETE FROM companies WHERE id = $1;', [testId]);
      console.log(`Deleted stale test workspace row: ${testId}`);
    }

    // Ensure comp-001 is pristine
    await client.query(
      "UPDATE companies SET name = 'Ultravetis East Africa Ltd', code = 'UEAL' WHERE id = 'comp-001';"
    );

    await client.query('COMMIT;');
    console.log('\n🎉 Deduplication & consolidation committed successfully!');

    // Verify remaining companies
    const remaining = await client.query('SELECT id, name, code FROM companies ORDER BY id;');
    console.log('\nRemaining Canonical Workspaces:');
    console.table(remaining.rows);

  } catch (err) {
    await client.query('ROLLBACK;');
    console.error('❌ Failed deduplication:', err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

runDeduplicationAndConsolidation();
