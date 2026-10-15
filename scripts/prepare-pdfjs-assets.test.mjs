import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFJS_VERSION, preparePdfjsAssets } from './prepare-pdfjs-assets.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'taskflow-pdf-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'node_modules', 'pdfjs-dist');
  const destination = path.join(root, 'public', 'pdfjs', PDFJS_VERSION);
  const write = (file, data = 'fictitious package asset') => {
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data);
  };
  write(path.join(source, 'package.json'), JSON.stringify({ version: PDFJS_VERSION }));
  for (const file of ['build/pdf.worker.min.mjs', 'cmaps/Japan.bcmap', 'standard_fonts/font.pfb', 'wasm/decoder.wasm', 'LICENSE']) write(path.join(source, file));
  return { root, source, destination, write };
}

test('publishes matching-version static assets and licenses without bundling unrelated package files', t => {
  const { root, source, destination, write } = fixture(t);
  write(path.join(source, 'build/pdf.mjs'), 'display API must remain in the client bundle');
  write(path.join(source, 'private-fixture.txt'), 'never publish arbitrary package-root files');
  write(path.join(destination, 'stale-file'), 'remove stale files from this version');
  write(path.join(root, 'public/pdfjs/older/keep'), 'keep other versions');
  assert.equal(preparePdfjsAssets(root), destination);
  for (const file of ['pdf.worker.min.mjs', 'cmaps/Japan.bcmap', 'standard_fonts/font.pfb', 'wasm/decoder.wasm', 'LICENSE']) {
    assert.equal(readFileSync(path.join(destination, file), 'utf8'), 'fictitious package asset');
  }
  for (const file of ['pdf.mjs', 'package.json', 'private-fixture.txt', 'stale-file']) assert.equal(existsSync(path.join(destination, file)), false);
  assert.equal(existsSync(path.join(root, 'public/pdfjs/older/keep')), true);
  const renderer = readFileSync(new URL('../src/lib/pdf/renderThumbnail.ts', import.meta.url), 'utf8');
  assert.ok(renderer.includes(`PDFJS_ASSET_BASE = '/pdfjs/${PDFJS_VERSION}'`));
});

test('rejects an unexpected package version before replacing existing assets', t => {
  const { root, source, destination, write } = fixture(t);
  write(path.join(source, 'package.json'), JSON.stringify({ version: '0.0.0' }));
  write(path.join(destination, 'existing'), 'keep');
  assert.throws(() => preparePdfjsAssets(root), /Expected pdfjs-dist/);
  assert.equal(readFileSync(path.join(destination, 'existing'), 'utf8'), 'keep');
});

test('preflights every required asset before replacing existing assets', t => {
  const { root, source, destination, write } = fixture(t);
  rmSync(path.join(source, 'LICENSE'));
  write(path.join(destination, 'existing'), 'keep');
  assert.throws(() => preparePdfjsAssets(root), /ENOENT/);
  assert.equal(readFileSync(path.join(destination, 'existing'), 'utf8'), 'keep');
});

test('does not publish asset symlinks or bytes outside the package asset tree', t => {
  const { root, source, destination, write } = fixture(t);
  write(path.join(root, 'outside.txt'), 'outside data');
  symlinkSync(path.join(root, 'outside.txt'), path.join(source, 'cmaps/link'));
  assert.throws(() => preparePdfjsAssets(root), /regular file or directory/);
  assert.equal(existsSync(destination), false);
});
