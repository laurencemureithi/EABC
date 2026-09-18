import nunjucks from 'nunjucks';

export function urlFor(endpoint, kwargs = {}) {
  switch (endpoint) {
    case 'static':
      return '/static/' + (kwargs.filename || '');
    case 'dashboard':
      return '/dashboard';
    case 'dashboard_strategic_export':
      return '/dashboard/strategic-export';
    case 'assets':
    case 'assets_master_list':
      return '/assets';
    case 'assets_add_step1_get':
    case 'assets_add_step1_post':
      return '/assets/new/step-1';
    case 'assets_add_step2_get':
    case 'assets_add_step2_post':
      return '/assets/new/step-2';
    case 'assets_add_step3_post':
      return '/assets/new/step-3';
    case 'assets_profile_get':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}`;
    case 'assets_edit_get':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/edit`;
    case 'assets_delete':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/delete`;
    case 'assets_profile_pdf':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/profile.pdf`;
    case 'assets_spare_parts_get':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/spare-parts`;
    case 'assets_spare_parts_export':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/spare-parts/export`;
    case 'assets_documents_get':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/documents`;
    case 'assets_documents_upload_get':
    case 'assets_documents_upload_post':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/documents/upload`;
    case 'assets_document_delete':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/documents/${kwargs.doc_id || ''}/delete`;
    case 'assets_maintenance_history_get':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/maintenance-history`;
    case 'assets_maintenance_history_export':
      return `/assets/${kwargs.asset_uid || kwargs.uid || ''}/maintenance-history/export`;
    case 'assets_export':
      return '/assets/export';

    case 'breakdowns':
    case 'breakdowns_management':
      return '/breakdowns';
    case 'breakdowns_new_step1_get':
      return '/breakdowns/new/step1';
    case 'breakdowns_view':
      return `/breakdowns/${kwargs.breakdown_id || kwargs.id || ''}`;
    case 'breakdowns_update_get':
    case 'breakdowns_update_post':
      return `/breakdowns/${kwargs.breakdown_id || kwargs.id || ''}/update`;
    case 'breakdowns_rca_get':
      return `/breakdowns/${kwargs.breakdown_id || kwargs.id || ''}/rca`;
    case 'breakdowns_close':
      return `/breakdowns/${kwargs.breakdown_id || kwargs.id || ''}/close`;
    case 'breakdowns_delete':
      return `/breakdowns/${kwargs.breakdown_id || kwargs.id || ''}/delete`;
    case 'breakdowns_export':
      return '/breakdowns/export';

    case 'maintenance_management':
      return '/maintenance';
    case 'maintenance_schedule_step1':
    case 'maintenance_schedule_step1_post':
      return '/maintenance/schedule/step-1';
    case 'maintenance_schedule_step2':
    case 'maintenance_schedule_step2_post':
      return '/maintenance/schedule/step-2';
    case 'maintenance_schedule_step3_post':
      return '/maintenance/schedule/step-3';
    case 'maintenance_calendar':
      return '/maintenance/calendar';
    case 'maintenance_view':
      return `/maintenance/${kwargs.task_id || kwargs.id || ''}`;
    case 'maintenance_work_order_view':
      return `/maintenance/${kwargs.task_id || kwargs.id || ''}/work-order`;
    case 'maintenance_update_get':
    case 'maintenance_update_post':
      return `/maintenance/${kwargs.task_id || kwargs.id || ''}/update`;
    case 'maintenance_complete':
      return `/maintenance/${kwargs.task_id || kwargs.id || ''}/complete`;
    case 'maintenance_delete':
      return `/maintenance/${kwargs.task_id || kwargs.id || ''}/delete`;
    case 'maintenance_schedule_print':
      return '/maintenance/schedule/print';
    case 'maintenance_export':
      return '/maintenance/export';
    case 'maintenance_assets_by_section':
      return '/maintenance/assets-by-section';

    case 'inventory_management':
      return '/inventory';
    case 'inventory_add_step1_get':
    case 'inventory_add_step1_post':
      return '/inventory/new/step-1';
    case 'inventory_add_step2_get':
    case 'inventory_add_step2_post':
      return '/inventory/new/step-2';
    case 'inventory_add_step3_post':
      return '/inventory/new/step-3';
    case 'inventory_part_view':
      return `/inventory/${kwargs.part_id || kwargs.uid || kwargs.id || ''}`;
    case 'inventory_export':
      return '/inventory/export';

    case 'reports_center':
      return '/reports';
    case 'reports_generate_step1_get':
    case 'reports_generate_step1_post':
      return '/reports/generate/step-1';
    case 'reports_generate_step2_get':
    case 'reports_generate_step2_post':
      return '/reports/generate/step-2';
    case 'reports_generate_step3_post':
      return '/reports/generate/step-3';
    case 'reports_view':
      return `/reports/view/${kwargs.report_type || kwargs.type || 'strategic-roi'}`;
    case 'reports_history':
      return '/reports/history';
    case 'reports_export':
      return '/reports/export';
    case 'reports_delete':
      return `/reports/${kwargs.report_id || kwargs.id || ''}/delete`;

    case 'settings_admin':
    case 'settings_admin_save':
      return '/settings';
    case 'admin_companies_page':
      return '/admin/companies';
    case 'admin_companies_switch':
      return `/admin/companies/switch/${kwargs.company_id || ''}`;
    case 'admin_companies_create':
      return '/admin/companies/create';
    case 'admin_companies_edit':
      return `/admin/companies/edit/${kwargs.company_id || ''}`;
    case 'admin_companies_delete':
      return `/admin/companies/delete/${kwargs.company_id || ''}`;
    case 'admin_users_page':
      return '/admin/users';
    case 'admin_users_create':
      return '/admin/users/create';
    case 'admin_users_toggle':
      return `/admin/users/toggle/${kwargs.user_id || ''}`;
    case 'admin_users_delete':
      return `/admin/users/delete/${kwargs.user_id || ''}`;
    case 'admin_users_update_role':
      return '/admin/users/update-role';
    case 'technicians_management':
      return '/technicians';
    case 'technicians_create':
      return '/technicians/create';
    case 'technicians_toggle':
      return `/technicians/toggle/${kwargs.tech_id || ''}`;
    case 'technicians_delete':
      return `/technicians/delete/${kwargs.tech_id || ''}`;
    case 'notifications':
      return '/notifications';
    case 'notifications_open':
      return `/notifications/open/${kwargs.notif_id || ''}`;
    case 'notifications_read_all':
      return '/notifications/read-all';
    case 'notifications_toggle':
      return `/notifications/toggle/${kwargs.notif_id || ''}`;
    case 'messages_center':
      return '/messages';
    case 'messages_send':
      return '/messages/send';
    case 'messages_send_outbox':
      return '/messages/send-outbox';
    case 'messages_delete_draft':
      return `/messages/drafts/${kwargs.msg_id || ''}/delete`;
    case 'messages_delete_outbox':
      return `/messages/outbox/${kwargs.msg_id || ''}/delete`;
    case 'audit_trail_page':
      return '/audit-trail';
    case 'audit_trail_export':
      return '/audit-trail/export';
    case 'profile':
    case 'profile_save':
      return '/profile';
    case 'help_page':
      return '/help';
    case 'login':
    case 'login_submit':
      return '/login';
    case 'login_google':
      return '/login/google';
    case 'logout':
      return '/logout';
    case 'set_department':
      return '/set-department';
    case 'api_live_dashboard_kpis':
      return '/api/live/dashboard-kpis';
    case 'api_live_breakdowns_kpis':
      return '/api/live/breakdowns-kpis';
    case 'api_live_maintenance_kpis':
      return '/api/live/maintenance-kpis';
    case 'api_live_reports_kpis':
      return '/api/live/reports-kpis';
    case 'api_live_breakdown_detail':
      return `/api/live/breakdown/${kwargs.breakdown_id || ''}`;

    default:
      return '/' + endpoint.replace(/_/g, '-');
  }
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
