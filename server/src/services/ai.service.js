
import { config } from '../config/env.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const TOTAL_RETRY_BUDGET_MS = 75_000;

function requireKey() {
  if (!config.ai.apiKey) {
    const error = new Error(
      'AI is not configured. Add GEMINI_API_KEY to server/.env and restart the server.'
    );
    error.status = 503;
    throw error;
  }
}

function getRetryDelay(response, attempt, remainingMs) {
  const retryAfter = response?.headers?.get('retry-after');
  let requestedDelay = 700 * (2 ** (attempt - 1));

  if (retryAfter) {
    const seconds = Number(retryAfter);
    const dateDelay = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now());

    if (Number.isFinite(dateDelay) && dateDelay > 0) {
      requestedDelay = dateDelay;
    }
  }

  // Add jitter to avoid simultaneous retries.
  const delay = Math.min(
    requestedDelay + Math.floor(Math.random() * 300),
    8_000
  );

  return Math.min(delay, Math.max(0, remainingMs));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeProviderError(data, status) {
  const providerMessage = data?.error?.message;
  let message = providerMessage ||
    'The AI provider could not complete the request.';

  if (status === 429) {
    message = /quota|limit|billing/i.test(message)
      ? 'Gemini API quota or rate limit reached. Check your Google AI Studio usage and try again later.'
      : 'Gemini is receiving too many requests. Please wait a moment and try again.';
  } else if ([500, 502, 503, 504].includes(status)) {
    message = 'Gemini is temporarily busy or unavailable. Please try again in a little while.';
  }

  const error = new Error(message);
  error.status = status === 429 ? 429 : 502;
  error.providerStatus = status;

  return error;
}

async function gemini(path, body) {
  requireKey();

  const startedAt = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = TOTAL_RETRY_BUDGET_MS -
      (Date.now() - startedAt);

    if (remainingMs <= 0) break;

    let response;
    let data;

    try {
      response = await fetch(
        `${API_BASE}/${path}?key=${encodeURIComponent(config.ai.apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(
            Math.min(REQUEST_TIMEOUT_MS, remainingMs)
          ),
        }
      );

      data = await response.json().catch(() => ({}));

      if (response.ok) {
        return data;
      }

      const status = response.status;
      lastError = makeProviderError(data, status);

      // Do not blindly retry 429 because it may indicate exhausted quota.
      const retryable = [500, 502, 503, 504].includes(status);

      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw lastError;
      }
    } catch (error) {
      if (error === lastError) {
        throw error;
      }

      lastError = error;

      const isTimeout =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError';

      const isNetworkError = error instanceof TypeError;

      if (
        (!isTimeout && !isNetworkError) ||
        attempt === MAX_ATTEMPTS
      ) {
        const wrapped = new Error(
          isTimeout
            ? 'Gemini took too long to respond. Please try again.'
            : 'Could not connect to Gemini. Check your internet connection and try again.'
        );

        wrapped.status = 502;
        wrapped.cause = error;

        throw wrapped;
      }
    }

    const remainingAfterRequest = TOTAL_RETRY_BUDGET_MS -
      (Date.now() - startedAt);

    if (remainingAfterRequest <= 0) break;

    const delay = response
      ? getRetryDelay(response, attempt, remainingAfterRequest)
      : Math.min(
          700 * (2 ** (attempt - 1)) +
            Math.floor(Math.random() * 300),
          remainingAfterRequest
        );

    await wait(delay);
  }

  if (lastError?.status) {
    throw lastError;
  }

  const timeoutError = new Error(
    'Gemini is taking longer than expected. Please try again shortly.'
  );

  timeoutError.status = 502;
  throw timeoutError;
}

export async function generateAnswer({ system, history, message }) {
  const contents = [
    ...history.slice(-8).map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    })),
    {
      role: 'user',
      parts: [{ text: message }],
    },
  ];

  const data = await gemini(`${config.ai.model}:generateContent`, {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 1200,
    },
  });

  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim() || 'I could not generate an answer. Please try again.';
}

export async function embedText(text) {
  const data = await gemini('gemini-embedding-001:embedContent', {
    model: 'models/gemini-embedding-001',
    content: {
      parts: [{ text }],
    },
    outputDimensionality: 768,
  });

  return data.embedding?.values || [];
}

export async function embedTexts(texts) {
  requireKey();

  if (!texts.length) return [];

  const data = await gemini(
    'gemini-embedding-001:batchEmbedContents',
    {
      requests: texts.map((text) => ({
        model: 'models/gemini-embedding-001',
        content: {
          parts: [{ text }],
        },
        outputDimensionality: 768,
      })),
    }
  );

  return (data.embeddings || []).map(
    (item) => item.values || []
  );
}

export function splitIntoChunks(text, size = 1200, overlap = 180) {
  const clean = String(text)
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .trim();

  const chunks = [];
  let start = 0;

  while (start < clean.length && chunks.length < 40) {
    let end = Math.min(clean.length, start + size);

    if (end < clean.length) {
      const boundary = clean.lastIndexOf('\n', end);

      if (boundary > start + size * 0.55) {
        end = boundary;
      }
    }

    const chunk = clean.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= clean.length) break;

    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

export function cosineSimilarity(a, b) {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length !== b.length ||
    !a.length
  ) {
    return -1;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }

  return normA && normB
    ? dot / (Math.sqrt(normA) * Math.sqrt(normB))
    : -1;
}
