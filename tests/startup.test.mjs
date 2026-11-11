import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { readBootstrap } from '../agent/bootstrap.mjs';
import { State } from '../plugin/state.mjs';
import { portraitIcon } from '../desktop/portrait-icon.ts';
import { needsBuild } from '../scripts/build-status.mjs';
const fixture = t => { const root = mkdtempSync(join(tmpdir(), 'peko-startup-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
test('desktop bootstrap reads authoritative preferences without creating a database', t => { const home = fixture(t); assert.equal(readBootstrap(home).avatar, 'deepseek'); assert.equal(existsSync(join(home, 'peko-pet')), false); const s = new State(join(home, 'peko-pet/state.sqlite3')); s.updateSettings({ avatar: 'yumi', petX: -100, dnd: true }); s.close(); const p = readBootstrap(home); assert.equal(p.avatar, 'yumi'); assert.equal(p.petX, -100); assert.equal(p.dnd, true); });
test('cached portrait ICO declares a 256px 32-bit PNG image', () => { const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ico = portraitIcon(png); assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 1); assert.equal(ico[6], 0); assert.equal(ico[7], 0); assert.equal(ico.readUInt16LE(12), 32); assert.equal(ico.readUInt32LE(14), png.length); assert.equal(ico.readUInt32LE(18), 22); assert.deepEqual(ico.subarray(22), png); });
test('source startup skips unchanged builds, rebuilds changed inputs and repairs missing bundles', t => {
    const root = fixture(t), write = (name, text = '', at = 1000) => { const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); utimesSync(file, at, at); return file; };
    assert.equal(needsBuild(root), true);
    for (const dir of ['desktop', 'electron', 'renderer', 'agent', 'plugin', 'vendor/dsh-ui-chat/src', 'vendor/dsh-ui-conversation/src', 'vendor/peko-agent-loop/src', 'vendor/cubism-web-framework/src'])
        mkdirSync(join(root, dir), { recursive: true });
    for (const name of ['build/electron/main.cjs', 'build/electron/preload.cjs', 'build/electron/loading.html', 'build/renderer/transport.js', 'build/pet/pet.js', 'build/pet/index.html', 'plugin/frontend/client.js', 'vendor/dsh-ui-chat/client.js', 'vendor/dsh-ui-chat/index.mjs', 'vendor/dsh-ui-conversation/client.js', 'vendor/dsh-ui-conversation/index.mjs', 'vendor/peko-agent-loop/index.mjs', 'package.json', 'package-lock.json', 'scripts/build-electron.mjs', 'scripts/build-frontend.mjs'])
        write(name);
    write('build/.stamp', '', 2000);
    assert.equal(needsBuild(root), false);
    write('plugin/frontend/client.js', 'generated', 3000);
    assert.equal(needsBuild(root), false);
    const authored = write('vendor/dsh-ui-chat/src/client.js', 'changed', 3000);
    assert.equal(needsBuild(root), true);
    utimesSync(authored, 1000, 1000);
    assert.equal(needsBuild(root), false);
    rmSync(join(root, 'build/pet/pet.js'));
    assert.equal(needsBuild(root), true);
});
