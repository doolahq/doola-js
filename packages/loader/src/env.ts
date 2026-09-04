/**
 * The publishable key prefix selects the environment. Test and live are
 * separate deployments with separate data, so resolving hosts from the
 * key — never from a build-time constant — is what makes the same loader
 * bundle work against both stacks.
 */
export interface Env {
  name: 'live' | 'test';
  sdkOrigin: string;
  keyPrefix: string;
}

const ENVS: Env[] = [
  { name: 'live', keyPrefix: 'pk_live_', sdkOrigin: 'https://sdk.doola.com' },
  { name: 'test', keyPrefix: 'pk_test_', sdkOrigin: 'https://sdk.test.doola.com' },
];

export function envFromPublishableKey(publishableKey: string): Env {
  const env = ENVS.find((e) => publishableKey.startsWith(e.keyPrefix));

  if (!env) {
    throw new Error(
      'Invalid publishableKey: expected a key starting with pk_live_ or pk_test_. ' +
        'Get yours from the doola partner portal. Never use your secret dk_ key in a browser.',
    );
  }

  return env;
}
