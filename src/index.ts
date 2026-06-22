import { processSignal } from './processor';
import { handleCron } from './cron';
import { Config } from './config';
import { Env } from './db';

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const url = new URL(request.url);
    const config = new Config(env);

    if (url.pathname !== config.webhookEndpoint) return new Response('Not found', { status: 404 });

    const token = url.searchParams.get('token');
    const webhookSecret = env.WEBHOOK_SECRET;
    if (!webhookSecret || token !== webhookSecret) {
      console.error('Webhook authentication failed');
      return new Response('Unauthorized', { status: 401 });
    }

    const [isValidConfig, configError] = config.validate();
    if (!isValidConfig) {
      console.error(`Configuration error: ${configError}`);
      return new Response('Internal server error', { status: 500 });
    }

    let signal: any;
    try {
      signal = await request.json();
    } catch (e) {
      console.error('Failed to parse request body:', e);
      return new Response('OK', { status: 200 });
    }

    // Minimal validation
    if (!signal || !signal.action || !signal.symbol) {
      console.error('Invalid signal');
      return new Response('OK', { status: 200 });
    }

    ctx.waitUntil((async () => {
      try {
        const res = await processSignal(env, signal, config.allocationConfig);
        if (!res || (res as any).success === false) {
          console.error('Signal processing failed', res);
        }
      } catch (e) {
        console.error('Error processing signal', e);
      }
    })());

    return new Response('OK', { status: 200 });
  },

  async scheduled(event: ExecutionContext, env: Env, ctx: ExecutionContext) {
    try {
      await handleCron(env);
    } catch (e) {
      console.error('scheduled error', e);
    }
  }
};
