import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaFromMask, computeMaskBounds, coverRect, filenameForDownload, rgbaToNchw, scaleDimensions, tensorToMask } from '../src/editor-core.js';

test('normalizes RGBA input to NCHW', () => {
  const out = rgbaToNchw(new Uint8ClampedArray([0, 127, 255, 255]), 1, 1);
  assert.equal(out.length, 3);
  assert.equal(out[0], -1);
  assert.ok(Math.abs(out[1] + 0.0039215686) < 1e-6);
  assert.equal(out[2], 1);
});

test('extracts final mask plane and clamps values', () => {
  const mask = tensorToMask({ data: new Float32Array([99, -1, 0.2, 1.4, 0.7]) }, 4);
  assert.equal(mask[0], 0);
  assert.ok(Math.abs(mask[1] - 0.2) < 1e-6);
  assert.equal(mask[2], 1);
  assert.ok(Math.abs(mask[3] - 0.7) < 1e-6);
});

test('creates smooth alpha around threshold', () => {
  assert.equal(alphaFromMask(0.1, 0.5, 0.1), 0);
  assert.equal(alphaFromMask(0.9, 0.5, 0.1), 1);
  assert.ok(Math.abs(alphaFromMask(0.5, 0.5, 0.1) - 0.5) < 1e-9);
});

test('computes subject bounds', () => {
  const bounds = computeMaskBounds(new Float32Array([0, 1, 0, 0, 1, 1]), 3, 2, 0.5);
  assert.deepEqual(bounds, { x: 1, y: 0, width: 2, height: 2, coverage: 2 / 3 });
});

test('scales large image without enlarging small image', () => {
  assert.deepEqual(scaleDimensions(3200, 1600, 1400), { width: 1400, height: 700, scale: 0.4375 });
  assert.deepEqual(scaleDimensions(800, 600, 1400), { width: 800, height: 600, scale: 1 });
});

test('computes cover geometry', () => {
  const rect = coverRect(1600, 900, 600, 600);
  assert.ok(Math.abs(rect.x + 233.3333333333333) < 1e-9);
  assert.equal(rect.y, 0);
  assert.ok(Math.abs(rect.width - 1066.6666666666665) < 1e-9);
  assert.equal(rect.height, 600);
});

test('creates safe export filename', () => {
  assert.equal(filenameForDownload('Zdjęcie CV.JPG', 'png'), 'Zdjęcie-CV-localstudio.png');
});
