import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/types.js';

const night = '2026-10-28';
let runsDir: string | undefined;

function fixture(contents: string): string {
  runsDir = mkdtempSync(join(process.cwd(), '.digest-reader-test-'));
  writeFileSync(join(runsDir, `${night}.jsonl`), contents);
  return runsDir;
}

afterEach(() => {
  if (runsDir) rmSync(runsDir, { recursive: true, force: true });
  runsDir = undefined;
});

describe('night reader', () => {
  it('reads the real night with five sorted jobs and one bad line', () => {
    const digest = readNight('runs', night);
    expect(digest).not.toBeNull();
    expect(digest?.badLines).toBe(1);
    expect(digest?.rows).toEqual([
      {
        job: 'digest/render', owner: null, runs: 1, retries: 0,
        lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
      },
      {
        job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
        lastStatus: 'ok', lastError: 'upstream 503',
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
      },
      {
        job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
        lastStatus: 'ok', lastError: 'lock held',
        firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
      },
      {
        job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
        lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
      },
      {
        job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
        lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
      },
    ]);
  });

  it('counts invalid JSON and invalid records without losing valid runs', () => {
    const run = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: null };
    const contents = [
      JSON.stringify(run), '{broken', 'null', '[]', '42',
      JSON.stringify({ ...run, status: 'unknown' }),
      JSON.stringify({ ...run, at: 'not a timestamp' }),
      JSON.stringify({ ...run, job: '' }),
      JSON.stringify({ ...run, owner: 42 }),
      JSON.stringify({ at: run.at, job: run.job, status: run.status }),
      JSON.stringify({ ...run, error: null }),
      JSON.stringify({ ...run, status: 'fail', error: 'failed' }),
    ].join('\n');
    expect(readNight(fixture(contents), night)).toEqual({
      badLines: 10,
      rows: [{
        job: 'job', owner: null, runs: 2, retries: 0,
        lastStatus: 'fail', lastError: 'failed', firstAt: run.at, lastAt: run.at,
      }],
    });
  });

  it('uses log order, keeps offsets, and updates the owner and latest supplied error', () => {
    const lines = [
      { at: '2026-10-29T02:30:00+02:00', job: 'job', status: 'retry', owner: 'rook', error: 'first' },
      { at: '2026-10-29T02:00:00+01:00', job: 'job', status: 'fail', owner: 'rook', error: 'last' },
      { at: '2026-10-28T23:00:00-04:00', job: 'job', status: 'ok', owner: null },
    ];
    expect(readNight(fixture(lines.map((line) => JSON.stringify(line)).join('\r\n')), night)).toEqual({
      badLines: 0,
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1,
        lastStatus: 'ok', lastError: 'last',
        firstAt: lines[0].at, lastAt: lines[2].at,
      }],
    });
  });

  it.each(['', '\n \r\n\t\n'])('returns an empty digest for empty or blank input', (contents) => {
    expect(readNight(fixture(contents), night)).toEqual({ rows: [], badLines: 0 });
  });

  it('returns null for a missing night or an invalid night name', () => {
    const dir = fixture('');
    expect(readNight(dir, '2026-10-27')).toBeNull();
    expect(readNight(dir, '../2026-10-28')).toBeNull();
  });

  it('does not disguise other file errors as missing nights', () => {
    const dir = fixture('');
    rmSync(join(dir, `${night}.jsonl`));
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
