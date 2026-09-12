import { anthropic } from '@ai-sdk/anthropic';
import { generateObject, generateText } from 'ai';
import type { GenerateResult, GenerateVerdict } from './index';
import { rawVerdictSchema } from './schema';
import type { TriageModel } from './triage';

/**
 * Per-million-token prices, in cents, so a review can report what it cost.
 *
 * Verified against Anthropic list pricing on 2026-09-05: Opus 5 at $5/$25 per
 * MTok, Haiku 4.5 at $1/$5. Deliberately a constant rather than a lookup — the
 * number printed in a comment must be reproducible, and a silently changing
 * price makes the one metric this product is judged on unauditable.
 *
 * Not modelled here: cache reads bill at ~0.1x input and cache writes at 1.25x
 * (5-minute TTL). `costCents` therefore reports the uncached figure, which
 * overstates a cache hit and understates a cache write.
 */
export const PRICING = {
  review: { inputCentsPerM: 500, outputCentsPerM: 2500 },
  triage: { inputCentsPerM: 100, outputCentsPerM: 500 },
} as const;

export const REVIEW_MODEL = 'claude-opus-5';
export const TRIAGE_MODEL = 'claude-haiku-4-5';

const costCents = (
  usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined,
  price: { inputCentsPerM: number; outputCentsPerM: number },
): number => {
  const input = ((usage?.inputTokens ?? 0) / 1_000_000) * price.inputCentsPerM;
  const output = ((usage?.outputTokens ?? 0) / 1_000_000) * price.outputCentsPerM;
  return Math.round((input + output) * 100) / 100;
};

/**
 * The production reviewer.
 *
 * The rubric and the source-of-truth documents are identical for every pull
 * request in a repository and change on the order of weeks, so they go in a
 * cached prefix; only the diff is fresh input. That split is most of the
 * difference between a reviewer that pays for itself and the one that got
 * deleted after four days.
 */
export function anthropicGenerate(model = REVIEW_MODEL): GenerateVerdict {
  return async (prompt): Promise<GenerateResult> => {
    const result = await generateObject({
      model: anthropic(model),
      schema: rawVerdictSchema,
      messages: [
        {
          role: 'system',
          content: prompt.cacheable,
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        },
        { role: 'user', content: prompt.variable },
      ],
    });

    return {
      verdict: result.object,
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
      costCents: costCents(result.usage, PRICING.review),
    };
  };
}

/** The cheap gate. One question, one word back. */
export function anthropicTriage(model = TRIAGE_MODEL): TriageModel {
  return async ({ paths, lines }) => {
    const { text } = await generateText({
      model: anthropic(model),
      system: [
        'You decide whether a set of changed files could plausibly raise a *strategic*',
        'question — product direction, architecture, tenancy, money, data model, or a',
        'documented decision — as opposed to ordinary implementation work.',
        'Answer with exactly one word: YES or NO. When genuinely unsure, answer YES.',
      ].join(' '),
      prompt: `${lines} lines changed across:\n${paths.map((p) => `- ${p}`).join('\n')}`,
    });

    return /yes/i.test(text.trim());
  };
}
