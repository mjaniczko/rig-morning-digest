import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'runs',
};

let fixtureDir: string | undefined;

function fixture(contents: string): string {
  fixtureDir = mkdtempSync(join(process.cwd(), '.digest-route-test-'));
  writeFileSync(join(fixtureDir, '2026-10-28.jsonl'), contents);
  return fixtureDir;
}

afterEach(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  fixtureDir = undefined;
});

describe('digest page', () => {
  it('renders the night in the shared layout with rows sorted and warnings marked', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<title>rig · digest · 2026-10-28</title>');
    expect(html).toContain('lane-07');
    expect(html.indexOf('digest/render')).toBeLessThan(html.indexOf('fixtures/refresh'));
    expect(html.indexOf('fixtures/refresh')).toBeLessThan(html.indexOf('lane/sync'));
    expect(html).toMatch(/<tr class="warn"><td>fixtures\/refresh<\/td>/);
    expect(html).toMatch(/<tr class="warn"><td>notes\/backup<\/td>/);
    expect(html).toContain('upstream 503');
    expect(html).toContain('quota exceeded');
    expect(html).not.toContain('<script');
  });

  it('renders exactly “nothing ran” for an empty night', async () => {
    const app = createApp({ ...config, runsDir: fixture('') });
    const res = await app.request('/digest/2026-10-28');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<p>nothing ran</p>');
    expect(html).not.toContain('<table>');
  });

  it('returns 404 when the night file is missing', async () => {
    const runsDir = mkdtempSync(join(process.cwd(), '.digest-route-test-'));
    fixtureDir = runsDir;
    const res = await createApp({ ...config, runsDir }).request('/digest/2026-10-28');

    expect(res.status).toBe(404);
  });
});

describe('digest api', () => {
  it('returns the same ordered jobs as the page', async () => {
    const app = createApp(config);
    const html = await (await app.request('/digest/2026-10-28')).text();
    const res = await app.request('/api/digest/2026-10-28');
    const body = (await res.json()) as { night: string; rows: { job: string }[]; badLines: number };

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body.night).toBe('2026-10-28');
    expect(body.rows.length).toBeGreaterThan(0);
    const pageJobs = [...html.matchAll(/<tr[^>]*><td>([^<]+)<\/td>/g)].map((m) => m[1]);
    expect(body.rows.map((row) => row.job)).toEqual(pageJobs);
  });

  it('returns rows for an empty night', async () => {
    const app = createApp({ ...config, runsDir: fixture('') });
    const res = await app.request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-10-28', rows: [], badLines: 0 });
  });

  it('returns 404 for a missing or invalid night', async () => {
    const app = createApp(config);

    expect((await app.request('/api/digest/2026-01-01')).status).toBe(404);
    expect((await app.request('/api/digest/nope')).status).toBe(404);
  });
});
