export const TICKET_STATES = [
  'NEW', 'PENDING', 'DELIVERED', 'ACKED',
  'APPROVED', 'REJECTED', 'CHANGES_REQUESTED',
  'EXPIRED', 'CANCELED',
] as const;

export const TERMINAL_STATES = [
  'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'EXPIRED', 'CANCELED',
] as const;

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;

export const TIMEOUT_ACTIONS = ['auto_approve', 'auto_reject', 'cancel'] as const;

export const INTENT_KINDS = [
  'modify_file', 'delete_file', 'create_file',
  'run_command', 'deploy', 'approve_expense',
] as const;

export const DECISIONS = ['approve', 'reject', 'request_changes'] as const;
