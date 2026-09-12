/**
 * The spine's memory.
 *
 * M0 needs exactly one durable fact — which comment is ours on which PR — and
 * the sticky upsert already survives without it by scanning. So the store is an
 * optimisation with a correct fallback, not a dependency. The Neon-backed
 * implementation lands in M1 alongside the findings tables; see db/schema.sql.
 */
export interface Store {
  getStickyCommentId(prKey: string): Promise<number | null>;
  setStickyCommentId(prKey: string, commentId: number): Promise<void>;
  getCheckRunId(prKey: string, headSha: string): Promise<number | null>;
  setCheckRunId(prKey: string, headSha: string, checkRunId: number): Promise<void>;
}

export function createMemoryStore(): Store {
  const comments = new Map<string, number>();
  const checks = new Map<string, number>();
  const checkKey = (prKey: string, headSha: string) => `${prKey}@${headSha}`;

  return {
    async getStickyCommentId(prKey) {
      return comments.get(prKey) ?? null;
    },
    async setStickyCommentId(prKey, commentId) {
      comments.set(prKey, commentId);
    },
    async getCheckRunId(prKey, headSha) {
      return checks.get(checkKey(prKey, headSha)) ?? null;
    },
    async setCheckRunId(prKey, headSha, checkRunId) {
      checks.set(checkKey(prKey, headSha), checkRunId);
    },
  };
}
