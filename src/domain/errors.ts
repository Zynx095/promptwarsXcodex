export type DomainErrorCode =
  | 'ALREADY_ON_SHIFT'
  | 'NOT_ON_SHIFT'
  | 'INVALID_SHIFT_TIMES'
  | 'SHIFT_TOO_LONG'
  | 'OVERLAPPING_SHIFT'
  | 'INVALID_PAY_INPUT'
  | 'INVALID_TRANSITION'
  | 'INVALID_CATEGORY'
  | 'NOTE_REQUIRED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_SITE_CODE'
  | 'SITE_CODE_REQUIRED';

/** A business-rule violation with a stable code and a user-safe message. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
