export const MODEL_CONFIGS = {
  multilingual: {
    key: 'multilingual', label: 'Multilingual E5 Small',
    description: 'Najlepszy wybór dla polskich i wielojęzycznych dokumentów.',
    modelId: 'Xenova/multilingual-e5-small',
    modelUrl: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_uint8.onnx',
    queryPrefix: 'query: ', passagePrefix: 'passage: ', maxLength: 256,
    download: '~140 MB z tokenizerem'
  },
  lite: {
    key: 'lite', label: 'MiniLM Lite (English)',
    description: 'Szybszy i znacznie mniejszy model dla dokumentów po angielsku.',
    modelId: 'Xenova/all-MiniLM-L6-v2',
    modelUrl: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_uint8.onnx',
    queryPrefix: '', passagePrefix: '', maxLength: 256,
    download: '~24 MB z tokenizerem'
  }
};

export function normalizeWhitespace(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\t\f\v]+/g, ' ').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function chunkText(text, options = {}) {
  const maxChars = options.maxChars ?? 900;
  const overlapChars = options.overlapChars ?? 140;
  const clean = normalizeWhitespace(text);
  if (!clean) return [];
  const paragraphs = clean.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  const emit = () => {
    const value = current.trim();
    if (!value) return;
    chunks.push(value);
    current = value.slice(Math.max(0, value.length - overlapChars));
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current.trim()) emit();
      const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [paragraph];
      for (const sentence of sentences) {
        const candidate = `${current} ${sentence.trim()}`.trim();
        if (candidate.length > maxChars && current.trim()) emit();
        current = `${current} ${sentence.trim()}`.trim();
        while (current.length > maxChars * 1.35) {
          chunks.push(current.slice(0, maxChars).trim());
          current = current.slice(Math.max(1, maxChars - overlapChars));
        }
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current.trim()) emit();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((chunk, index) => index === 0 || chunk !== chunks[index - 1]);
}

export function normalizeVector(values) {
  const vector = values instanceof Float32Array ? values : Float32Array.from(values);
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  const result = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) result[index] = vector[index] / norm;
  return result;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let score = 0;
  for (let index = 0; index < a.length; index += 1) score += a[index] * b[index];
  return score;
}

export function keywordScore(query, text) {
  const terms = normalizeWhitespace(query).toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1);
  if (!terms.length) return 0;
  const haystack = normalizeWhitespace(text).toLocaleLowerCase();
  let matches = 0;
  for (const term of new Set(terms)) {
    const occurrences = haystack.split(term).length - 1;
    if (occurrences > 0) matches += 1 + Math.log1p(occurrences);
  }
  return Math.min(1, matches / (terms.length * 1.6));
}

export function rankChunks(chunks, queryVector, queryText, limit = 12) {
  return chunks.map((chunk) => {
    const semantic = queryVector && chunk.vector ? cosineSimilarity(queryVector, chunk.vector) : null;
    const lexical = keywordScore(queryText, chunk.text);
    const score = semantic === null ? lexical : semantic * 0.88 + lexical * 0.12;
    return { ...chunk, score, semantic, lexical };
  }).filter((chunk) => chunk.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
