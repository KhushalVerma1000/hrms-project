// Shared (server + client safe) description of every audit action we write.
// Adding a new writeAuditLog({ action }) call? Add it here too, or it shows
// up as a generic "system" event.

export type AuditCategory = 'Employees' | 'Stores & Clients' | 'Devices' | 'Attendance' | 'Users' | 'System';
export type AuditSeverity = 'info' | 'notice' | 'critical';

interface ActionMeta {
  label: string;
  category: AuditCategory;
  severity: AuditSeverity;
  /** Hidden from CLIENT users: platform-internal plumbing, not their business activity. */
  adminOnly?: boolean;
}

export const AUDIT_ACTIONS: Record<string, ActionMeta> = {
  EMPLOYEE_ONBOARD: { label: 'Employee onboarded', category: 'Employees', severity: 'info' },
  EMPLOYEE_UPDATE: { label: 'Employee updated', category: 'Employees', severity: 'info' },
  EMPLOYEE_SOFT_DELETE: { label: 'Employee deactivated', category: 'Employees', severity: 'notice' },
  EMPLOYEE_REACTIVATE: { label: 'Employee reactivated', category: 'Employees', severity: 'notice' },
  EMPLOYEE_HARD_DELETE: { label: 'Employee permanently deleted', category: 'Employees', severity: 'critical' },
  EMPLOYEE_FORM_MARKED_SUBMITTED: { label: 'Onboarding form marked submitted', category: 'Employees', severity: 'notice' },
  FORM_SUBMISSION_ASSIGNED: { label: 'Unmatched form submission linked to employee', category: 'Employees', severity: 'notice' },
  FORM_SUBMISSION_DISMISSED: { label: 'Unmatched form submission dismissed', category: 'System', severity: 'info', adminOnly: true },
  FORM_REMINDER_SENT: { label: 'Onboarding form reminder sent', category: 'Employees', severity: 'info' },

  CLIENT_CREATE: { label: 'Client created', category: 'Stores & Clients', severity: 'notice', adminOnly: true },
  CLIENT_GOOGLE_FORM_UPDATE: { label: 'Onboarding form link updated', category: 'Stores & Clients', severity: 'info' },
  STORE_GOOGLE_FORM_UPDATE: { label: 'Store onboarding form link updated', category: 'Stores & Clients', severity: 'info' },
  WAREHOUSE_TYPE_CREATE: { label: 'Brand created', category: 'Stores & Clients', severity: 'notice', adminOnly: true },
  CLIENT_DETAILS_UPDATE: { label: 'Company details updated', category: 'Stores & Clients', severity: 'info' },
  STORE_DETAILS_UPDATE: { label: 'Store details updated', category: 'Stores & Clients', severity: 'info' },
  STORE_CREATE: { label: 'Store created', category: 'Stores & Clients', severity: 'notice' },
  STORE_FACE_ATTENDANCE_CHANGED: { label: 'Face attendance switched on/off', category: 'Stores & Clients', severity: 'notice' },
  STORE_ATTENDANCE_MODE_CHANGED: { label: 'Attendance mode changed', category: 'Stores & Clients', severity: 'notice' },

  DEVICE_ADD: { label: 'Device added', category: 'Devices', severity: 'notice' },
  DEVICE_DELETE: { label: 'Device removed', category: 'Devices', severity: 'critical' },
  DEVICE_CLEAR_LOGS: { label: 'Device logs cleared', category: 'Devices', severity: 'critical' },

  MANUAL_ATTENDANCE_SAVED: { label: 'Manual attendance saved', category: 'Attendance', severity: 'info' },
  ATTENDANCE_CSV_COMMITTED: { label: 'Attendance CSV committed', category: 'Attendance', severity: 'info' },
  ATTENDANCE_OT_DISCREPANCY_CLEARED: { label: 'OT discrepancy cleared', category: 'Attendance', severity: 'notice' },
  ATTENDANCE_LATE_ACCESS_REQUESTED: { label: 'Late upload access requested', category: 'Attendance', severity: 'notice' },
  ATTENDANCE_LATE_ACCESS_APPROVED: { label: 'Late upload access approved', category: 'Attendance', severity: 'notice' },
  ATTENDANCE_LATE_ACCESS_DENIED: { label: 'Late upload access denied', category: 'Attendance', severity: 'notice' },
  ATTENDANCE_DEADLINE_CLIENT_DEFAULT_SET: { label: 'Client deadline default set', category: 'Attendance', severity: 'notice', adminOnly: true },
  ATTENDANCE_DEADLINE_STORE_OVERRIDE_SET: { label: 'Store deadline override set', category: 'Attendance', severity: 'notice', adminOnly: true },
  ATTENDANCE_DEADLINE_STORE_OVERRIDE_CLEARED: { label: 'Store deadline override cleared', category: 'Attendance', severity: 'notice', adminOnly: true },

  REPORT_DOWNLOADED: { label: 'Attendance report downloaded', category: 'Attendance', severity: 'info' },

  FACE_ENROLLED: { label: 'Face data enrolled', category: 'Attendance', severity: 'notice' },
  FACE_DATA_DELETED: { label: 'Face data deleted', category: 'Attendance', severity: 'notice' },

  USER_CREATE: { label: 'App user created', category: 'Users', severity: 'notice' },

  COMMAND_RETRY: { label: 'Sync command retried', category: 'System', severity: 'info', adminOnly: true },
};

