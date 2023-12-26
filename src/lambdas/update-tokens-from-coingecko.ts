import { captureException } from '@sentry/serverless';
import { wrapHandler } from '@/modules/sentry';
import { updateCoingeckoFullTokenList } from '@/modules/tokens';

import { Network } from '@/constants';


export const handler = wrapHandler(async (): Promise<any> => {
  const log = console.log;
  try {
    await updateCoingeckoFullTokenList(Network);
    return { statusCode: 201, body: '' };
  } catch (e) {
    captureException(e);
    log(`Received error: ${e}`);
    return { statusCode: 500, body: 'Failed to update prices' };
  }
});
