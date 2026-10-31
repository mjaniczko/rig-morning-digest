import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type Run = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return typeof run.at === 'string'
    && Number.isFinite(Date.parse(run.at))
    && typeof run.job === 'string'
    && run.job.length > 0
    && (run.status === 'ok' || run.status === 'retry' || run.status === 'fail')
    && (run.owner === null || typeof run.owner === 'string')
    && (run.error === undefined || typeof run.error === 'string');
}

/**
 * Log order defines first/last runs. Keep original timestamps and the most recent
 * supplied error, even when a later run succeeds. Blank lines are ignored.
 * Missing files (or invalid night names) return null; other I/O errors propagate.
 */
export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const rows = new Map<string, DigestRow>();
  let badLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let run: unknown;
    try {
      run = JSON.parse(line);
    } catch {
      badLines += 1;
      continue;
    }
    if (!isRun(run)) {
      badLines += 1;
      continue;
    }

    const row = rows.get(run.job);
    if (row) {
      row.owner = run.owner;
      row.runs += 1;
      row.retries += run.status === 'retry' ? 1 : 0;
      row.lastStatus = run.status;
      if (run.error !== undefined) row.lastError = run.error;
      row.lastAt = run.at;
    } else {
      rows.set(run.job, {
        job: run.job,
        owner: run.owner,
        runs: 1,
        retries: run.status === 'retry' ? 1 : 0,
        lastStatus: run.status,
        lastError: run.error ?? null,
        firstAt: run.at,
        lastAt: run.at,
      });
    }
  }

  return {
    rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0),
    badLines,
  };
};
