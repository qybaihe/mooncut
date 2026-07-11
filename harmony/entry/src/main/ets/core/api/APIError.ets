export class APIError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number = 0, code: string = 'NETWORK_ERROR') {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.code = code;
  }

  get unauthorized(): boolean { return this.code === 'AUTH_REQUIRED'; }
  get retryable(): boolean { return this.status === 0 || this.status === 429 || this.status >= 500; }
}
