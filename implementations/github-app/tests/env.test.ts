import { describe, expect, test } from 'vitest';
import { loadActionsEnv, loadEnv } from '../src/env';

const valid = {
  GITHUB_APP_ID: '123456',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nkey\n-----END RSA PRIVATE KEY-----',
  GITHUB_WEBHOOK_SECRET: 'shh',
};

describe('loadEnv', () => {
  test('reads a complete environment', () => {
    const env = loadEnv({ ...valid });

    expect(env.appIdNumber).toBe(123456);
    expect(env.GITHUB_WEBHOOK_SECRET).toBe('shh');
  });

  test('defaults the gate to advisory — a reviewer nobody trusts yet cannot block', () => {
    expect(loadEnv({ ...valid }).WATCHMAN_GATE_MODE).toBe('advisory');
  });

  test('accepts an explicit required gate', () => {
    expect(loadEnv({ ...valid, WATCHMAN_GATE_MODE: 'required' }).WATCHMAN_GATE_MODE).toBe(
      'required',
    );
  });

  test('normalises an escaped-newline private key', () => {
    const env = loadEnv({
      ...valid,
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\\nkey\\n-----END RSA PRIVATE KEY-----',
    });

    expect(env.GITHUB_APP_PRIVATE_KEY).toContain('\n');
    expect(env.GITHUB_APP_PRIVATE_KEY).not.toContain('\\n');
  });

  test.each(['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET'])(
    'refuses to start without %s',
    (key) => {
      const incomplete = { ...valid, [key]: undefined };

      expect(() => loadEnv(incomplete)).toThrow(key);
    },
  );

  test('rejects an unknown gate mode rather than guessing', () => {
    expect(() => loadEnv({ ...valid, WATCHMAN_GATE_MODE: 'blocking' })).toThrow(
      'WATCHMAN_GATE_MODE',
    );
  });
});

describe('loadActionsEnv', () => {
  const runner = {
    GITHUB_TOKEN: 'ghs_x',
    GITHUB_EVENT_PATH: '/tmp/event.json',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REPOSITORY: 'z10labs/tutorx',
  };

  test('reads what the Actions runner sets and defaults the gate to advisory', () => {
    const env = loadActionsEnv({ ...runner });

    expect(env.GITHUB_REPOSITORY).toBe('z10labs/tutorx');
    expect(env.WATCHMAN_GATE_MODE).toBe('advisory');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test.each(['GITHUB_TOKEN', 'GITHUB_EVENT_PATH', 'GITHUB_EVENT_NAME', 'GITHUB_REPOSITORY'])(
    'refuses to start without %s',
    (key) => {
      expect(() => loadActionsEnv({ ...runner, [key]: undefined })).toThrow(key);
    },
  );

  test('insists the repository is owner/repo', () => {
    expect(() => loadActionsEnv({ ...runner, GITHUB_REPOSITORY: 'tutorx' })).toThrow(
      'GITHUB_REPOSITORY',
    );
  });

  test('rejects an unknown gate mode rather than guessing', () => {
    expect(() => loadActionsEnv({ ...runner, WATCHMAN_GATE_MODE: 'blocking' })).toThrow(
      'WATCHMAN_GATE_MODE',
    );
  });

  test('points at the workflow when the environment is not an Actions run', () => {
    expect(() => loadActionsEnv({})).toThrow('watchman.yml');
  });
});
