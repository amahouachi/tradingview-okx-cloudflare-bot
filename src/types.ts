export type Signal = {
  action: 'buy' | 'sell' | 'cancel';
  symbol: string;
  price?: number;
  size?: number;
};

export type AllocationConfig = {
  [symbol: string]: number; // percentage allocation
};

export type ExecutionResult = {
  success: boolean;
  symbol: string;
  action: string;
  error?: string;
};
