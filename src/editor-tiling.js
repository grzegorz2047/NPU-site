export function createTilePlan(width, height, { tileSize = 512, overlap = 32 } = {}) {
  width = positiveInteger(width, 'width');
  height = positiveInteger(height, 'height');
  tileSize = positiveInteger(tileSize, 'tileSize');
  overlap = Math.max(0, Math.trunc(Number(overlap)) || 0);
  if (overlap * 2 >= tileSize) throw new Error('Overlap musi być mniejszy niż połowa rozmiaru kafelka.');
  const step = tileSize - overlap * 2;
  const xs = positions(width, tileSize, step);
  const ys = positions(height, tileSize, step);
  const tiles = [];
  let index = 0;
  for (const y of ys) {
    for (const x of xs) {
      const tileWidth = Math.min(tileSize, width - x);
      const tileHeight = Math.min(tileSize, height - y);
      tiles.push({
        index: index++,
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        crop: {
          left: x === 0 ? 0 : overlap,
          top: y === 0 ? 0 : overlap,
          right: x + tileWidth >= width ? 0 : overlap,
          bottom: y + tileHeight >= height ? 0 : overlap
        }
      });
    }
  }
  return { width, height, tileSize, overlap, tiles };
}

export function stitchNumericTiles(plan, outputs, { channels = 1, ArrayType = Float32Array } = {}) {
  if (!plan?.tiles || !Array.isArray(outputs) || outputs.length !== plan.tiles.length) throw new Error('Niekompletny zestaw kafelków.');
  channels = positiveInteger(channels, 'channels');
  const sums = new Float64Array(plan.width * plan.height * channels);
  const weights = new Float64Array(plan.width * plan.height);
  for (let tileIndex = 0; tileIndex < plan.tiles.length; tileIndex += 1) {
    const tile = plan.tiles[tileIndex];
    const values = outputs[tileIndex]?.data ?? outputs[tileIndex];
    if (!values || values.length !== tile.width * tile.height * channels) throw new Error(`Kafelek ${tileIndex} ma nieprawidłowy rozmiar.`);
    for (let ty = 0; ty < tile.height; ty += 1) {
      const wy = edgeWeight(ty, tile.height, tile.crop.top, tile.crop.bottom);
      for (let tx = 0; tx < tile.width; tx += 1) {
        const wx = edgeWeight(tx, tile.width, tile.crop.left, tile.crop.right);
        const weight = Math.max(1e-6, wx * wy);
        const destinationPixel = (tile.y + ty) * plan.width + tile.x + tx;
        const sourcePixel = ty * tile.width + tx;
        weights[destinationPixel] += weight;
        for (let channel = 0; channel < channels; channel += 1) {
          sums[destinationPixel * channels + channel] += Number(values[sourcePixel * channels + channel]) * weight;
        }
      }
    }
  }
  const output = new ArrayType(plan.width * plan.height * channels);
  for (let pixel = 0; pixel < weights.length; pixel += 1) {
    const weight = weights[pixel] || 1;
    for (let channel = 0; channel < channels; channel += 1) output[pixel * channels + channel] = sums[pixel * channels + channel] / weight;
  }
  return output;
}

export async function runTiledInference({ width, height, tileSize = 512, overlap = 32, channels = 1, extractTile, inferTile, signal, onProgress = () => {}, now = () => performance.now() }) {
  if (typeof extractTile !== 'function' || typeof inferTile !== 'function') throw new TypeError('Tiling wymaga extractTile i inferTile.');
  const plan = createTilePlan(width, height, { tileSize, overlap });
  const outputs = [];
  for (const tile of plan.tiles) {
    throwIfAborted(signal);
    const input = await extractTile(tile, signal);
    throwIfAborted(signal);
    outputs.push(await inferTile(input, tile, signal));
    onProgress({ stage: 'inference', completed: tile.index + 1, total: plan.tiles.length, progress: (tile.index + 1) / plan.tiles.length * 100, tile });
  }
  throwIfAborted(signal);
  const stitchStartedAt = now();
  const data = stitchNumericTiles(plan, outputs, { channels });
  const stitchDurationMs = Math.max(0, now() - stitchStartedAt);
  onProgress({ stage: 'postprocessing', label: 'Składanie kafelków', progress: 100 });
  return { plan, data, stitchDurationMs };
}

function positions(length, tileSize, step) {
  if (length <= tileSize) return [0];
  const result = [];
  for (let position = 0; position < length; position += step) {
    const bounded = Math.min(position, length - tileSize);
    if (result.at(-1) !== bounded) result.push(bounded);
    if (bounded + tileSize >= length) break;
  }
  return result;
}

function edgeWeight(position, length, leading, trailing) {
  if (leading > 0 && position < leading) return smooth((position + 1) / (leading + 1));
  const trailingStart = length - trailing;
  if (trailing > 0 && position >= trailingStart) return smooth((length - position) / (trailing + 1));
  return 1;
}

function smooth(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function positiveInteger(value, label) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} musi być dodatnią liczbą całkowitą.`);
  return number;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException(String(signal.reason || 'Operacja anulowana.'), 'AbortError');
}
