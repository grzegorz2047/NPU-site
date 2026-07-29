export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 32;
export const QUICK_ZOOMS = Object.freeze([0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16]);

export function createViewport(viewport = {}) {
  return {
    zoom: clampZoom(viewport.zoom ?? 1),
    panX: finite(viewport.panX, 0),
    panY: finite(viewport.panY, 0)
  };
}

export function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finite(value, 1)));
}

export function zoomAtPoint(viewportInput, nextZoomInput, point) {
  const viewport = createViewport(viewportInput);
  const nextZoom = clampZoom(nextZoomInput);
  const anchor = { x: finite(point?.x, 0), y: finite(point?.y, 0) };
  const documentPoint = screenToDocument(anchor, viewport);
  return {
    zoom: nextZoom,
    panX: anchor.x - documentPoint.x * nextZoom,
    panY: anchor.y - documentPoint.y * nextZoom
  };
}

export function panViewport(viewportInput, delta = {}) {
  const viewport = createViewport(viewportInput);
  return {
    ...viewport,
    panX: viewport.panX + finite(delta.x, 0),
    panY: viewport.panY + finite(delta.y, 0)
  };
}

export function fitViewport(container, documentSize, padding = 32) {
  const width = Math.max(1, finite(container?.width, 1) - padding * 2);
  const height = Math.max(1, finite(container?.height, 1) - padding * 2);
  const documentWidth = Math.max(1, finite(documentSize?.width, 1));
  const documentHeight = Math.max(1, finite(documentSize?.height, 1));
  const zoom = clampZoom(Math.min(width / documentWidth, height / documentHeight, 1));
  return {
    zoom,
    panX: (finite(container?.width, width) - documentWidth * zoom) / 2,
    panY: (finite(container?.height, height) - documentHeight * zoom) / 2
  };
}

export function documentToScreen(point, viewportInput) {
  const viewport = createViewport(viewportInput);
  return {
    x: finite(point?.x, 0) * viewport.zoom + viewport.panX,
    y: finite(point?.y, 0) * viewport.zoom + viewport.panY
  };
}

export function screenToDocument(point, viewportInput) {
  const viewport = createViewport(viewportInput);
  return {
    x: (finite(point?.x, 0) - viewport.panX) / viewport.zoom,
    y: (finite(point?.y, 0) - viewport.panY) / viewport.zoom
  };
}

export function createMatrix(values = {}) {
  if (Array.isArray(values)) return values.length === 6 ? values.map(Number) : identityMatrix();
  const rotation = finite(values.rotation, 0) * Math.PI / 180;
  const skewX = finite(values.skewX, 0) * Math.PI / 180;
  const skewY = finite(values.skewY, 0) * Math.PI / 180;
  const scaleX = finite(values.scaleX, 1);
  const scaleY = finite(values.scaleY, 1);
  const originX = finite(values.originX, 0);
  const originY = finite(values.originY, 0);
  let matrix = identityMatrix();
  matrix = multiplyMatrices(matrix, translationMatrix(finite(values.x, 0) + originX, finite(values.y, 0) + originY));
  matrix = multiplyMatrices(matrix, rotationMatrix(rotation));
  matrix = multiplyMatrices(matrix, [1, Math.tan(skewY), Math.tan(skewX), 1, 0, 0]);
  matrix = multiplyMatrices(matrix, scaleMatrix(scaleX, scaleY));
  matrix = multiplyMatrices(matrix, translationMatrix(-originX, -originY));
  return matrix;
}

export function identityMatrix() { return [1, 0, 0, 1, 0, 0]; }
export function translationMatrix(x, y) { return [1, 0, 0, 1, finite(x, 0), finite(y, 0)]; }
export function scaleMatrix(x, y = x) { return [finite(x, 1), 0, 0, finite(y, 1), 0, 0]; }
export function rotationMatrix(radians) {
  const cosine = Math.cos(finite(radians, 0));
  const sine = Math.sin(finite(radians, 0));
  return [cosine, sine, -sine, cosine, 0, 0];
}

export function multiplyMatrices(left, right) {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1
  ];
}

export function invertMatrix(matrix) {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) throw new Error('Macierz transformacji jest nieodwracalna.');
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ];
}

export function applyMatrix(matrix, point) {
  const [a, b, c, d, e, f] = matrix;
  const x = finite(point?.x, 0);
  const y = finite(point?.y, 0);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function transformedBounds(rectInput, transform = {}) {
  const rect = normalizeRect(rectInput);
  const matrix = createMatrix(transform);
  const points = [
    applyMatrix(matrix, { x: rect.x, y: rect.y }),
    applyMatrix(matrix, { x: rect.x + rect.width, y: rect.y }),
    applyMatrix(matrix, { x: rect.x + rect.width, y: rect.y + rect.height }),
    applyMatrix(matrix, { x: rect.x, y: rect.y + rect.height })
  ];
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points
  };
}

