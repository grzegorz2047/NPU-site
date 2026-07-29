export class ScaledRgbaAccumulator {
  constructor(plan) {
    if (!plan?.tiles || !plan.outputWidth || !plan.outputHeight) throw new Error('Akumulator wymaga planu kafelków.');
    this.plan = plan;
    this.data = new Uint8ClampedArray(plan.outputWidth * plan.outputHeight * 4);
    this.weights = new Float32Array(plan.outputWidth * plan.outputHeight);
    this.completed = new Set();
  }

  add(tile, output) {
    if (!tile?.output || this.completed.has(tile.index)) throw new Error(`Kafelek ${tile?.index ?? '?'} został dodany ponownie lub jest nieprawidłowy.`);
    const data = output?.data ?? output;
    const width = output?.width ?? tile.output.width;
    const height = output?.height ?? tile.output.height;
    if (width !== tile.output.width || height !== tile.output.height || data?.length !== width * height * 4) throw new Error(`Kafelek ${tile.index} ma nieprawidłowy rozmiar wyjścia.`);
    for (let ty = 0; ty < height; ty += 1) {
      const wy = edgeWeight(ty, height, tile.output.crop.top, tile.output.crop.bottom);
      for (let tx = 0; tx < width; tx += 1) {
        const wx = edgeWeight(tx, width, tile.output.crop.left, tile.output.crop.right);
        const weight = Math.max(1e-6, wx * wy);
        const destinationPixel = (tile.output.y + ty) * this.plan.outputWidth + tile.output.x + tx;
        const sourcePixel = ty * width + tx;
        const previousWeight = this.weights[destinationPixel];
        const combinedWeight = previousWeight + weight;
        for (let channel = 0; channel < 4; channel += 1) {
          const destination = destinationPixel * 4 + channel;
          const source = sourcePixel * 4 + channel;
          this.data[destination] = Math.round((this.data[destination] * previousWeight + Number(data[source]) * weight) / combinedWeight);
        }
        this.weights[destinationPixel] = combinedWeight;
      }
    }
    this.completed.add(tile.index);
    return this;
  }

  finish({ requireComplete = true } = {}) {
    if (requireComplete && this.completed.size !== this.plan.tiles.length) throw new Error(`Brakuje ${this.plan.tiles.length - this.completed.size} kafelków wyniku.`);
    return { data: this.data, width: this.plan.outputWidth, height: this.plan.outputHeight };
  }

  get memoryBytes() {
    return this.data.byteLength + this.weights.byteLength;
  }
}

export function stitchScaledRgbaTilesIncrementally(plan, outputs) {
  if (!Array.isArray(outputs) || outputs.length !== plan?.tiles?.length) throw new Error('Niekompletny zestaw kafelków restoration.');
  const accumulator = new ScaledRgbaAccumulator(plan);
  plan.tiles.forEach((tile, index) => accumulator.add(tile, outputs[index]));
  return accumulator.finish();
}

function edgeWeight(position, length, leading, trailing) {
  if (leading > 0 && position < leading) return smooth((position + 1) / (leading + 1));
  const trailingStart = length - trailing;
  if (trailing > 0 && position >= trailingStart) return smooth((length - position) / (trailing + 1));
  return 1;
}
function smooth(value) { const t = Math.min(1, Math.max(0, Number(value) || 0)); return t * t * (3 - 2 * t); }
