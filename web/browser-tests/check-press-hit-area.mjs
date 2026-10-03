// Run with Node 24: CHROME_BIN=/path/to/chrome node browser-tests/check-press-hit-area.mjs
// Real CSS/native input fixture only; no backend, account, or API calls.
// Add --motion to verify content entry, reduced motion and press timing too.
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
const menuResults = [];
const motionResults = [];
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
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#nested")).opacity'), '0.82', 'Nested action retains feedback');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#nested")).scale'), 'none', 'Nested hit area stays stable');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#chapter")).scale'), 'none', 'Parent hit area stays stable');
    if (touchInput) await touch('touchEnd'); else await mouse('mouseReleased', nested);
    assert.deepEqual(await evaluate(`window.pressTest.clicks.slice(${before})`), ['nested'], 'Nested action does not navigate the parent');
    await sleep(200);

    for (const edge of ['left', 'right', 'center']) {
      for (let trial = 0; trial < 3; trial++) {
        await evaluate('document.querySelector("#menu-card").scrollIntoView({block:"center"})');
        const center = await evaluate('(() => {const r=document.querySelector("#menu-item").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
        if (!touchInput) { await mouse('mouseMoved', center); await sleep(250); }
        const rect = await evaluate('(() => {const r=document.querySelector("#menu-item").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()');
        const point = { x: edge === 'left' ? rect.x + 0.8 : edge === 'right' ? rect.x + rect.width - 0.8 : rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const before = await evaluate('window.pressTest.clicks.length');
        if (touchInput) await touch('touchStart', point);
        else { await mouse('mouseMoved', point); await mouse('mousePressed', point); }
        await sleep(150);
        const held = await evaluate(`(() => {const e=document.querySelector('#menu-item'),r=e.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:document.elementFromPoint(${point.x},${point.y})===e,opacity:getComputedStyle(e).opacity,parentOpacity:getComputedStyle(document.querySelector('#menu-card')).opacity};})()`);
        assert.deepEqual(held.rect, rect, 'Press must not shrink or move a menu hit area');
        assert.ok(held.hit, 'The original edge remains inside the pressed menu button');
        assert.equal(held.opacity, '0.82');
        assert.equal(held.parentOpacity, '1', 'Nested press must not dim the whole card');
        if (touchInput) await touch('touchEnd'); else await mouse('mouseReleased', point);
        const clicks = await evaluate(`window.pressTest.clicks.slice(${before})`);
        assert.deepEqual(clicks, ['menu-action'], 'Edge release must activate the menu, not navigate its card');
        menuResults.push({ device, edge, trial, clicks });
        await sleep(200);
        assert.deepEqual(await evaluate(`window.pressTest.clicks.slice(${before})`), clicks, 'No delayed or duplicate menu action');
      }
    }

    if (process.argv.includes('--motion')) {
      await evaluate('window.pressTest.loading()');
      assert.equal(await evaluate('document.querySelector("#content-host main").getAnimations().length'), 0, 'Loading shell must not consume entry animation');
      for (const kind of ['home', 'empty', 'emptyLibrary', 'library', 'series', 'volume']) {
        const sample = await evaluate(`(() => {
          window.pressTest.ready(${JSON.stringify(kind)});
          const e=document.querySelector('#content'), a=e.getAnimations()[0];
          if (!a) return {missing:true};
          a.pause();
          const frames=[0,90,180].map(time=>{
            a.currentTime=time;
            const s=getComputedStyle(e), r=e.getBoundingClientRect(), f=document.querySelector('#fixed-marker').getBoundingClientRect();
            return {opacity:Number(s.opacity),transform:s.transform,scale:s.scale,pointerEvents:s.pointerEvents,
              rect:[r.x,r.y,r.width,r.height],fixed:[f.x,f.y,f.width,f.height]};
          });
          const duration=a.effect.getTiming().duration;
          // Check identity during playback, not after a no-fill effect has ended.
          a.currentTime=90;
          e.firstChild.textContent='Updated fixture data';
          const sameAnimation=e.getAnimations()[0]===a;
          a.finish();
          return {duration,frames,sameAnimation};
        })()`);
        assert.equal(sample.missing, undefined, `${kind} entry animation exists`);
        assert.equal(sample.duration, 180);
        assert.equal(sample.frames[0].opacity, 0.45);
        assert.ok(sample.frames[1].opacity > 0.45 && sample.frames[1].opacity < 1);
        assert.equal(sample.frames[2].opacity, 1);
        assert.ok(sample.sameAnimation, 'Content updates must not restart entry');
        for (const frame of sample.frames) {
          assert.equal(frame.transform, 'none'); assert.equal(frame.scale, 'none');
          assert.equal(frame.pointerEvents, 'auto');
          assert.deepEqual(frame.rect, sample.frames[0].rect, 'Entry must not move hit areas');
          assert.deepEqual(frame.fixed, sample.frames[0].fixed, 'Fixed descendants must not move');
          assert.equal(frame.fixed[1], 12, 'Fixed descendant stays viewport-relative');
        }
        motionResults.push({device,kind,duration:sample.duration});
      }

      await evaluate('document.querySelector("#navigate").hidden=false; window.pressTest.route=null; document.querySelector("#navigate").scrollIntoView({block:"center"})');
      const nav = await evaluate('(() => {const r=document.querySelector("#navigate").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
      const style = () => evaluate('(() => {const s=getComputedStyle(document.querySelector("#navigate"));return {scale:s.scale,opacity:s.opacity,duration:s.transitionDuration.split(", ").at(-1)};})()');
      assert.equal((await style()).duration, '0.12s');
      if (touchInput) await touch('touchStart', nav);
      else { await mouse('mouseMoved', nav); await mouse('mousePressed', nav); }
      assert.equal((await style()).duration, '0.06s');
      await until(async () => (await style()).opacity === '0.82', 'Native press transition settles');
      assert.equal((await style()).scale, 'none', 'Press does not change hit geometry');
      if (touchInput) await touch('touchEnd'); else await mouse('mouseReleased', nav);
      assert.equal(await evaluate('window.pressTest.route'), 'series', 'Action runs without waiting for release animation');
      assert.equal(await evaluate('document.querySelector("#content").getAnimations().length'), 1, 'Destination enters while action has already completed');
      assert.equal(await evaluate('document.querySelector("#navigate").hasAttribute("data-pressed")'), false);
      // Chromium touch may retain native :active after the click; do not delay the action for it.
      await until(() => evaluate('!document.querySelector("#navigate").matches(":active")'), 'Native active state clears');
      assert.equal((await style()).duration, '0.12s');
      await until(async () => (await style()).opacity === '1', 'Native release transition settles');
      await until(() => evaluate('document.querySelector("#content").getAnimations().length === 0'), 'No persistent animation or fill');
      motionResults.push({device,kind:'press-and-entry',pressMs:60,releaseMs:120});

      await cdp('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'}] });
      for (const kind of ['home', 'empty', 'emptyLibrary', 'library', 'series', 'volume']) {
        await evaluate(`window.pressTest.ready(${JSON.stringify(kind)})`);
        assert.equal(await evaluate('document.querySelector("#content").getAnimations().length'), 0);
        assert.equal(await evaluate('getComputedStyle(document.querySelector("#content")).opacity'), '1');
        motionResults.push({device,kind:`reduced-${kind}`});
      }
      await cdp('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'no-preference'}] });
    }
  }
  if (process.argv.includes('--motion')) {
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    for (const width of [390, 768, 769, 1024, 1200, 1280]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await mouse('mouseMoved', { x: 0, y: 0 });
      await evaluate('window.pressTest.hoverRow(); document.querySelector("#hover-row > :nth-child(2)").scrollIntoView({block:"center",inline:"center"})');
      await sleep(250);
      const point = await evaluate('(() => {const r=document.querySelector("#hover-row > :nth-child(2)").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+40};})()');
      const layout = await evaluate(`(() => {
        const row=document.querySelector('#hover-row'), item=row.children[1];
        const top=item.getBoundingClientRect().top+scrollY;
        row.style.paddingTop='0px'; row.style.marginTop='0px';
        const withoutSpacing=item.getBoundingClientRect().top+scrollY;
        row.style.removeProperty('padding-top'); row.style.removeProperty('margin-top');
        return {top,withoutSpacing};
      })()`);
      assert.equal(layout.top, layout.withoutSpacing, 'Hover clearance must not move the resting cards');
      await mouse('mouseMoved', point);
      await sleep(250);
      const sample = await evaluate(`(() => {
        const row=document.querySelector('#hover-row'), item=row.children[1], r=item.getBoundingClientRect(), s=getComputedStyle(row);
        const hit=document.elementFromPoint(r.x+r.width/2,r.top+1);
        return {hover:item.matches(':hover'),topVisible:item===hit||item.contains(hit),
          overflowX:s.overflowX,mask:s.maskImage,scrollable:row.scrollWidth>row.clientWidth};
      })()`);
      assert.ok(sample.hover, 'Native hover targets the card');
      assert.ok(sample.topVisible, `Hovered card top must not be clipped at ${width}px`);
      assert.equal(sample.overflowX, width <= 1200 ? 'auto' : 'visible');
      if (width <= 1200) {
        assert.ok(sample.scrollable, 'Horizontal scrolling remains available');
        assert.notEqual(sample.mask, 'none', 'Keep horizontal edge fading');
      }
      motionResults.push({device:`width-${width}`,kind:'hover-clearance',...sample});
    }
  }
  console.log(JSON.stringify({ results, menuResults, motionResults, errors }, null, 2));
  assert.equal(errors.length, 0, 'No browser runtime/console errors');
  for (const result of results) assert.deepEqual(result.clicks, ['chapter'], `${result.device} ${result.edge} trial ${result.trial}`);
  assert.equal(menuResults.length, 18);
  console.log(`PASS: ${menuResults.length} native menu edge/center clicks without parent navigation`);
  console.log(`PASS: ${results.length} native mouse/touch chapter clicks and nested controls; immediate fixture callbacks`);
  if (motionResults.length) console.log(`PASS: ${motionResults.length} content/press/reduced-motion cases`);
} finally {
  for (const { timer } of pending.values()) clearTimeout(timer);
  socket?.close();
  if (chrome?.pid && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill('SIGTERM'); await exited; }
  await server?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
