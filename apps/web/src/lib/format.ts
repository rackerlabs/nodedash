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

/**
 * Accepts either an epoch millisecond value or an ISO timestamp, because callers
 * have one or the other and every one of them was writing the same
 * `new Date(x).getTime()` dance.
 */
export type TimeInput = number | string | null | undefined;

function toEpochMs(value: TimeInput): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Compact relative time ("12s ago", "4m ago") for freshness indicators. */
export function relativeTime(value: TimeInput, now = Date.now()): string {
  const from = toEpochMs(value);
  if (from === null) return 'never';
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Forward-looking counterpart to relativeTime, for deadlines rather than freshness.
 * relativeTime clamps to the past, so a future timestamp there reads "just now".
 */
export function timeUntil(value: TimeInput, now = Date.now()): string {
  const target = toEpochMs(value);
  if (target === null) return 'never';
  const seconds = Math.round((target - now) / 1000);
  if (seconds <= 0) return relativeTime(target, now);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}
