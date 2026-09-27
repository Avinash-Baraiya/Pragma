import { describe, expect, it } from 'vitest';
import {
  createIssue,
  isAbortError,
  isPragmaError,
  PragmaConfigError,
  PragmaError,
  PragmaModelError,
  PragmaTimeoutError,
  PragmaTransportError,
  PragmaValidationError,
  toIssue,
} from './errors.js';

describe('error model', () => {
  it('derives retryable from the code by default', () => {
    expect(createIssue('MODEL_ERROR', { message: 'x', messageKey: 'k' }).retryable).toBe(true);
    expect(createIssue('UNKNOWN_FIELD', { message: 'x', messageKey: 'k' }).retryable).toBe(false);
    expect(createIssue('UNKNOWN_FIELD', { message: 'x', messageKey: 'k', retryable: true }).retryable).toBe(true);
  });

  it('omits undefined optional properties', () => {
    const issue = createIssue('PARSE_ERROR', { message: 'm', messageKey: 'k' });
    expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'messageKey', 'retryable']);
  });

  it('brands errors so isPragmaError works across realms', () => {
    const err = new PragmaConfigError('CONFIG_ERROR', 'bad');
    expect(isPragmaError(err)).toBe(true);
    expect(err).toBeInstanceOf(PragmaError);
    expect(isPragmaError(new Error('x'))).toBe(false);
    expect(isPragmaError(null)).toBe(false);
  });

  it('serializes without stack or cause', () => {
    const err = new PragmaModelError('MODEL_ERROR', 'upstream failed', { cause: new Error('secret key abc'), status: 502 });
    const json = JSON.stringify(err);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('stack');
    expect(err.status).toBe(502);
    expect(err.retryable).toBe(true);
  });

  it('toIssue returns the single wrapped issue unchanged', () => {
    const issue = createIssue('UNKNOWN_FIELD', { message: 'Unknown field "x".', messageKey: 'field.unknown' });
    const err = new PragmaValidationError('invalid', [issue]);
    expect(err.code).toBe('UNKNOWN_FIELD');
    expect(err.toIssue()).toBe(issue);
  });

  it('toIssue summarizes multiple issues in details', () => {
    const a = createIssue('UNKNOWN_FIELD', { message: 'a', messageKey: 'k' });
    const b = createIssue('INVALID_VALUE', { message: 'b', messageKey: 'k' });
    const issue = new PragmaValidationError('invalid', [a, b]).toIssue();
    expect(issue.details).toEqual({ issues: [a, b] });
  });

  it('never leaks messages of unknown errors', () => {
    const issue = toIssue(new Error('database password is hunter2'));
    expect(issue.code).toBe('INTERNAL_ERROR');
    expect(issue.message).not.toContain('hunter2');
  });

  it('maps abort errors to ABORTED', () => {
    const abort = new DOMException('stop', 'AbortError');
    expect(isAbortError(abort)).toBe(true);
    expect(toIssue(abort).code).toBe('ABORTED');
    expect(isAbortError(new DOMException('t', 'TimeoutError'))).toBe(true);
    expect(isAbortError('AbortError')).toBe(false);
  });

  it('distinguishes timeout from abort', () => {
    expect(new PragmaTimeoutError('slow').code).toBe('TIMEOUT');
    expect(new PragmaTimeoutError('slow').retryable).toBe(true);
    expect(new PragmaTimeoutError('cancel', { aborted: true }).code).toBe('ABORTED');
    expect(new PragmaTimeoutError('cancel', { aborted: true }).retryable).toBe(false);
  });

  it('transport errors default to TRANSPORT_ERROR and keep status', () => {
    const err = new PragmaTransportError('bad gateway', { status: 502 });
    expect(err.code).toBe('TRANSPORT_ERROR');
    expect(err.status).toBe(502);
    expect(new PragmaTransportError('x', { code: 'RATE_LIMITED' }).code).toBe('RATE_LIMITED');
  });
});
