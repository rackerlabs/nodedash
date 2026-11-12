/*
Copyright 2026 Rackspace Technology.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { ApiErrorSchema, type ApiErrorCode } from '@nodedash/shared';
import type { z } from 'zod';
import { API_BASE } from '@/lib/env';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network_error' | 'invalid_response',
    message: string,
    readonly detail?: string | null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** The BFF sets a readable CSRF cookie; mutations must echo it back in a header. */
function csrfToken(): string | null {
  const match = /(?:^|;\s*)csrf_token=([^;]+)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function request<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, schema, signal, query } = options;
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiRequestError(0, 'network_error', 'Could not reach the API.', String(cause));
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeJson(text) : null;

  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiRequestError(
        response.status,
        parsed.data.error.code as ApiErrorCode,
        parsed.data.error.message,
        parsed.data.error.detail ?? null,
      );
    }
    throw new ApiRequestError(
      response.status,
      'upstream_error',
      `Request failed with status ${response.status}.`,
      text.slice(0, 500) || null,
    );
  }

  if (!schema) return payload as T;

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // A shape mismatch is a bug or an unexpected API version, not a user error;
    // surface it loudly rather than rendering blanks.
    throw new ApiRequestError(
      response.status,
      'invalid_response',
      'The API returned data this UI does not understand.',
      parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    );
  }
  return parsed.data;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'unauthenticated';
}
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'not_found';
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.detail ? `${error.message} (${error.detail})` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
