import { ApiError } from './apiClient';

export interface ApiIssue {
  path: string;
  message: string;
}

/**
 * Extracts field-level issues from a 422 error envelope so forms can attach a server refusal
 * to the field it names instead of showing a generic toast. Returns an empty array when the
 * error carries no usable issues, letting the caller fall back to the error's message.
 */
export function apiIssues(error: unknown): ApiIssue[] {
  if (!(error instanceof ApiError)) {
    return [];
  }

  const details = error.details;
  if (typeof details !== 'object' || details === null) {
    return [];
  }

  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return [];
  }

  const result: ApiIssue[] = [];
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) {
      continue;
    }

    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (typeof path === 'string' && typeof message === 'string') {
      result.push({ path, message });
    }
  }

  return result;
}
