export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_FORMAT = 'localstudio';
export const PROJECT_EXTENSION = '.localstudio';
export const PROJECT_MIME_TYPE = 'application/x-localstudio+json';

export class UnsupportedProjectVersionError extends Error {
  constructor(version) {
    super(`Projekt wymaga nowszej wersji LocalStudio (format ${version}, obsługiwany ${PROJECT_SCHEMA_VERSION}).`);
    this.name = 'UnsupportedProjectVersionError';
    this.version = version;
  }
}

export function createProjectRecord(options = {}) {
  const now = options.updatedAt ?? new Date().toISOString();
  const documentSnapshot = clonePlain(options.document ?? {});
  const id = String(options.id ?? documentSnapshot.id ?? createPortableId());
  return validateProjectRecord({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name: String(options.name ?? documentSnapshot.name ?? 'Bez nazwy'),
    createdAt: options.createdAt ?? documentSnapshot.createdAt ?? now,
    updatedAt: now,
    document: documentSnapshot,
    history: clonePlain(options.history ?? null),
    settings: clonePlain(options.settings ?? {}),
    assetIds: [...new Set(options.assetIds ?? referencedAssetIds(documentSnapshot))]
  });
}

export function validateProjectRecord(record) {
  if (!record || typeof record !== 'object') throw new TypeError('Projekt musi być obiektem.');
  const version = Number(record.schemaVersion ?? record.version ?? 0);
  if (version > PROJECT_SCHEMA_VERSION) throw new UnsupportedProjectVersionError(version);
  if (version < PROJECT_SCHEMA_VERSION) return migrateProjectRecord(record);
  if (!record.id) throw new Error('Projekt nie ma identyfikatora.');
  if (!record.document || typeof record.document !== 'object') throw new Error('Projekt nie zawiera dokumentu.');
  if (!Number.isFinite(Number(record.document.width)) || !Number.isFinite(Number(record.document.height))) throw new Error('Dokument projektu ma nieprawidłowe wymiary.');
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: String(record.id),
    name: String(record.name ?? record.document.name ?? 'Bez nazwy'),
    createdAt: normalizeDate(record.createdAt),
    updatedAt: normalizeDate(record.updatedAt),
    document: clonePlain(record.document),
    history: clonePlain(record.history ?? null),
    settings: clonePlain(record.settings ?? {}),
    assetIds: [...new Set((record.assetIds ?? referencedAssetIds(record.document)).map(String))]
  };
}

export function migrateProjectRecord(input) {
  let project = clonePlain(input);
  let version = Number(project.schemaVersion ?? project.version ?? 0);
  if (!Number.isInteger(version) || version < 0) throw new Error('Projekt ma nieprawidłową wersję formatu.');
  if (version > PROJECT_SCHEMA_VERSION) throw new UnsupportedProjectVersionError(version);
  while (version < PROJECT_SCHEMA_VERSION) {
    const migration = MIGRATIONS.get(version);
    if (!migration) throw new Error(`Brak migracji projektu z wersji ${version}.`);
    project = migration(project);
    version += 1;
  }
  return validateProjectRecord({ ...project, schemaVersion: PROJECT_SCHEMA_VERSION });
}

export function referencedAssetIds(documentSnapshot) {
  const ids = new Set();
  const visit = layer => {
    if (layer?.content?.assetId) ids.add(String(layer.content.assetId));
    if (layer?.mask?.assetId) ids.add(String(layer.mask.assetId));
    for (const child of layer?.children ?? []) visit(child);
  };
  for (const layer of documentSnapshot?.layers ?? []) visit(layer);
  if (documentSnapshot?.metadata?.legacySourceAssetId) ids.add(String(documentSnapshot.metadata.legacySourceAssetId));
  return [...ids];
}

export async function buildPortableProject(projectInput, assetsInput = new Map()) {
  const project = validateProjectRecord(projectInput);
  const assets = normalizeAssetMap(assetsInput);
  const portableAssets = [];
  for (const assetId of project.assetIds) {
    if (!assets.has(assetId)) throw new Error(`Brakuje zasobu projektu: ${assetId}.`);
    portableAssets.push(await encodePortableAsset(assetId, assets.get(assetId)));
  }
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    assets: portableAssets
  };
}

export async function stringifyPortableProject(projectInput, assetsInput) {
  return JSON.stringify(await buildPortableProject(projectInput, assetsInput));
}

