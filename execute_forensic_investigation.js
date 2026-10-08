const http = require('http');
const fs = require('fs');
const path = require('path');

const DATASTORE_PATH = path.join(__dirname, 'data', 'datastore.json');

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function runAudit() {
  console.log('================================================================');
  console.log('🔬 FORENSIC INVESTIGATION EXECUTION SCRIPT');
  console.log('================================================================\n');

  // STEP 0: Admin Login
  console.log('STEP 0: Admin Authentication');
  const loginRes = await req({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, 'email=opsloom.ke%40gmail.com&password=Admin%40123');
  
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  console.log('  Login status:', loginRes.status);
  console.log('  Session cookies:', cookies);

  // PART 3 & 4: Workspace Creation, Storage Check, Deletion, Storage Check, Refresh, Storage Check
  console.log('\n----------------------------------------------------------------');
  console.log('PART 3: WORKSPACE DELETION STORAGE FORENSICS');
  console.log('----------------------------------------------------------------');
  
  const uniqueCode = 'AUD_' + Math.floor(1000 + Math.random() * 9000);
  const wsName = 'Forensic Target Workspace ' + uniqueCode;
  console.log(`Creating Workspace: "${wsName}" (${uniqueCode})...`);

  const createWsRes = await req({
    path: '/settings/companies/save',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies
    }
  }, `name=${encodeURIComponent(wsName)}&code=${encodeURIComponent(uniqueCode)}`);
  console.log('  Create HTTP Status:', createWsRes.status, 'Redirect:', createWsRes.headers.location);

  // Inspect storage directly
  let rawDisk = fs.readFileSync(DATASTORE_PATH, 'utf8');
  let storeObj = JSON.parse(rawDisk);
  const createdWs = storeObj.COMPANIES.find(c => c.code === uniqueCode);
  console.log('\n[STORAGE CHECK: AFTER CREATION]');
  console.log('  Workspace ID:', createdWs ? createdWs.id : 'NOT FOUND');
  console.log('  Workspace Name:', createdWs ? createdWs.name : 'NOT FOUND');
  console.log('  Storage Location:', DATASTORE_PATH);
  console.log('  Present in COMPANIES array:', createdWs ? 'TRUE' : 'FALSE');
  console.log('  Present in WORKSPACE_DATA bucket:', Boolean(storeObj.WORKSPACE_DATA && storeObj.WORKSPACE_DATA[createdWs.id]));

  if (!createdWs) {
    console.error('FAILED TO CREATE WORKSPACE IN STORAGE');
    return;
  }

  // Pre-deletion inspection
  console.log('\n[RECORD CONTENTS BEFORE DELETION]:');
  console.log(JSON.stringify(createdWs, null, 2));

  // Execute Deletion
  console.log(`\nExecuting Deletion via POST /settings/companies/${createdWs.id}/delete...`);
  const delWsRes = await req({
    path: `/settings/companies/${createdWs.id}/delete`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies
    }
  });
  console.log('  Delete HTTP Status:', delWsRes.status, 'Redirect:', delWsRes.headers.location);

  // IMMEDIATELY inspect underlying persistent storage
  rawDisk = fs.readFileSync(DATASTORE_PATH, 'utf8');
  storeObj = JSON.parse(rawDisk);
  const foundInCompaniesAfterDel = storeObj.COMPANIES.find(c => c.id === createdWs.id);
  const foundInBucketAfterDel = Boolean(storeObj.WORKSPACE_DATA && storeObj.WORKSPACE_DATA[createdWs.id]);
  const foundInRecycleBinAfterDel = (storeObj.RECYCLE_BIN || []).find(b => b.primary_id === createdWs.id || b.identifier === createdWs.id);

  console.log('\n[STORAGE CHECK: IMMEDIATELY AFTER DELETE]');
  console.log('  BEFORE workspace exists = TRUE');
  console.log('  AFTER DELETE workspace in store.COMPANIES =', foundInCompaniesAfterDel ? 'TRUE (STILL PRESENT)' : 'FALSE (ABSENT)');
  console.log('  AFTER DELETE workspace bucket in store.WORKSPACE_DATA =', foundInBucketAfterDel ? 'TRUE (STILL PRESENT)' : 'FALSE (ABSENT)');
  console.log('  AFTER DELETE in store.RECYCLE_BIN =', foundInRecycleBinAfterDel ? 'TRUE (MOVED TO RECYCLE BIN)' : 'FALSE (ABSENT)');
  if (foundInRecycleBinAfterDel) {
    console.log('  Recycle bin entry ID:', foundInRecycleBinAfterDel.id);
    console.log('  Recycle bin entity_type:', foundInRecycleBinAfterDel.entity_type);
  }

  // Simulate Browser Refresh: GET /settings/companies
  console.log('\nSimulating Browser Refresh: GET /settings/companies...');
  const refreshWsRes = await req({
    path: '/settings/companies',
    method: 'GET',
    headers: { 'Cookie': cookies }
  });
  console.log('  Refresh HTTP Status:', refreshWsRes.status);

  // Inspect storage AGAIN after refresh
  rawDisk = fs.readFileSync(DATASTORE_PATH, 'utf8');
  storeObj = JSON.parse(rawDisk);
  const foundInCompaniesAfterRefresh = storeObj.COMPANIES.find(c => c.id === createdWs.id);
  console.log('\n[STORAGE CHECK: AFTER REFRESH]');
  console.log('  Workspace in store.COMPANIES after GET /settings/companies =', foundInCompaniesAfterRefresh ? 'TRUE (RECREATED / RETURNED)' : 'FALSE (REMAINS ABSENT)');

  // Inspect returned HTML to see if the deleted workspace card is rendered
  // Company cards have: `<h3 ... >${wsName}</h3>`
  const hasCardInHtml = refreshWsRes.body.includes(`<h3 class="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">${wsName}`) ||
                        refreshWsRes.body.includes(`>${wsName}</h3>`);
  console.log('  Does rendered HTML table/cards contain the workspace card?', hasCardInHtml);


  // PART 6: ASSET DELETION FORENSICS
  console.log('\n================================================================');
  console.log('PART 6: ASSET DELETION STORAGE FORENSICS');
  console.log('================================================================');

  const assetTag = 'AST_' + Math.floor(1000 + Math.random() * 9000);
  const assetName = 'Forensic Test Pump ' + assetTag;
  console.log(`Creating Asset: "${assetName}" (${assetTag})...`);

  // Step 1: POST /assets/new/step-1
  await req({
    path: '/assets/new/step-1',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, `asset_name=${encodeURIComponent(assetName)}&category=Pumps&section=Processing`);

  // Step 2: POST /assets/new/step-2
  await req({
    path: '/assets/new/step-2',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, `manufacturer=Grundfos&model_number=CR-15&serial_number=SN-998811`);

  // Step 3: POST /assets/new/step-3
  const createAssetRes = await req({
    path: '/assets/new/step-3',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, `asset_id=${encodeURIComponent(assetTag)}&asset_name=${encodeURIComponent(assetName)}&location=Pump+House&criticality=B`);
  console.log('  Create Asset HTTP Status:', createAssetRes.status, 'Redirect:', createAssetRes.headers.location);

  // Inspect storage directly
  rawDisk = fs.readFileSync(DATASTORE_PATH, 'utf8');
  storeObj = JSON.parse(rawDisk);
  const createdAsset = storeObj.ASSETS.find(a => a.asset_id === assetTag || a.asset_name === assetName);
  console.log('\n[STORAGE CHECK: AFTER ASSET CREATION]');
  console.log('  Asset UID:', createdAsset ? createdAsset.uid : 'NOT FOUND');
  console.log('  Asset Tag:', createdAsset ? createdAsset.asset_id : 'NOT FOUND');
  console.log('  Asset Name:', createdAsset ? createdAsset.asset_name : 'NOT FOUND');
  console.log('  Present in store.ASSETS:', createdAsset ? 'TRUE' : 'FALSE');

  if (!createdAsset) {
    console.error('FAILED TO CREATE ASSET IN STORAGE');
    return;
  }

  // Pre-deletion inspection
  console.log('\n[RECORD CONTENTS BEFORE ASSET DELETION]:');
  console.log(JSON.stringify(createdAsset, null, 2));

  // Execute Asset Deletion
  console.log(`\nExecuting Asset Deletion via POST /assets/${encodeURIComponent(createdAsset.uid)}/delete...`);
  const delAssetRes = await req({
    path: `/assets/${encodeURIComponent(createdAsset.uid)}/delete`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies
    }
  }, `asset_uid=${encodeURIComponent(createdAsset.uid)}&asset_id=${encodeURIComponent(createdAsset.asset_id)}`);
  console.log('  Delete Asset HTTP Status:', delAssetRes.status, 'Redirect:', delAssetRes.headers.location);

  // IMMEDIATELY inspect storage
  rawDisk = fs.readFileSync(DATASTORE_PATH, 'utf8');
  storeObj = JSON.parse(rawDisk);
  const foundInAssetsAfterDel = storeObj.ASSETS.find(a => a.uid === createdAsset.uid || a.asset_id === createdAsset.asset_id);
  const activeWsId = storeObj._BOUND_COMPANY_ID || storeObj.ACTIVE_COMPANY_ID || 'comp-001';
  const foundInBucketAssetsAfterDel = storeObj.WORKSPACE_DATA && storeObj.WORKSPACE_DATA[activeWsId] &&
    storeObj.WORKSPACE_DATA[activeWsId].ASSETS.find(a => a.uid === createdAsset.uid || a.asset_id === createdAsset.asset_id);
  const foundInRecycleBinAsset = (storeObj.RECYCLE_BIN || []).find(b => b.primary_id === createdAsset.uid || b.identifier === createdAsset.asset_id);

  console.log('\n[STORAGE CHECK: IMMEDIATELY AFTER ASSET DELETE]');
  console.log('  BEFORE asset exists = TRUE');
  console.log('  AFTER DELETE asset in store.ASSETS =', foundInAssetsAfterDel ? 'TRUE (STILL PRESENT)' : 'FALSE (ABSENT)');
  console.log('  AFTER DELETE asset in bucket ASSETS =', foundInBucketAssetsAfterDel ? 'TRUE (STILL PRESENT)' : 'FALSE (ABSENT)');
  console.log('  AFTER DELETE in store.RECYCLE_BIN =', foundInRecycleBinAsset ? 'TRUE (MOVED TO RECYCLE BIN)' : 'FALSE (ABSENT)');

  // Simulate Browser Refresh: GET /assets
  console.log('\nSimulating Browser Refresh: GET /assets...');
  const refreshAssetRes = await req({
    path: '/assets',
    method: 'GET',
    headers: { 'Cookie': cookies }
  });
  console.log('  Refresh HTTP Status:', refreshAssetRes.status);

  // Inspect storage AGAIN after refresh
  rawDisk = fs.readFileSync(DATASTORE_PATH, 'utf8');
  storeObj = JSON.parse(rawDisk);
  const foundInAssetsAfterRefresh = storeObj.ASSETS.find(a => a.uid === createdAsset.uid || a.asset_id === createdAsset.asset_id);
  console.log('\n[STORAGE CHECK: AFTER REFRESH]');
  console.log('  Asset in store.ASSETS after GET /assets =', foundInAssetsAfterRefresh ? 'TRUE (RECREATED / RETURNED)' : 'FALSE (REMAINS ABSENT)');
  
  // Check if asset is rendered in HTML table
  const hasAssetInHtml = refreshAssetRes.body.includes(assetName) || refreshAssetRes.body.includes(`>${assetTag}<`);
  console.log('  Does rendered HTML table contain the asset?', hasAssetInHtml);


  // PART 3 - RESTORE VERIFICATION
  console.log('\n================================================================');
  console.log('CASE 3: RESTORE WORKSPACE VERIFICATION');
  console.log('================================================================');
  if (foundInRecycleBinAfterDel) {
    console.log(`Restoring Workspace from Recycle Bin via POST /settings/recycle-bin/${foundInRecycleBinAfterDel.bin_id || foundInRecycleBinAfterDel.id}/restore...`);
    const restoreRes = await req({
      path: `/settings/recycle-bin/${foundInRecycleBinAfterDel.bin_id || foundInRecycleBinAfterDel.id}/restore`,
      method: 'POST',
      headers: {
        'Cookie': cookies
      }
    });
    console.log('  Restore HTTP Status:', restoreRes.status, 'Redirect:', restoreRes.headers.location);

    rawDisk = fs.readFileSync(DATASTORE_PATH, 'utf8');
    storeObj = JSON.parse(rawDisk);
    const restoredWs = storeObj.COMPANIES.find(c => c.id === createdWs.id);
    console.log('  Restored WS in store.COMPANIES:', restoredWs ? 'PRESENT (SUCCESS)' : 'ABSENT (FAILED)');
    console.log('  WS bucket exists in WORKSPACE_DATA:', Boolean(storeObj.WORKSPACE_DATA && storeObj.WORKSPACE_DATA[createdWs.id]));
    
    const checkCompaniesPage = await req({
      path: '/settings/companies',
      method: 'GET',
      headers: { 'Cookie': cookies }
    });
    const hasRestoredCard = checkCompaniesPage.body.includes(`>${wsName}</h3>`);
    console.log('  Is restored workspace card visible in GET /settings/companies HTML?', hasRestoredCard);
  }
}

runAudit().catch(console.error);
