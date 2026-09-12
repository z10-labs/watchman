import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { GitHubApi } from './api';
import type { DocSource } from './content';

/**
 * Documents as of the default branch.
 *
 * The ref matters: reading config and rubric from the pull request head would
 * let a fork edit the standard it is about to be judged against.
 */
export function githubDocSource(api: GitHubApi, ref: string): DocSource {
  return {
    describe: `${api.owner}/${api.repo}@${ref}`,
    read: (path) => api.getFile(path, ref),
    list: (dir) => api.listDir(dir, ref),
  };
}

/**
 * The same documents, off the local disk.
 *
 * `watchman doctor` runs the production preflight against a working copy, so a
 * developer finds a broken rubric before a pull request does.
 */
export function fileDocSource(root: string): DocSource {
  const rootPath = resolve(root);

  // Never read outside the repository, whatever the config says.
  const within = (path: string): string | null => {
    const full = resolve(rootPath, path);
    return full === rootPath || full.startsWith(`${rootPath}/`) ? full : null;
  };

  return {
    describe: rootPath,

    async read(path) {
      const full = within(path);
      if (!full) return null;
      try {
        return await readFile(full, 'utf8');
      } catch {
        return null;
      }
    },

    async list(dir) {
      const full = within(dir);
      if (!full) return [];
      try {
        const entries = await readdir(full, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile())
          .map((entry) => relative(rootPath, join(full, entry.name)));
      } catch {
        return [];
      }
    },
  };
}
