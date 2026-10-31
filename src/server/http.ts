// HTTP error types, input parsing and the central error handler.
import type { ErrorRequestHandler, Request } from 'express';
import type { z } from 'zod';
import { DomainError, type DomainErrorCode } from '../domain/errors';
import type { ApiErrorBody } from '../shared/types';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Record') => new HttpError(404, 'NOT_FOUND', `${what} not found.`);

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new HttpError(400, 'VALIDATION_ERROR', 'Some fields need attention.', fields);
  }
  return result.data;
}

export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) throw notFound();
  return v;
}

const DOMAIN_STATUS: Partial<Record<DomainErrorCode, number>> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  ALREADY_ON_SHIFT: 409,
  NOT_ON_SHIFT: 409,
  INVALID_TRANSITION: 409,
  OVERLAPPING_SHIFT: 409,
  CONFLICT: 409,
  PASSKEY_REQUIRED: 403,
  PASSKEY_FAILED: 403,
  QR_ALREADY_USED: 409,
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } };
  } else if (err instanceof DomainError) {
    status = DOMAIN_STATUS[err.code] ?? 422;
    body = { error: { code: err.code, message: err.message } };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    body = { error: { code: 'TOO_LARGE', message: 'Request body is too large.' } };
  } else {
    // Log the failure without request bodies, which may contain pay or feedback data.
    console.error(`[fairshift] ${req.method} ${req.path} failed:`, err instanceof Error ? err.stack : err);
  }
  res.status(status).json(body);
};
