import { loadEnv, type Env } from './env';
import { anthropicGenerate, anthropicTriage } from './engine/anthropic';
import { createEngine } from './engine/index';
import { createApp, installationApi } from './github/octokit-api';
import type { ReviewDeps } from './jobs/review';
import { createMemoryStore, type Store } from './store/index';

let cachedEnv: Env | null = null;
let cachedApp: ReturnType<typeof createApp> | null = null;

/**
 * Process-local, and that is a known limit.
 *
 * The store only caches ids that the sticky upsert can rediscover by scanning,
 * so a cold start costs one extra list call and nothing else. Review history
 * lives in the comment body, which is why there is no database here.
 */
const store: Store = createMemoryStore();

export function env(): Env {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export function deps(): ReviewDeps {
  const current = env();
  cachedApp ??= createApp(current.GITHUB_APP_ID, current.GITHUB_APP_PRIVATE_KEY);
  const app = cachedApp;

  return {
    store,
    gateMode: current.WATCHMAN_GATE_MODE,
    appId: current.appIdNumber,
    apiFor: (event) => {
      // The webhook router always requires an installation; this guards the type,
      // not a path a delivery can reach.
      if (event.installationId === null) {
        throw new Error(`watchman: ${event.prKey} was routed without an installation`);
      }
      return installationApi(app, event.installationId, event.owner, event.repo);
    },
    now: () => new Date(),
    perform: {
      engine: createEngine(anthropicGenerate()),
      triageModel: anthropicTriage(),
      fallbackGateMode: current.WATCHMAN_GATE_MODE,
    },
  };
}
