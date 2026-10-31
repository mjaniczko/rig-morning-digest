import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'runs',
};
const run = {
  at: '2026-10-28T23:00:00+01:00',
  job: 'digest/render',
  status: 'ok',
  owner: null,
};

let fixtureDir: string | undefined;

function fixture(contents?: string): string {
  fixtureDir = mkdtempSync(join(process.cwd(), '.digest-route-test-'));
  if (contents !== undefined) writeFileSync(join(fixtureDir, `${night}.jsonl`), contents);
  return fixtureDir;
}

function app(contents?: string) {
  return createApp({ ...config, runsDir: fixture(contents) });
}

afterEach(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  fixtureDir = undefined;
});

describe('digest page', () => {
  it('renders the night in the shared layout with rows sorted and warnings marked', async () => {
    const contents = [
      JSON.stringify({ ...run, job: 'z-job', status: 'fail', error: 'failed' }),
      JSON.stringify({ ...run, job: 'a-job' }),
    ].join('\n');
    const res = await app(contents).request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(`<title>rig · digest · ${night}</title>`);
    expect(html).toContain('lane-07');
    expect(html.indexOf('a-job')).toBeLessThan(html.indexOf('z-job'));
    expect(html).toMatch(/<tr class="warn"><td>z-job<\/td>/);
    expect(html).toContain('failed');
    expect(html).not.toContain('<script');
  });

  it('renders exactly “nothing ran” for an empty night', async () => {
    const res = await app('').request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<p>nothing ran</p>');
    expect(html).not.toContain('<table>');
  });

  it('returns 404 when the night file is missing', async () => {
    const res = await app().request(`/digest/${night}`);

    expect(res.status).toBe(404);
  });

  it('renders valid runs when the night contains a malformed line', async () => {
    const contents = `${JSON.stringify(run)}\n{malformed`;
    const res = await app(contents).request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('digest/render');
  });
});

describe('digest JSON route', () => {
  it('returns the same ordered jobs as the HTML page', async () => {
    const app = createApp(config);
    const html = await (await app.request(`/digest/${night}`)).text();
    const res = await app.request(`/api/digest/${night}`);
    const body = await res.json() as { night: string; rows: { job: string }[]; badLines: number };

    expect(res.status).toBe(200);
    expect(body.night).toBe(night);
    const pageJobs = [...html.matchAll(/<tr[^>]*><td>([^<]+)<\/td>/g)].map((match) => match[1]);
    expect(body.rows.map((row) => row.job)).toEqual(pageJobs);
  });

  it('returns the night digest as JSON', async () => {
    const res = await app(JSON.stringify(run)).request(`/api/digest/${night}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      night,
      rows: [{
        job: 'digest/render',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: run.at,
        lastAt: run.at,
      }],
      badLines: 0,
    });
  });

  it('returns 404 when the night file is missing', async () => {
    const res = await app().request(`/api/digest/${night}`);

    expect(res.status).toBe(404);
  });

  it('returns an empty digest for an empty night', async () => {
    const res = await app('').request(`/api/digest/${night}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night, rows: [], badLines: 0 });
  });

  it('counts malformed lines and returns the valid runs', async () => {
    const contents = `${JSON.stringify(run)}\n{malformed`;
    const res = await app(contents).request(`/api/digest/${night}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night,
      rows: [{
        job: 'digest/render',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: run.at,
        lastAt: run.at,
      }],
      badLines: 1,
    });
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
