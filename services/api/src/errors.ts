import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { UnknownSourceError } from '@biyahey/shared/provenance';

/** Response body for every API error (Task 4 interface). */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Thrown when a request body does not match the route's schema. */
export class InvalidBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBodyError';
  }
}

/** Thrown when `mode` is not a fare mode the engine can price. */
export class InvalidModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidModeError';
  }
}

/** Thrown when the routing service cannot be reached or times out. */
export class RouterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouterUnavailableError';
  }
}

/**
 * Thrown when MOTIS answered but rejected the request.
 *
 * The BFF still reports 502: the client's body was valid for our API, so the
 * failure is on the routing side, and the upstream status/detail is included in
 * the message for operators.
 */
export class RouterResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'RouterResponseError';
    this.status = status;
  }
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
): void {
  const body: ApiErrorBody = { error: { code, message } };
  void reply.status(statusCode).send(body);
}

/**
 * Central error mapping (Task 4 interface): an unregistered source id is 422,
 * an unknown fare mode or a malformed body is 400, and anything else becomes an
 * opaque 500 so internals never leak to the PWA.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof UnknownSourceError) {
      return sendError(reply, 422, 'UNKNOWN_SOURCE', error.message);
    }
    if (error instanceof InvalidModeError) {
      return sendError(reply, 400, 'INVALID_MODE', error.message);
    }
    if (error instanceof InvalidBodyError) {
      return sendError(reply, 400, 'INVALID_BODY', error.message);
    }
    if (error instanceof RouterUnavailableError) {
      return sendError(reply, 502, 'ROUTER_UNAVAILABLE', error.message);
    }
    if (error instanceof RouterResponseError) {
      return sendError(reply, 502, 'ROUTER_ERROR', error.message);
    }
    // Fastify's own JSON-schema failures and body-parser failures (400).
    if (error.validation !== undefined || error.statusCode === 400) {
      return sendError(reply, 400, 'INVALID_BODY', 'Invalid request body');
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return sendError(reply, error.statusCode, 'INVALID_REQUEST', error.message);
    }
    request.log.error({ err: error }, 'unhandled request error');
    return sendError(reply, 500, 'INTERNAL_ERROR', 'Unexpected server error');
  });
}
