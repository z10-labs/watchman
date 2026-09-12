import { createEngine, type GenerateResult } from '../../src/engine/index';
import type { EnginePrompt } from '../../src/engine/prompt';
import type { RawVerdict } from '../../src/engine/schema';
import type { ReviewDeps } from '../../src/jobs/review';
import { createMemoryStore } from '../../src/store/index';
import type { FakeGitHub } from './github';

export const AT = new Date('2026-09-03T14:06:00Z');

export const cleanVerdict: RawVerdict = {
  findings: [],
  bottom_line: 'Ship it.',
};

export const blockingVerdict: RawVerdict = {
  findings: [
    {
      severity: 'block',
      title: 'Tenant row read on the RLS-bypass handle',
      body: 'getTenantPlan() resolves through the service-role client, so isolation does not apply.',
      suggested_action: 'fix in this PR',
      source: 'DEC-001, src/billing/plan.ts:42',
      module: 'billing',
    },
    {
      severity: 'warn',
      title: 'Unlogged Category B choice — pagination scheme',
      body: 'Cursor pagination diverges from every other collection surface.',
      suggested_action: 'log a decision file',
      source: 'architecture/overview.md',
      module: 'billing',
    },
  ],
  bottom_line: 'Not until the tenant read moves back onto the request-scoped client.',
};

/** Records what the engine was asked, so prompt construction is testable. */
export interface SpyEngine {
  readonly prompts: EnginePrompt[];
  calls: number;
}

export function fakeGenerate(verdict: RawVerdict, spy?: SpyEngine, costCents = 11) {
  return async (prompt: EnginePrompt): Promise<GenerateResult> => {
    if (spy) {
      spy.prompts.push(prompt);
      spy.calls += 1;
    }
    return { verdict, costCents };
  };
}

export function testDeps(
  api: FakeGitHub,
  options: { verdict?: RawVerdict; spy?: SpyEngine; costCents?: number } = {},
): ReviewDeps {
  return {
    store: createMemoryStore(),
    gateMode: 'advisory',
    appId: 42,
    apiFor: async () => api,
    now: () => AT,
    perform: {
      engine: createEngine(
        fakeGenerate(options.verdict ?? cleanVerdict, options.spy, options.costCents ?? 11),
      ),
      fallbackGateMode: 'advisory',
    },
  };
}