const FALLBACK: ActionMeta = { label: '', category: 'System', severity: 'info', adminOnly: true };

export function describeAction(action: string): ActionMeta {
  const m = AUDIT_ACTIONS[action];
  if (m) return m;
  // Unknown/new action: readable label, admin-only until someone catalogs it.
  const label = action.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return { ...FALLBACK, label };
}

export function actionsForCategory(category: string, includeAdminOnly: boolean): string[] {
  return Object.entries(AUDIT_ACTIONS)
    .filter(([, m]) => m.category === category && (includeAdminOnly || !m.adminOnly))
    .map(([k]) => k);
}

export function clientVisibleActions(): string[] {
  return Object.entries(AUDIT_ACTIONS).filter(([, m]) => !m.adminOnly).map(([k]) => k);
}

export function criticalActions(): string[] {
  return Object.entries(AUDIT_ACTIONS).filter(([, m]) => m.severity === 'critical').map(([k]) => k);
}

export const AUDIT_CATEGORIES: AuditCategory[] = ['Employees', 'Stores & Clients', 'Devices', 'Attendance', 'Users', 'System'];

/** One-line human summary of an audit row's metadata. Never dumps raw JSON. */
export function summarizeMetadata(action: string, raw: unknown): string {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  switch (action) {
    case 'EMPLOYEE_ONBOARD':
      return s(m.designation) ? `Designation: ${String(m.designation).replace(/_/g, ' ').toLowerCase()}` : '';
    case 'EMPLOYEE_UPDATE':
    case 'CLIENT_DETAILS_UPDATE':
    case 'STORE_DETAILS_UPDATE': {
      const keys = m.changes && typeof m.changes === 'object' ? Object.keys(m.changes as object) : [];
      return keys.length ? `Changed: ${keys.join(', ')}` : '';
    }
    case 'CLIENT_GOOGLE_FORM_UPDATE':
    case 'STORE_GOOGLE_FORM_UPDATE':
      return m.googleFormBaseUrl ? 'Form link set' : 'Form link cleared (inherits default)';
    case 'STORE_ATTENDANCE_MODE_CHANGED':
      return s(m.newMode) ? `Now ${String(m.newMode).toLowerCase()}` : '';
    case 'STORE_CREATE':
      return s(m.attendanceMode) ? `Attendance: ${String(m.attendanceMode).toLowerCase()}` : '';
    case 'MANUAL_ATTENDANCE_SAVED':
      return s(m.entriesSaved) ? `${m.entriesSaved} entries${s(m.date) ? ` for ${m.date}` : ''}` : '';
    case 'ATTENDANCE_CSV_COMMITTED':
      return s(m.saved) ? `${m.saved} rows${m.isLate ? ' (late upload)' : ''}` : '';
    case 'ATTENDANCE_LATE_ACCESS_REQUESTED':
      return s(m.reason) ? `Reason: ${m.reason}` : '';
    case 'ATTENDANCE_LATE_ACCESS_APPROVED':
    case 'ATTENDANCE_LATE_ACCESS_DENIED':
      return s(m.adminNote) ? `Note: ${m.adminNote}` : '';
    case 'USER_CREATE':
      return [s(m.email), s(m.role) && String(m.role).replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ');
    case 'DEVICE_ADD':
    case 'DEVICE_DELETE':
    case 'DEVICE_CLEAR_LOGS':
      return s(m.serialNumber) ? `Serial ${m.serialNumber}` : '';
    default:
      return '';
  }
}
