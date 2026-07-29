export class VersionedModelCache {
  constructor({ cacheName = 'localstudio-models-v1', cacheStorage = globalThis.caches, fetcher = globalThis.fetch } = {}) {
    this.cacheName = cacheName;
    this.cacheStorage = cacheStorage;
    this.fetcher = fetcher;
    this.memory = new Map();
  }

  async get(url, { key = url, signal, onProgress = () => {} } = {}) {
    if (this.memory.has(key)) return this.memory.get(key).slice();
    const cached = await this.readPersistent(key);
    if (cached) {
      this.memory.set(key, cached);
      onProgress({ stage: 'download', label: 'Model z cache', loaded: cached.byteLength, total: cached.byteLength, progress: 100, cached: true });
      return cached.slice();
    }
    if (typeof this.fetcher !== 'function') throw new Error('Brak funkcji fetch do pobrania modelu.');
    const response = await this.fetcher(url, { cache: 'force-cache', signal });
    if (!response?.ok) throw new Error(`Model HTTP ${response?.status ?? 'error'}`);
    const bytes = await readResponse(response, { signal, onProgress });
    this.memory.set(key, bytes);
    await this.writePersistent(key, bytes, response.headers?.get?.('content-type') ?? 'application/octet-stream');
    return bytes.slice();
  }

  async delete(key) {
    this.memory.delete(key);
    if (!this.cacheStorage?.open) return false;
    const cache = await this.cacheStorage.open(this.cacheName);
    return cache.delete(cacheRequest(key));
  }

  async clear() {
    this.memory.clear();
    if (this.cacheStorage?.delete) await this.cacheStorage.delete(this.cacheName);
  }

  async readPersistent(key) {
    if (!this.cacheStorage?.open) return null;
    try {
      const cache = await this.cacheStorage.open(this.cacheName);
      const response = await cache.match(cacheRequest(key));
      return response ? new Uint8Array(await response.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  async writePersistent(key, bytes, contentType) {
    if (!this.cacheStorage?.open || typeof Response === 'undefined') return;
    try {
      const cache = await this.cacheStorage.open(this.cacheName);
      await cache.put(cacheRequest(key), new Response(bytes.slice(), { headers: { 'content-type': contentType } }));
    } catch {
      // CacheStorage może być niedostępne w trybie prywatnym; pamięć procesu nadal działa.
    }
  }
}

async function readResponse(response, { signal, onProgress }) {
  const total = Number(response.headers?.get?.('content-length')) || 0;
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress({ stage: 'download', label: 'Model', loaded: bytes.byteLength, total: bytes.byteLength, progress: 100, cached: false });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw abortError(signal.reason);
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ stage: 'download', label: 'Model', loaded, total, progress: total ? loaded / total * 100 : null, cached: false });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress({ stage: 'download', label: 'Model', loaded, total: total || loaded, progress: 100, cached: false });
  return bytes;
}

function cacheRequest(key) {
  return new Request(`https://localstudio.invalid/model-cache/${encodeURIComponent(key)}`);
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  return new DOMException(String(reason || 'Operacja anulowana.'), 'AbortError');
}
