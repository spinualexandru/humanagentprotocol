import type { z } from 'zod';
import type {
  PrioritySchema, TimeoutActionSchema,
  TicketCreateSchema, IntentSignSchema, LeaseSchema,
} from './schemas.js';
import { TICKET_STATES } from './constants.js';

export type TicketState = (typeof TICKET_STATES)[number];
export type Priority = z.infer<typeof PrioritySchema>;
export type TimeoutAction = z.infer<typeof TimeoutActionSchema>;
export type TicketCreateInput = z.infer<typeof TicketCreateSchema>;
export type IntentSignInput = z.infer<typeof IntentSignSchema>;
export type LeaseConfig = z.infer<typeof LeaseSchema>;

export interface Ticket {
  id: string;
  from: string;
  to: string;
  intent: { kind: string; summary: string; details: Record<string, unknown> };
  artifact: Record<string, unknown> | null;
  lease: LeaseConfig;
  risk: number;
  priority: Priority;
  state: TicketState;
  created_at: string;
  updated_at: string;
}

export interface HapEvent {
  id: string;
  type: string;
  ts: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}
