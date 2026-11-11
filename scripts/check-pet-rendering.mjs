import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { setModelLocation } from '../plugin/model-locations.ts';
import { modelPath } from '../plugin/model-path.mjs';
import { State } from '../plugin/state.mjs';
const { PNG } = createRequire(import.meta.url)('pngjs');
const root = resolve(import.meta.dirname, '..'), out = resolve(process.env.PEKO_UI_OUT || join(root, 'work/pet-rendering'));
mkdirSync(out, { recursive: true });
const home = mkdtempSync(join(root, 'work/render-home-')), avatars = JSON.parse(readFileSync(join(root, 'assets/avatars.json'), 'utf8')).avatars;
setModelLocation(home, 'deepseek', process.env.PEKO_TEST_LIBRARY ? join(process.env.PEKO_TEST_LIBRARY, avatars.deepseek.library) : modelPath('deepseek'), avatars);
const state = new State(join(home, 'peko-pet/state.sqlite3'));
state.db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify({ avatar: 'deepseek', petScale: 2 }));
state.close();
mkdirSync(join(home, 'profiles/desktop'), { recursive: true });
writeFileSync(join(home, 'profiles/desktop/cordis.patch.yml'), '- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config: {provider: peko-test, model: replay}\n');
const patch = join(home, 'fixture.yml');
writeFileSync(patch, `- insert:\n    - id: fixture-model\n      name: '${pathToFileURL(join(root, 'tests/replay-adapter.mjs')).href}'\n`);
const runtime = process.env.PEKO_UI_ROOT || root, report = { passed: false, errors: [] };
let app, closing = false;
try {
    app = await electron.launch({ executablePath: process.env.PEKO_UI_EXE || createRequire(import.meta.url)('electron'), args: process.env.PEKO_UI_EXE ? ['--peko-test'] : [root, '--peko-test'], env: { ...process.env, DSH_HOME: home, PEKO_ROOT: runtime, PEKO_NODE: existsSync(join(runtime, 'node.exe')) ? join(runtime, 'node.exe') : process.execPath, PEKO_USER_DATA: join(home, 'user-data'), PEKO_AGENT_PATCH: patch }, timeout: 120000 });
    app.on('window', p => p.on('pageerror', e => { if (!closing)
        report.errors.push(String(e)); }));
    const deadline = Date.now() + 120000;
    while (!app.windows().some(p => p.url().startsWith('peko-app://pet/'))) {
        if (Date.now() > deadline)
            throw Error('Pet startup timed out');
        await new Promise(r => setTimeout(r, 50));
    }
    const pet = app.windows().find(p => p.url().startsWith('peko-app://pet/'));
    await pet.waitForFunction(() => window.__pekoAvatarTest?.catalog.name === 'DeepSeek-chan（大肥鱼）', null, { timeout: 90000 });
    if (!process.env.PEKO_RENDER_BASELINE)
        assert.equal(await pet.evaluate(() => window.__pekoAvatarTest.inspect().maskSize), 2048);
    const snapshots = await pet.evaluate(() => { const t = window.__pekoAvatarTest; t.release(); const images = {}; for (const [size, precise] of [[256, false], [1024, false], [1024, true], [2048, false], [4096, false]])
        images[size + '-' + precise] = t.quality(size, precise); return images; });
    for (const [name, data] of Object.entries(snapshots))
        writeFileSync(join(out, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    const images = Object.fromEntries(Object.entries(snapshots).map(([name, data]) => [name, PNG.sync.read(Buffer.from(data.split(',')[1], 'base64'))]));
    const reference = images['4096-false'];
    const error = image => { let sum = 0, count = 0; for (let y = Math.floor(reference.height * .57); y < reference.height * .86; y++)
        for (let x = Math.floor(reference.width * .24); x < reference.width * .85; x++)
            for (let c = 0; c < 4; c++) {
                const i = (y * reference.width + x) * 4 + c;
                sum += Math.abs(image.data[i] - reference.data[i]);
                count++;
            } return sum / count; };
    report.tailError = { old256: error(images['256-false']), new2048: error(images['2048-false']) };
    assert.ok(report.tailError.new2048 < report.tailError.old256 * .5, 'Tail edges must converge to the high-resolution reference');
    const w = Math.round(reference.width * .27), h = Math.round(reference.height * .26), x0 = Math.floor(reference.width * .57), y0 = Math.floor(reference.height * .56), comparisonImage = new PNG({ width: w * 2 + 16, height: h });
    comparisonImage.data.fill(255);
    for (const [panel, name] of ['256-false', '2048-false'].entries())
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const src = ((y0 + y) * reference.width + x0 + x) * 4, dst = (y * comparisonImage.width + panel * (w + 16) + x) * 4, alpha = images[name].data[src + 3] / 255;
                for (let c = 0; c < 3; c++)
                    comparisonImage.data[dst + c] = Math.round(images[name].data[src + c] * alpha + 255 * (1 - alpha));
            }
    writeFileSync(join(out, 'tail-comparison.png'), PNG.sync.write(comparisonImage));
    const comparison = await pet.evaluate(() => { const t = window.__pekoAvatarTest, results = []; for (const [size, precise] of [[256, false], [1024, false], [1024, true], [2048, false]]) {
        t.quality(size, precise);
        results.push({ size, precise, ms: t.benchmark(30) });
    } return results; });
    report.quality = comparison;
    await pet.evaluate(() => window.__pekoAvatarTest.quality(2048, false));
    await pet.evaluate(() => window.peko.invoke('pet_scale', { delta: -Math.log(.5 / 2) / .001 }));
    await pet.waitForFunction(() => innerWidth === 200 && document.querySelector('canvas').height === Math.round(300 * devicePixelRatio));
    const native = await app.browserWindow(pet);
    await native.evaluate(w => { w.__paint = { frames: 0, blank: 0 }; w.webContents.on('paint', (_event, _dirty, image) => { const pixels = image.toBitmap(); let visible = false; for (let i = 3; i < pixels.length; i += 64)
        if (pixels[i] > 20) {
            visible = true;
            break;
        } w.__paint.frames++; if (!visible)
        w.__paint.blank++; }); });
    const before = await pet.evaluate(() => window.__pekoAvatarTest.inspect());
    for (let i = 0; i < 60; i++)
        await pet.evaluate(i => window.peko.invoke('pet_move', { x: i % 2 ? 3 : -3, y: i % 2 ? 2 : -2 }), i);
    const after = await pet.evaluate(() => window.__pekoAvatarTest.inspect());
    report.drag = { before, after, bufferResets: after.bufferResizes - before.bufferResizes, paint: await native.evaluate(w => w.__paint) };
    const resizes = await pet.evaluate(() => { const t = window.__pekoAvatarTest, before = t.inspect().bufferResizes; for (let i = 0; i < 60; i++)
        dispatchEvent(new Event('resize')); return t.inspect().bufferResizes - before; });
    report.redundantResizeResets = resizes;
    if (!process.env.PEKO_RENDER_BASELINE) {
        assert.equal(report.drag.bufferResets, 0, 'Moving must retain the existing WebGL buffer');
        assert.equal(report.redundantResizeResets, 0);
        assert.equal(report.drag.paint.blank, 0);
        assert.ok(report.drag.paint.frames > 0);
        assert.deepEqual(report.errors, []);
    }
    report.passed = true;
    console.log(JSON.stringify({ quality: report.quality, bufferResets: report.drag.bufferResets, paint: report.drag.paint, tailError: report.tailError, errors: report.errors }));
}
catch (error) {
    report.error = String(error);
    throw error;
}
finally {
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    closing = true;
    await app?.close();
}
