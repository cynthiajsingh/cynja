// Application errors carry an HTTP status and a message that is safe to show the user.
// (Plain fields instead of constructor parameter properties so the CLI scripts can
// run this file with Node's built-in type stripping.)

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>, message = 'Please fix the highlighted fields.') {
    super(422, message, 'validation_failed');
    this.fields = fields;
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Resource') {
    super(404, `${what} not found.`, 'not_found');
  }
}

export class ConflictError extends AppError {
  readonly details: Record<string, unknown>;
  constructor(message: string, code = 'conflict', details: Record<string, unknown> = {}) {
    super(409, message, code);
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Please sign in.') {
    super(401, message, 'unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'This request was blocked.') {
    super(403, message, 'forbidden');
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(429, `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`, 'rate_limited');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
