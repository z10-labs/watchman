import type { NextConfig } from 'next';

const config: NextConfig = {
  // The review runs on the queue, not in the request — nothing here should need
  // a long function timeout. If that stops being true, the job boundary moved.
  serverExternalPackages: ['octokit'],
};

export default config;
