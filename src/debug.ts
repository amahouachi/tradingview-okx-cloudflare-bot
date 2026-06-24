export function debug(env: any, message: string, data?: any): void {
  if (env.DEBUG === 'true' || env.DEBUG === '1') {
    if (data !== undefined) {
      console.info(`[DEBUG] ${message}`, data);
    } else {
      console.info(`[DEBUG] ${message}`);
    }
  }
}