export function normalizeRect(rect = {}) {
  const x1 = finite(rect.x, 0);
  const y1 = finite(rect.y, 0);
  const x2 = x1 + finite(rect.width, 0);
  const y2 = y1 + finite(rect.height, 0);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

export function constrainCropRect(rectInput, aspectRatio, bounds = null) {
  const rect = normalizeRect(rectInput);
  const ratio = finite(aspectRatio, 0);
  if (ratio > 0 && rect.width > 0 && rect.height > 0) {
    if (rect.width / rect.height > ratio) rect.width = rect.height * ratio;
    else rect.height = rect.width / ratio;
  }
  if (bounds) {
    const limit = normalizeRect(bounds);
    rect.x = Math.max(limit.x, Math.min(rect.x, limit.x + limit.width));
    rect.y = Math.max(limit.y, Math.min(rect.y, limit.y + limit.height));
    rect.width = Math.max(1, Math.min(rect.width, limit.x + limit.width - rect.x));
    rect.height = Math.max(1, Math.min(rect.height, limit.y + limit.height - rect.y));
  }
  return rect;
}

export function rotatePoint(point, center, degrees) {
  const radians = finite(degrees, 0) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = finite(point?.x, 0) - finite(center?.x, 0);
  const y = finite(point?.y, 0) - finite(center?.y, 0);
  return {
    x: x * cosine - y * sine + finite(center?.x, 0),
    y: x * sine + y * cosine + finite(center?.y, 0)
  };
}

export function snapValue(valueInput, targets = [], options = {}) {
  const value = finite(valueInput, 0);
  if (options.enabled === false) return { value, target: null, delta: 0 };
  const zoom = clampZoom(options.zoom ?? 1);
  const threshold = Math.max(0, finite(options.threshold, 8)) / zoom;
  let best = null;
  for (const target of targets) {
    const numeric = finite(typeof target === 'object' ? target.value : target, Number.NaN);
    if (!Number.isFinite(numeric)) continue;
    const delta = numeric - value;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
      best = { value: numeric, target, delta };
    }
  }
  return best ?? { value, target: null, delta: 0 };
}

export function snapPoint(point, options = {}) {
  const documentSize = options.documentSize ?? {};
  const guides = options.guides ?? { vertical: [], horizontal: [] };
  const gridSize = Math.max(1, finite(options.gridSize, 0));
  const xTargets = [0, finite(documentSize.width, 0) / 2, finite(documentSize.width, 0), ...(guides.vertical ?? [])];
  const yTargets = [0, finite(documentSize.height, 0) / 2, finite(documentSize.height, 0), ...(guides.horizontal ?? [])];
  if (options.gridEnabled && gridSize > 0) {
    const x = finite(point?.x, 0);
    const y = finite(point?.y, 0);
    xTargets.push(Math.round(x / gridSize) * gridSize);
    yTargets.push(Math.round(y / gridSize) * gridSize);
  }
  const x = snapValue(point?.x, xTargets, options);
  const y = snapValue(point?.y, yTargets, options);
  return { x: x.value, y: y.value, snappedX: x.target, snappedY: y.target };
}

export function perspectiveQuad(widthInput, heightInput, perspectiveXInput = 0, perspectiveYInput = 0) {
  const width = Math.max(1, finite(widthInput, 1));
  const height = Math.max(1, finite(heightInput, 1));
  const px = Math.max(-0.95, Math.min(0.95, finite(perspectiveXInput, 0)));
  const py = Math.max(-0.95, Math.min(0.95, finite(perspectiveYInput, 0)));
  const horizontal = Math.abs(px) * width * 0.35;
  const vertical = Math.abs(py) * height * 0.35;
  return [
    { x: px > 0 ? horizontal : 0, y: py > 0 ? vertical : 0 },
    { x: px < 0 ? width - horizontal : width, y: py < 0 ? vertical : 0 },
    { x: px > 0 ? width - horizontal : width, y: py > 0 ? height - vertical : height },
    { x: px < 0 ? horizontal : 0, y: py < 0 ? height - vertical : height }
  ];
}

export function bilinearPoint(quad, uInput, vInput) {
  const u = Math.max(0, Math.min(1, finite(uInput, 0)));
  const v = Math.max(0, Math.min(1, finite(vInput, 0)));
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  return {
    x: (1 - u) * (1 - v) * topLeft.x + u * (1 - v) * topRight.x + u * v * bottomRight.x + (1 - u) * v * bottomLeft.x,
    y: (1 - u) * (1 - v) * topLeft.y + u * (1 - v) * topRight.y + u * v * bottomRight.y + (1 - u) * v * bottomLeft.y
  };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
