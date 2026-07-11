export class AppError extends Error {
  constructor(message, { statusCode = 500, code = "INTERNAL_ERROR", details } = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
export class ProviderError extends AppError {
  constructor(message, details) {
    super(message, { statusCode: 502, code: "PROVIDER_ERROR", details });
    this.name = "ProviderError";
  }
}
