export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function corsHeaders(request: Request): Record<string, string> {
  const configuredOrigin = Deno.env.get('ALLOWED_ORIGIN')?.trim();
  const requestOrigin = request.headers.get('origin') || '';
  const allowOrigin = configuredOrigin && requestOrigin === configuredOrigin ? configuredOrigin : configuredOrigin ? configuredOrigin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-profile-token, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(request, { error: error.message, code: error.code }, error.status);
  }
  console.error(error);
  return jsonResponse(request, { error: 'The request could not be completed.', code: 'INTERNAL_ERROR' }, 500);
}
