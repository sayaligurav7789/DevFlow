
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function extractPdf(buffer) {
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
  }).promise;

  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      const pageText = content.items
        .filter((item) => typeof item.str === 'string')
        .map((item) => item.str)
        .join(' ');

      if (pageText.trim()) {
        pages.push(pageText);
      }

      page.cleanup();
    }

    return pages.join('\n\n').trim();
  } finally {
    await pdf.destroy();
  }
}

export async function extractDocumentText({
  fileName,
  mimeType,
  fileData,
}) {
  if (!Buffer.isBuffer(fileData) || !fileData.length) {
    throw new Error('Document file data is missing or invalid.');
  }

  const extension = fileName.split('.').pop()?.toLowerCase();

  if (
    mimeType === 'text/plain' ||
    extension === 'txt'
  ) {
    return fileData.toString('utf8').replace(/^\uFEFF/, '').trim();
  }

  if (
    ['text/markdown', 'text/x-markdown'].includes(mimeType) ||
    ['md', 'markdown'].includes(extension)
  ) {
    return fileData.toString('utf8').replace(/^\uFEFF/, '').trim();
  }

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return extractPdf(fileData);
  }

  if (mimeType === DOCX_MIME || extension === 'docx') {
    const result = await mammoth.extractRawText({
      buffer: fileData,
    });

    return String(result.value || '').trim();
  }

  const error = new Error(
    'Unsupported document format. Supported formats: PDF, DOCX, TXT and Markdown.'
  );

  error.status = 415;
  throw error;
}
