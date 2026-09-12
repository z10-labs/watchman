/**
 * Where the reviewer's source of truth comes from.
 *
 * Two implementations, one interface: the app reads documents out of GitHub at
 * a fixed ref, and `watchman doctor` reads the same documents off the local
 * filesystem. Preflight cannot tell the difference, which is the point — the
 * check a developer runs locally is the check that runs in production.
 */
export interface DocSource {
  /** A short description for the receipt: where these documents came from. */
  readonly describe: string;
  /** null when the path does not exist. */
  read(path: string): Promise<string | null>;
  /** Repo-relative paths inside a directory; empty when it does not exist. */
  list(dir: string): Promise<string[]>;
}

/** Join without doubling or dropping separators, and without leading `./`. */
export function joinPath(...parts: (string | undefined)[]): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .map((part) => part.replace(/^\.\//, '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}
