import { processRetouchStroke } from './editor-retouch.js';

self.addEventListener('message', event => {
  const { id, source, width, height, stroke, selection } = event.data ?? {};
  try {
    const result = processRetouchStroke(
      new Uint8ClampedArray(source),
      width,
      height,
      stroke,
      selection ? new Uint8Array(selection) : null
    );
    self.postMessage({ id, ok: true, result: { bounds: result.bounds, stroke: result.stroke, data: result.data.buffer } }, [result.data.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
