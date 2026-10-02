// Run with Node 24: CHROME_BIN=/path/to/chrome node browser-tests/check-press-hit-area.mjs
// Real CSS/native input fixture only; no backend, account, or API calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'kumiho-press-browser-'));
const pending = new Map();
const results = [];
const errors = [];
let server, chrome, socket, sequence = 0;
let chromeError;

async function until(probe, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chromeError) throw chromeError;
    if (chrome && chrome.exitCode !== null) throw new Error(`Chrome exited: ${chrome.exitCode}`);
    const result = await probe();
    if (result) return result;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function mouse(type, point) {
  await cdp('Input.dispatchMouseEvent', { type, ...point,
    button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0,
    clickCount: type === 'mouseMoved' ? 0 : 1 });
}
async function touch(type, point) {
  await cdp('Input.dispatchTouchEvent', { type,
    touchPoints: point ? [{ ...point, id: 1, radiusX: 1, radiusY: 1, force: 1 }] : [] });
}

try {
  server = await createServer({ configFile: false, root, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  chrome.on('error', error => { chromeError = error; });
  const port = await until(async () => {
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }, 'Chrome DevTools');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const callback = pending.get(message.id);
      pending.delete(message.id); clearTimeout(callback.timer);
      if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
      else callback.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
  });
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  for (const [device, width, touchInput] of [['desktop', 1280, false], ['mobile', 390, true]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: touchInput });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: touchInput });
    await cdp('Page.navigate', { url: `${origin}/browser-tests/fixtures/press-hit-area.html` });
    await until(() => evaluate('!!window.pressTest'), 'fixture');
    for (const edge of ['left', 'right', 'center']) {
      for (let trial = 0; trial < 3; trial++) {
        await evaluate('document.querySelector("#chapter").scrollIntoView({block:"center"})');
        const center = await evaluate('(() => {const r=document.querySelector("#chapter").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
        if (!touchInput) { await mouse('mouseMoved', center); await sleep(250); }
        const point = await evaluate(`(() => {const r=document.querySelector('#chapter').getBoundingClientRect();return {x:${edge === 'left' ? 'r.left+5' : edge === 'right' ? 'r.right-5' : 'r.left+r.width/2'},y:r.top+r.height/2};})()`);
        if (touchInput && edge !== 'center') point.x += edge === 'left' ? -3 : 3;
        const before = await evaluate('window.pressTest.clicks.length');
        if (touchInput) await touch('touchStart', point);
        else { await mouse('mouseMoved', point); await mouse('mousePressed', point); }
        await sleep(150);
        if (touchInput) await touch('touchEnd'); else await mouse('mouseReleased', point);
        // A delayed action would not have run at this immediate observation.
        const clicks = await evaluate(`window.pressTest.clicks.slice(${before})`);
        results.push({ device, edge, trial, clicks });
        await sleep(200);
        assert.deepEqual(await evaluate(`window.pressTest.clicks.slice(${before})`), clicks, 'No delayed or duplicate clicks');
      }
    }
    const nested = await evaluate('(() => {const r=document.querySelector("#nested").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
    const before = await evaluate('window.pressTest.clicks.length');
    if (touchInput) await touch('touchStart', nested);
    else { await mouse('mouseMoved', nested); await mouse('mousePressed', nested); }
    await sleep(150);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#nested")).scale'), '0.98', 'Nested action retains feedback');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#chapter")).scale'), 'none', 'Parent hit area stays stable');
    if (touchInput) await touch('touchEnd'); else await mouse('mouseReleased', nested);
    assert.deepEqual(await evaluate(`window.pressTest.clicks.slice(${before})`), ['nested'], 'Nested action does not navigate the parent');
    await sleep(200);
  }
  console.log(JSON.stringify({ results, errors }, null, 2));
  assert.equal(errors.length, 0, 'No browser runtime/console errors');
  for (const result of results) assert.deepEqual(result.clicks, ['chapter'], `${result.device} ${result.edge} trial ${result.trial}`);
  console.log(`PASS: ${results.length} native mouse/touch chapter clicks and nested controls; immediate fixture callbacks`);
} finally {
  for (const { timer } of pending.values()) clearTimeout(timer);
  socket?.close();
  if (chrome?.pid && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill('SIGTERM'); await exited; }
  await server?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
