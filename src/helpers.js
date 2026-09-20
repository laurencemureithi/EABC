import nunjucks from 'nunjucks';

export function urlFor(endpoint, kwargs = {}) {
  if (!endpoint || typeof endpoint !== 'string') return '#';
  const consumed = new Set();
  const getParam = (key, fallbackKey = null, defVal = '') => {
    consumed.add(key);
    if (fallbackKey) consumed.add(fallbackKey);
    return kwargs[key] !== undefined ? kwargs[key] : (fallbackKey && kwargs[fallbackKey] !== undefined ? kwargs[fallbackKey] : defVal);
  };

  let basePath = '';
  switch (endpoint) {
    case 'static':
      basePath = '/static/' + (getParam('filename') || '');
      break;
    case 'dashboard':
      basePath = '/dashboard';
      break;
    case 'dashboard_strategic_export':
      basePath = '/dashboard/strategic-export';
      break;
    case 'assets':
    case 'assets_master_list':
      basePath = '/assets';
      break;
    case 'assets_add_step1_get':
    case 'assets_add_step1_post':
      basePath = '/assets/new/step-1';
      break;
    case 'assets_add_step2_get':
    case 'assets_add_step2_post':
      basePath = '/assets/new/step-2';
      break;
    case 'assets_add_step3_post':
      basePath = '/assets/new/step-3';
      break;
    case 'assets_profile_get':
      basePath = `/assets/${getParam('asset_uid', 'uid')}`;
      break;
    case 'assets_edit_get':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/edit`;
      break;
    case 'assets_delete':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/delete`;
      break;
    case 'assets_profile_pdf':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/profile.pdf`;
      break;
    case 'assets_spare_parts_get':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/spare-parts`;
      break;
    case 'assets_spare_parts_export':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/spare-parts/export`;
      break;
    case 'assets_documents_get':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/documents`;
      break;
    case 'assets_documents_upload_get':
    case 'assets_documents_upload_post':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/documents/upload`;
      break;
    case 'assets_document_delete':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/documents/${getParam('doc_id')}/delete`;
      break;
    case 'assets_maintenance_history_get':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/maintenance-history`;
      break;
    case 'assets_maintenance_history_export':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/maintenance-history/export`;
      break;
    case 'assets_breakdowns_get':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/breakdowns`;
      break;
    case 'assets_breakdowns_export':
      basePath = `/assets/${getParam('asset_uid', 'uid')}/breakdowns/export`;
      break;
    case 'assets_export':
      basePath = '/assets/export';
      break;

    case 'breakdowns':
    case 'breakdowns_management':
      basePath = '/breakdowns';
      break;
    case 'breakdowns_new_step1_get':
      basePath = '/breakdowns/new/step1';
      break;
    case 'breakdowns_view':
      basePath = `/breakdowns/${getParam('breakdown_id', 'id')}`;
      break;
    case 'breakdowns_update_get':
    case 'breakdowns_update_post':
      basePath = `/breakdowns/${getParam('breakdown_id', 'id')}/update`;
      break;
    case 'breakdowns_rca_get':
      basePath = `/breakdowns/${getParam('breakdown_id', 'id')}/rca`;
      break;
    case 'breakdowns_close':
      basePath = `/breakdowns/${getParam('breakdown_id', 'id')}/close`;
      break;
    case 'breakdowns_delete':
      basePath = `/breakdowns/${getParam('breakdown_id', 'id')}/delete`;
      break;
    case 'breakdowns_export':
      basePath = '/breakdowns/export';
      break;

    case 'maintenance_management':
      basePath = '/maintenance';
      break;
    case 'maintenance_schedule_step1':
    case 'maintenance_schedule_step1_post':
      basePath = '/maintenance/schedule/step-1';
      break;
    case 'maintenance_schedule_step2':
    case 'maintenance_schedule_step2_post':
      basePath = '/maintenance/schedule/step-2';
      break;
    case 'maintenance_schedule_step3_post':
      basePath = '/maintenance/schedule/step-3';
      break;
    case 'maintenance_calendar':
      basePath = '/maintenance/calendar';
      break;
    case 'maintenance_view':
      basePath = `/maintenance/${getParam('task_id', 'id')}`;
      break;
    case 'maintenance_work_order_view':
      basePath = `/maintenance/${getParam('task_id', 'id')}/work-order`;
      break;
    case 'maintenance_update_get':
    case 'maintenance_update_post':
      basePath = `/maintenance/${getParam('task_id', 'id')}/update`;
      break;
    case 'maintenance_complete':
      basePath = `/maintenance/${getParam('task_id', 'id')}/complete`;
      break;
    case 'maintenance_delete':
      basePath = `/maintenance/${getParam('task_id', 'id')}/delete`;
      break;
    case 'maintenance_schedule_print':
      basePath = '/maintenance/schedule/print';
      break;
    case 'maintenance_export':
      basePath = '/maintenance/export';
      break;
    case 'maintenance_assets_by_section':
      basePath = '/maintenance/assets-by-section';
      break;

    case 'inventory_management':
      basePath = '/inventory';
      break;
    case 'inventory_add_step1_get':
    case 'inventory_add_step1_post':
      basePath = '/inventory/new/step-1';
      break;
    case 'inventory_add_step2_get':
    case 'inventory_add_step2_post':
      basePath = '/inventory/new/step-2';
      break;
    case 'inventory_add_step3_post':
      basePath = '/inventory/new/step-3';
      break;
    case 'inventory_part_view':
      basePath = `/inventory/${getParam('part_uid', 'part_id', 'uid') || getParam('id')}`;
      break;
    case 'inventory_export':
      basePath = '/inventory/export';
      break;

    case 'reports_center':
      basePath = '/reports';
      break;
    case 'reports_generate_step1_get':
    case 'reports_generate_step1_post':
      basePath = '/reports/generate/step-1';
      break;
    case 'reports_generate_step2_get':
    case 'reports_generate_step2_post':
      basePath = '/reports/generate/step-2';
      break;
    case 'reports_generate_step3_get':
    case 'reports_generate_step3_post':
      basePath = '/reports/generate/step-3';
      break;
    case 'reports_generate_success':
      basePath = '/reports/generate/success';
      break;
    case 'reports_view':
      basePath = `/reports/view/${getParam('rid', 'report_id', 'report_type', 'type', 'strategic-roi')}`;
      break;
    case 'reports_history':
      basePath = '/reports/history';
      break;
    case 'reports_export':
      basePath = '/reports/export';
      break;
    case 'reports_delete':
      basePath = `/reports/${getParam('report_id', 'id')}/delete`;
      break;
    case 'reports_chart_data':
      basePath = `/reports/export/${getParam('report_id', 'rid', 'sr-current')}/chart_data`;
      break;

    case 'settings_admin':
    case 'settings_admin_save':
      basePath = '/settings';
      break;
    case 'admin_companies_page':
      basePath = '/admin/companies';
      break;
    case 'admin_companies_switch':
      basePath = `/admin/companies/switch/${getParam('company_id')}`;
      break;
    case 'admin_companies_create':
      basePath = '/admin/companies/create';
      break;
    case 'admin_companies_edit':
      basePath = `/admin/companies/edit/${getParam('company_id')}`;
      break;
    case 'admin_companies_delete':
      basePath = `/admin/companies/delete/${getParam('company_id')}`;
      break;
    case 'admin_users_page':
      basePath = '/admin/users';
      break;
    case 'admin_users_create':
      basePath = '/admin/users/create';
      break;
    case 'admin_users_toggle':
      basePath = `/admin/users/toggle/${getParam('user_id')}`;
      break;
    case 'admin_users_delete':
      basePath = `/admin/users/delete/${getParam('user_id')}`;
      break;
    case 'admin_users_update_role':
      basePath = '/admin/users/update-role';
      break;
    case 'technicians_management':
      basePath = '/technicians';
      break;
    case 'technicians_create':
      basePath = '/technicians/create';
      break;
    case 'technicians_toggle':
      basePath = `/technicians/toggle/${getParam('tech_id')}`;
      break;
    case 'technicians_delete':
      basePath = `/technicians/delete/${getParam('tech_id')}`;
      break;
    case 'notifications':
      basePath = '/notifications';
      break;
    case 'notifications_open':
      basePath = `/notifications/open/${getParam('notif_id')}`;
      break;
    case 'notifications_read_all':
      basePath = '/notifications/read-all';
      break;
    case 'notifications_toggle':
      basePath = `/notifications/toggle/${getParam('notif_id')}`;
      break;
    case 'messages_center':
      basePath = '/messages';
      break;
    case 'messages_send':
      basePath = '/messages/send';
      break;
    case 'messages_send_outbox':
      basePath = '/messages/send-outbox';
      break;
    case 'messages_delete_draft':
      basePath = `/messages/drafts/${getParam('msg_id')}/delete`;
      break;
    case 'messages_delete_outbox':
      basePath = `/messages/outbox/${getParam('msg_id')}/delete`;
      break;
    case 'audit_trail_page':
      basePath = '/audit-trail';
      break;
    case 'audit_trail_export':
      basePath = '/audit-trail/export';
      break;
    case 'profile':
    case 'profile_save':
      basePath = '/profile';
      break;
    case 'help_page':
      basePath = '/help';
      break;
    case 'login':
    case 'login_submit':
      basePath = '/login';
      break;
    case 'login_google':
      basePath = '/login/google';
      break;
    case 'logout':
      basePath = '/logout';
      break;
    case 'set_department':
      basePath = '/set-department';
      break;
    case 'api_live_dashboard_kpis':
      basePath = '/api/live/dashboard-kpis';
      break;
    case 'api_live_breakdowns_kpis':
      basePath = '/api/live/breakdowns-kpis';
      break;
    case 'api_live_maintenance_kpis':
      basePath = '/api/live/maintenance-kpis';
      break;
    case 'api_live_reports_kpis':
      basePath = '/api/live/reports-kpis';
      break;
    case 'api_live_breakdown_detail':
      basePath = `/api/live/breakdown/${getParam('breakdown_id')}`;
      break;

    default:
      basePath = '/' + endpoint.replace(/_/g, '-');
      break;
  }

  // Append any kwargs that were not consumed in the path as query parameters (Flask parity)
  const queryParams = new URLSearchParams();
  for (const [key, val] of Object.entries(kwargs)) {
    if (!consumed.has(key) && val !== undefined && val !== null && val !== '') {
      queryParams.append(key, String(val));
    }
  }
  const qs = queryParams.toString();
  return qs ? `${basePath}${basePath.includes('?') ? '&' : '?'}${qs}` : basePath;
}

export function registerNunjucksFilters(env) {
  env.addFilter('kes0', (v) => 'KES ' + Math.round(Number(v) || 0).toLocaleString());
  env.addFilter('kes2', (v) => 'KES ' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  env.addFilter('tojson', (v) => nunjucks.runtime.markSafe(JSON.stringify(v !== undefined ? v : null)));
  env.addFilter('int', (v) => parseInt(v, 10) || 0);
  env.addFilter('min', (a, b) => (Array.isArray(a) ? Math.min(...a) : (b !== undefined ? Math.min(a, b) : a)));
  env.addFilter('max', (a, b) => (Array.isArray(a) ? Math.max(...a) : (b !== undefined ? Math.max(a, b) : a)));
  env.addFilter('abs', (n) => Math.abs(Number(n) || 0));
  env.addFilter('round', (n, p = 0) => Math.round(Number(n || 0) * Math.pow(10, p)) / Math.pow(10, p));
  env.addFilter('slice', (v, s, e) => (v && v.slice ? v.slice(s, e) : v));
  env.addFilter('selectattr', (arr, attr, testOrVal, maybeVal) => {
    if (!Array.isArray(arr)) return [];
    if (testOrVal === undefined) {
      return arr.filter(x => x && x[attr]);
    }
    if (testOrVal === 'equalto' || testOrVal === '==' || testOrVal === 'eq') {
      return arr.filter(x => x && x[attr] === maybeVal);
    }
    if (maybeVal !== undefined) {
      return arr.filter(x => x && x[attr] === maybeVal);
    }
    return arr.filter(x => x && x[attr] === testOrVal);
  });
  env.addFilter('map', (arr, attr) => (arr || []).map(x => (typeof attr === 'string' ? (x ? x[attr] : undefined) : x)));
  env.addFilter('batch', (arr, size, fill = null) => {
    if (!Array.isArray(arr)) return [];
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
      const slice = arr.slice(i, i + size);
      if (fill !== null && slice.length < size) {
        while (slice.length < size) slice.push(fill);
      }
      result.push(slice);
    }
    return result;
  });
  env.addFilter('list', (v) => (Array.isArray(v) ? v : (v !== undefined && v !== null ? [v] : [])));
  env.addFilter('sum', (arr, attr) => (arr || []).reduce((acc, x) => acc + (attr ? Number(x[attr] || 0) : Number(x || 0)), 0));
  env.addFilter('format', function (str, ...args) {
    let i = 0;
    return String(str).replace(/%([0-9]*\.?[0-9]*[dfs])/g, (match, spec) => {
      const val = args[i++];
      if (spec.endsWith('f')) {
        const parts = spec.slice(0, -1).split('.');
        const precision = parts[1] !== undefined ? parseInt(parts[1], 10) : 6;
        return Number(val || 0).toFixed(precision);
      }
      if (spec.endsWith('d')) return parseInt(val || 0, 10);
      return val !== undefined ? val : match;
    });
  });
}
