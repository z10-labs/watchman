import { z } from 'zod';

const gateMode = z.enum(['advisory', 'required']).default('advisory');

const schema = z.object({
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  WATCHMAN_GATE_MODE: gateMode,
});

export type Env = z.infer<typeof schema> & { readonly appIdNumber: number };

type Source = Readonly<Record<string, string | undefined>>;

function parseOrThrow<T extends z.ZodTypeAny>(shape: T, source: Source, hint: string): z.infer<T> {
  const parsed = shape.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`watchman: invalid environment (${missing}). ${hint}`);
  }
  return parsed.data;
}

/**
 * Fail at startup, not on the first delivery.
 *
 * A webhook that 500s because a secret is missing looks, from GitHub's side,
 * exactly like a service that is down — and from ours, like nothing at all.
 */
export function loadEnv(source: Source = process.env): Env {
  const parsed = parseOrThrow(schema, source, 'See .env.example.');

  return {
    ...parsed,
    // Vercel and GitHub disagree about newlines in PEM bodies; normalise both forms.
    GITHUB_APP_PRIVATE_KEY: parsed.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    appIdNumber: Number(parsed.GITHUB_APP_ID),
  };
}

/**
 * What a GitHub Actions run gives us, validated.
 *
 * The first five are set by the runner; `WATCHMAN_GATE_MODE` is the only knob.
 * `ANTHROPIC_API_KEY` is deliberately optional: a docs-only push costs no model
 * call and must still succeed, and a review that does need the model fails
 * loudly on the pull request rather than here.
 */
const actionsSchema = z.object({
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_EVENT_PATH: z.string().min(1),
  GITHUB_EVENT_NAME: z.string().min(1),
  GITHUB_REPOSITORY: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected owner/repo'),
  GITHUB_API_URL: z.string().url().optional(),
  GITHUB_STEP_SUMMARY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  WATCHMAN_GATE_MODE: gateMode,
});

export type ActionsEnv = z.infer<typeof actionsSchema>;

export function loadActionsEnv(source: Source = process.env): ActionsEnv {
  return parseOrThrow(
    actionsSchema,
    source,
    'This entrypoint runs inside GitHub Actions; see .github/workflows/watchman.yml.',
  );
}
