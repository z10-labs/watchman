import { z } from 'zod';

/**
 * What the model is allowed to return.
 *
 * Note what is absent: the overall status. The model reports findings and their
 * severities; the service derives the verdict and the check-run conclusion from
 * them mechanically. A model cannot talk itself — or be talked by a diff — into
 * a gate decision it does not get to make.
 */
/*
 * Length limits live in the descriptions, which the model reads, and in the
 * prompt's verdict rules. The hard `max` values are deliberately looser: a
 * schema rejection fails the whole review, and an over-long finding is a
 * worse outcome than a failed run only in the reader's patience, not the gate.
 */
export const rawFindingSchema = z.object({
  severity: z
    .enum(['info', 'warn', 'block'])
    .describe(
      'default warn; block only when the diff contradicts an active decision or invariant AND would cause real harm if merged',
    ),
  title: z.string().min(3).max(120).describe('at most 10 words'),
  body: z
    .string()
    .min(10)
    .max(1200)
    .describe('at most 40 words: what the diff does, then what it conflicts with; one concern only'),
  suggested_action: z
    .string()
    .min(3)
    .max(400)
    .describe('at most 15 words, imperative'),
  source: z
    .string()
    .min(1)
    .max(300)
    .describe('one or two references: file:line or a decision id; no prose'),
  module: z.string().optional().describe('the area of the product this touches'),
});

export const rawVerdictSchema = z.object({
  findings: z.array(rawFindingSchema).max(10).describe('at most 3; none is a common answer'),
  bottom_line: z
    .string()
    .min(3)
    .max(800)
    .describe('at most 25 words; exactly "Ship it." when clean'),
});

export type RawVerdict = z.infer<typeof rawVerdictSchema>;
