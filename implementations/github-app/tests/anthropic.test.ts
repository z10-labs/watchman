/**
 * The shape of the request the model binding sends.
 *
 * The first live CI run failed with "System messages are not allowed in the
 * prompt or messages fields. Use the instructions option instead." — an ai v7
 * rule no offline test had exercised. This pins the request shape so the
 * binding cannot drift back, without a network or a key.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const generateObject = vi.fn();
const generateText = vi.fn();

vi.mock('ai', () => ({ generateObject, generateText }));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ modelId: id }) }));

const { anthropicGenerate, anthropicTriage, PRICING } = await import('../src/engine/anthropic');

beforeEach(() => {
  generateObject.mockReset();
  generateText.mockReset();
});

describe('anthropicGenerate', () => {
  test('sends the cacheable prefix as instructions, never as a system message', async () => {
    generateObject.mockResolvedValue({
      object: { findings: [], bottom_line: 'ship it' },
      usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
    });

    await anthropicGenerate()({ cacheable: 'RUBRIC', variable: 'DIFF' });

    const call = generateObject.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.instructions).toMatchObject({
      role: 'system',
      content: 'RUBRIC',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });
    expect(call.messages).toEqual([{ role: 'user', content: 'DIFF' }]);
    expect(call).not.toHaveProperty('system');
  });

  test('prices the call from usage with the pinned review rates', async () => {
    generateObject.mockResolvedValue({
      object: { findings: [], bottom_line: 'ship it' },
      usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
    });

    const result = await anthropicGenerate()({ cacheable: 'R', variable: 'D' });

    expect(result.costCents).toBe(PRICING.review.inputCentsPerM + PRICING.review.outputCentsPerM / 10);
    expect(result.verdict.bottom_line).toBe('ship it');
  });
});

describe('anthropicTriage', () => {
  test('asks the one question through instructions and reads YES/NO', async () => {
    generateText.mockResolvedValue({ text: ' YES\n' });

    const moved = await anthropicTriage()({ paths: ['src/auth/session.ts'], lines: 12 });

    expect(moved).toBe(true);
    const call = generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof call.instructions).toBe('string');
    expect(call).not.toHaveProperty('system');
    expect(call.prompt).toContain('src/auth/session.ts');
  });

  test('anything but YES is NO', async () => {
    generateText.mockResolvedValue({ text: 'No.' });

    expect(await anthropicTriage()({ paths: ['README.md'], lines: 3 })).toBe(false);
  });
});
