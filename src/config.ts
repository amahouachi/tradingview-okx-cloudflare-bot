import { AllocationConfig } from './types';

export class Config {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  webhookEndpoint: string;
  allocationConfig: AllocationConfig;

  constructor(env: any) {
    this.apiKey = env.OKX_API_KEY;
    this.apiSecret = env.OKX_API_SECRET;
    this.baseUrl = env.OKX_API_URL;
    this.webhookEndpoint = env.WEBHOOK_ENDPOINT;

    try {
      this.allocationConfig = JSON.parse(env.ALLOCATION_CONFIG || '{}');
    } catch (e) {
      console.error('Failed to parse ALLOCATION_CONFIG:', e);
      this.allocationConfig = {};
    }
  }

  validate(): [boolean, string?] {
    if (!this.apiKey) return [false, 'OKX_API_KEY is required'];
    if (!this.apiSecret) return [false, 'OKX_API_SECRET is required'];
    if (!this.baseUrl) return [false, 'OKX_API_URL is required'];
    if (!this.webhookEndpoint) return [false, 'WEBHOOK_ENDPOINT is required'];
    if (Object.keys(this.allocationConfig).length === 0) {
      return [false, 'ALLOCATION_CONFIG cannot be empty'];
    }
    // Note: PASSPHRASE and WEBHOOK_SECRET are validated in index.ts during runtime
    return [true];
  }
}
