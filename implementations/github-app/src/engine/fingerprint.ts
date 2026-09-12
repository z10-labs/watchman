import { createHash } from 'node:crypto';

const normalise = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * A finding's identity across pushes.
 *
 * Built from what a finding *is about* — its title and where it came from — and
 * deliberately not from its wording, so a model rephrasing the same objection on
 * the next commit does not present it as a new one. This is what lets an
 * unresolved finding carry an age instead of resetting every push.
 */
export function fingerprint(title: string, source: string, module = ''): string {
  return createHash('sha256')
    .update([normalise(title), normalise(source), normalise(module)].join('|'))
    .digest('hex')
    .slice(0, 12);
}
