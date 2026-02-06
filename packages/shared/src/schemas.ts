import { z } from 'zod';
import {
  TICKET_STATES, PRIORITIES, TIMEOUT_ACTIONS,
  INTENT_KINDS, DECISIONS,
} from './constants.js';

export const HumanIdSchema = z.string().regex(/^human:[a-z0-9_-]+$/);
export const AgentIdSchema = z.string().regex(/^(agent|system):[a-z0-9_-]+$/);
export const TicketIdSchema = z.string().regex(/^tk_[a-z0-9]{3,}$/);

export const TicketStateSchema = z.enum(TICKET_STATES);
export const PrioritySchema = z.enum(PRIORITIES);
export const TimeoutActionSchema = z.enum(TIMEOUT_ACTIONS);
export const IntentKindSchema = z.enum(INTENT_KINDS);
export const DecisionSchema = z.enum(DECISIONS);

export const LeaseSchema = z.object({
  ttl_seconds: z.number().int().min(1).max(604800),
  on_timeout: TimeoutActionSchema,
});

export const IntentSchema = z.object({
  kind: z.string().min(1),
  summary: z.string().min(1).max(200),
  details: z.record(z.unknown()).default({}),
});

export const ArtifactSchema = z.object({
  type: z.string().optional(),
  diff_hash: z.string().optional(),
}).passthrough().optional();

export const TicketCreateSchema = z.object({
  to: HumanIdSchema,
  intent: IntentSchema,
  artifact: ArtifactSchema,
  lease: LeaseSchema,
  risk: z.number().min(0).max(1),
  priority: PrioritySchema,
  diff: z.string().optional(),
  file: z.string().optional(),
  lines_added: z.number().optional(),
  lines_removed: z.number().optional(),
  on_timeout: TimeoutActionSchema.optional(),
  ttl_seconds: z.number().int().min(1).max(604800).optional(),
});

export const IntentSignSchema = z.object({
  ticket_id: TicketIdSchema,
  decision: DecisionSchema,
  comment: z.string().max(1000).optional(),
  typed_confirmation: z.string().optional(),
});
