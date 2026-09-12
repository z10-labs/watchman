import { z } from 'zod';

/**
 * What the model is allowed to return.
 *
 * Note what is absent: the overall status. The model reports findings and their
 * severities; the service derives the verdict and the check-run conclusion from
 * them mechanically. A model cannot talk itself — or be talked by a diff — into
 * a gate decision it does not get to make.
 */
export const rawFindingSchema = z.object({
  severity: z
    .enum(['info', 'warn', 'block'])
    .describe('block only when the change must not merge as it stands'),
  title: z.string().min(3).max(120).describe('a short, specific claim'),
  body: z.string().min(10).describe('one paragraph: what you saw and why it matters'),
  suggested_action: z
    .string()
    .min(3)
    .describe('fix in this PR / log a decision file / split the PR / accept with rationale'),
  source: z
    .string()
    .min(1)
    .describe('what makes this citable: file:line, a decision id, or a document section'),
  module: z.string().optional().describe('the area of the product this touches'),
});

export const rawVerdictSchema = z.object({
  findings: z.array(rawFindingSchema).max(20),
  bottom_line: z
    .string()
    .min(10)
    .describe('would you ship this? if blocking, the minimum bar to unblock'),
});

export type RawVerdict = z.infer<typeof rawVerdictSchema>;
