import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepare } from '../scripts/setup.mjs';

async function fixture(t, inputs = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ktc-native-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const native = process.platform === 'win32' ? 'kotlin.bat' : 'kotlin';
  const bytes = await readFile(new URL(`./fixtures/jvm/${native}`, import.meta.url));
  const checksum = createHash('sha256').update(bytes).digest('hex');
  t.mock.method(globalThis, 'fetch', async url => new Response(url.endsWith('.sha256') ? checksum : bytes));
  const env = { RUNNER_TEMP: root, GITHUB_WORKSPACE: root, RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64',
    GITHUB_EVENT_NAME: 'pull_request', INPUT_VERSION: '0.13.0', ...inputs };
  for (const key of ['GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_PATH']) {
    env[key] = path.join(root, key);
    await writeFile(env[key], '');
  }
  return { root, env, outputs: async () => Object.fromEntries((await readFile(env.GITHUB_OUTPUT, 'utf8')).trim().split('\n').map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  })) };
}

test('native caching is enabled by default without changing toolchain cache paths', async t => {
  const f = await fixture(t);
  const result = await prepare(f.env);
  const outputs = await f.outputs();
  assert.equal(outputs['cache-path'], result.cacheRoot);
  assert.equal(outputs['konan-cache-enabled'], 'true');
  assert.equal(outputs['konan-cache-path'], path.join(homedir(), '.konan'));
});

test('native caching can be disabled independently of toolchain caching', async t => {
  const f = await fixture(t, { INPUT_CACHE_KONAN: 'false' });
  const result = await prepare(f.env);
  const outputs = await f.outputs();
  assert.equal(outputs['cache-enabled'], 'true');
  assert.equal(outputs['cache-path'], result.cacheRoot);
  assert.equal(outputs['konan-cache-enabled'], 'false');
  assert.equal(outputs['konan-cache-path'], '');
});

test('explicit native caching uses the compiler default directory with a separate namespace', async t => {
  const f = await fixture(t, { INPUT_CACHE_KONAN: 'true' });
  await prepare(f.env);
  const outputs = await f.outputs();
  assert.equal(outputs['konan-cache-enabled'], 'true');
  assert.equal(outputs['konan-cache-path'], path.join(homedir(), '.konan'));
  assert.match(outputs['konan-cache-key'], /^ktc-konan-v1-Linux-X64-/);
  assert.notEqual(outputs['konan-cache-key'], outputs['cache-key']);
  assert.equal(outputs['cache-read-only'], 'true');
  assert.ok(outputs['konan-cache-key'].startsWith(outputs['konan-cache-prefix']));
});

test('native caching preserves a custom KONAN_DATA_DIR and warm contents', async t => {
  const f = await fixture(t, { INPUT_CACHE_KONAN: 'true', GITHUB_EVENT_NAME: 'push' });
  f.env.KONAN_DATA_DIR = path.join(f.root, 'custom native data');
  await mkdir(f.env.KONAN_DATA_DIR);
  const marker = path.join(f.env.KONAN_DATA_DIR, 'restored-tool');
  await writeFile(marker, 'warm native cache');
  await prepare(f.env);
  await prepare(f.env);
  const outputs = await f.outputs();
  assert.equal(outputs['konan-cache-path'], f.env.KONAN_DATA_DIR);
  assert.equal(outputs['cache-read-only'], 'false');
  assert.equal(await readFile(marker, 'utf8'), 'warm native cache');
  assert.doesNotMatch(await readFile(f.env.GITHUB_ENV, 'utf8'), /^KONAN_DATA_DIR=/m);
});

test('cache false disables native caching both by default and when explicitly requested', async t => {
  const f = await fixture(t, { INPUT_CACHE: 'false' });
  for (const env of [f.env, { ...f.env, INPUT_CACHE_KONAN: 'true' }]) {
    await prepare(env);
    const outputs = await f.outputs();
    assert.equal(outputs['cache-enabled'], 'false');
    assert.equal(outputs['konan-cache-enabled'], 'false');
    assert.equal(outputs['konan-cache-path'], '');
  }
});

test('invalid native cache options are rejected before downloading', async t => {
  const f = await fixture(t, { INPUT_CACHE_KONAN: 'yes' });
  await assert.rejects(prepare(f.env), /cache-konan must be true or false/);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('native cache paths cannot inject output lines or depend on a working directory', async t => {
  const f = await fixture(t, { INPUT_CACHE_KONAN: 'true' });
  for (const value of ['relative/cache', `${path.join(f.root, 'native')}\ncache-enabled=true`]) {
    await assert.rejects(prepare({ ...f.env, KONAN_DATA_DIR: value }), /KONAN_DATA_DIR/);
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
