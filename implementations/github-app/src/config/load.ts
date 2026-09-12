import { parse } from 'yaml';
import type { DocSource } from '../github/content';
import { configSchema, CONFIG_PATH, CONFIG_PATH_ALT, type WatchmanConfig } from './schema';

export type ConfigResult =
  | { readonly ok: true; readonly config: WatchmanConfig; readonly path: string }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Read and validate `.watchman.yml`.
 *
 * Every failure here is a refusal, never a default. A repository that has not
 * told the reviewer what to read cannot be reviewed, and guessing is how you
 * end up with confident verdicts backed by nothing.
 */
export async function loadConfig(source: DocSource): Promise<ConfigResult> {
  let path = CONFIG_PATH;
  let raw = await source.read(CONFIG_PATH);

  if (raw === null) {
    raw = await source.read(CONFIG_PATH_ALT);
    path = CONFIG_PATH_ALT;
  }

  if (raw === null) {
    return {
      ok: false,
      problems: [`No \`${CONFIG_PATH}\` found in ${source.describe}.`],
    };
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, problems: [`\`${path}\` is not valid YAML: ${message}`] };
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      problems: result.error.issues.map(
        (issue) => `\`${path}\` → \`${issue.path.join('.') || 'root'}\`: ${issue.message}`,
      ),
    };
  }

  return { ok: true, config: result.data, path };
}
