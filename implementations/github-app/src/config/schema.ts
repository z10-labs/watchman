import { z } from 'zod';

/**
 * `.watchman.yml`, read from the **default branch** — never from the pull
 * request head. A fork PR that edits this file must not be able to point the
 * reviewer at a friendlier rubric, or to skip the paths it is changing.
 */
export const configSchema = z.object({
  version: z.literal(1),

  brain: z.object({
    source: z.enum(['repo']).default('repo'),
    path: z.string().default('docs/'),
    required_reading: z.array(z.string()).min(1),
    decisions: z.string().default('decisions/'),
    /** `{module}` is substituted with the module a PR touches. */
    module_specs: z.string().optional(),
  }),

  rubric: z.string(),

  gate: z
    .object({
      mode: z.enum(['advisory', 'required']).default('advisory'),
      max_diff_lines: z.number().int().positive().default(500),
      skip_paths: z.array(z.string()).default([]),
    })
    .prefault({}),

  budget: z
    .object({
      monthly_usd: z.number().positive().optional(),
      on_exhausted: z.enum(['comment_and_skip', 'review_anyway']).default('comment_and_skip'),
    })
    .prefault({}),
});

export type WatchmanConfig = z.infer<typeof configSchema>;

export const CONFIG_PATH = '.watchman.yml';
export const CONFIG_PATH_ALT = '.watchman.yaml';
