import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

let fixtureDir: string | undefined;

afterEach(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  fixtureDir = undefined;
});

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> (ok 4 · retry 0 · fail 1)');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> (ok 4 · retry 0 · fail 0)');

    for (const night of ['2026-10-28', '2026-10-27']) {
      const digest = await createApp(config).request(`/digest/${night}`);
      expect(digest.status).toBe(200);
    }
  });

  it('counts jobs by their last status from the night reader', async () => {
    fixtureDir = mkdtempSync(join(process.cwd(), '.status-board-test-'));
    writeFileSync(join(fixtureDir, '2026-10-30.jsonl'), [
      { at: '2026-10-30T01:00:00Z', job: 'recovered', status: 'retry', owner: 'rook' },
      { at: '2026-10-30T01:01:00Z', job: 'recovered', status: 'ok', owner: 'rook' },
      { at: '2026-10-30T01:02:00Z', job: 'waiting', status: 'retry', owner: 'rook' },
      { at: '2026-10-30T01:03:00Z', job: 'broken', status: 'fail', owner: 'rook' },
    ].map((run) => JSON.stringify(run)).join('\n'));

    const res = await createApp({ ...config, runsDir: fixtureDir }).request('/');
    const html = await res.text();

    expect(html).toContain('<a href="/digest/2026-10-30">2026-10-30</a> (ok 1 · retry 1 · fail 1)');
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