export async function parsePortableProject(source) {
  const text = await sourceToText(source);
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error('Plik .localstudio nie zawiera poprawnego JSON.');
  }
  envelope = migratePortableEnvelope(envelope);
  if (envelope.format !== PROJECT_FORMAT) throw new Error('To nie jest plik projektu LocalStudio.');
  const version = Number(envelope.schemaVersion ?? 0);
  if (version > PROJECT_SCHEMA_VERSION) throw new UnsupportedProjectVersionError(version);
  const project = migrateProjectRecord(envelope.project);
  const assets = new Map();
  for (const asset of envelope.assets ?? []) {
    if (!asset?.assetId || typeof asset.data !== 'string') throw new Error('Plik projektu zawiera uszkodzony zasób.');
    assets.set(String(asset.assetId), decodePortableAsset(asset));
  }
  for (const assetId of project.assetIds) if (!assets.has(assetId)) throw new Error(`Plik projektu nie zawiera zasobu ${assetId}.`);
  return { project, assets, exportedAt: envelope.exportedAt ?? null };
}

export function projectFilename(name) {
  const base = String(name || 'projekt').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'projekt';
  return `${base}${PROJECT_EXTENSION}`;
}

const MIGRATIONS = new Map([
  [0, project => {
    const legacy = project.project && !project.document ? project.project : project;
    const document = clonePlain(legacy.document ?? legacy.snapshot ?? {});
    return {
      schemaVersion: 1,
      id: legacy.id ?? document.id ?? createPortableId(),
      name: legacy.name ?? document.name ?? 'Bez nazwy',
      createdAt: legacy.createdAt ?? document.createdAt,
      updatedAt: legacy.updatedAt ?? document.updatedAt,
      document,
      history: legacy.history ?? null,
      settings: legacy.settings ?? {},
      assetIds: legacy.assetIds ?? (Object.keys(legacy.assets ?? {}).length ? Object.keys(legacy.assets) : referencedAssetIds(document))
    };
  }]
]);

function migratePortableEnvelope(input) {
  if (!input || typeof input !== 'object') throw new Error('Plik projektu jest pusty.');
  if (input.format === PROJECT_FORMAT) return input;
  if (Number(input.version ?? input.schemaVersion ?? 0) === 0 && input.project) {
    const legacyAssets = input.assets ?? {};
    return {
      format: PROJECT_FORMAT,
      schemaVersion: 1,
      exportedAt: input.exportedAt ?? null,
      project: migrateProjectRecord(input.project),
      assets: Array.isArray(legacyAssets)
        ? legacyAssets
        : Object.entries(legacyAssets).map(([assetId, value]) => ({ assetId, type: value.type ?? 'application/octet-stream', data: value.data ?? value }))
    };
  }
  return input;
}

async function encodePortableAsset(assetId, value) {
  const blob = await toBlob(value);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { assetId, type: blob.type || 'application/octet-stream', size: bytes.byteLength, data: bytesToBase64(bytes) };
}
function decodePortableAsset(asset) {
  const bytes = base64ToBytes(asset.data);
  if (Number.isFinite(asset.size) && Number(asset.size) !== bytes.byteLength) throw new Error(`Zasób ${asset.assetId} ma nieprawidłowy rozmiar.`);
  return new Blob([bytes], { type: asset.type || 'application/octet-stream' });
}
async function toBlob(value) {
  if (value instanceof Blob) return value;
  if (value instanceof ArrayBuffer) return new Blob([value]);
  if (ArrayBuffer.isView(value)) return new Blob([value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)]);
  throw new TypeError('Nieobsługiwany typ zasobu projektu.');
}
function normalizeAssetMap(input) {
  if (input instanceof Map) return input;
  return new Map(Object.entries(input ?? {}));
}
async function sourceToText(source) {
  if (typeof source === 'string') return source;
  if (source instanceof Blob) return source.text();
  if (source instanceof ArrayBuffer) return new TextDecoder().decode(source);
  if (ArrayBuffer.isView(source)) return new TextDecoder().decode(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  throw new TypeError('Nieobsługiwane źródło projektu.');
}
function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function base64ToBytes(value) {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(value, 'base64'));
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}
function normalizeDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
function clonePlain(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function createPortableId() {
  if (globalThis.crypto?.randomUUID) return `project-${globalThis.crypto.randomUUID()}`;
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
