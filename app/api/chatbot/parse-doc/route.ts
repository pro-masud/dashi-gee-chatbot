import { createHash } from 'crypto';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { buildOverlappingChunks } from '../../../../src/lib/chatbot/hybridRag';
import { sanitizeUserText } from '../../../../src/lib/chatbot/security';

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

const ALLOWED_EXTENSIONS = new Set(['txt', 'csv', 'md', 'pdf', 'docx']);

function hasPdfMagicBytes(buf: Uint8Array): boolean {
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 && // %
    buf[1] === 0x50 && // P
    buf[2] === 0x44 && // D
    buf[3] === 0x46 && // F
    buf[4] === 0x2d // -
  );
}

function hasZipMagicBytes(buf: Uint8Array): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 && // P
    buf[1] === 0x4b && // K
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
  );
}

function isPlainTextBufferValid(buf: Uint8Array): boolean {
  // Reject binary executables/archives disguised as .txt/.csv/.md
  if (hasPdfMagicBytes(buf) || hasZipMagicBytes(buf)) return false;
  // MZ (Windows PE) or ELF header
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return false;
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return false;
  }
  const sampleLen = Math.min(buf.length, 4096);
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0x00) return false; // Null byte indicates binary
  }
  return true;
}

function normalizeCsvToStructuredRows(csvRaw: string): string {
  const lines = csvRaw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return csvRaw;

  const parseCsvRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const headers = parseCsvRow(lines[0]);
  if (headers.length < 2) return csvRaw;
  const rows: string[] = [];
  for (let r = 1; r < lines.length; r++) {
    const vals = parseCsvRow(lines[r]);
    const pairs = headers
      .map((h, idx) => `${h}: ${vals[idx] ?? ''}`)
      .filter((p) => !p.endsWith(': '));
    if (pairs.length > 0) {
      rows.push(`Entry ${r}: ${pairs.join(' | ')}`);
    }
  }
  return rows.join('\n\n') || csvRaw;
}

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return Response.json({ error: 'Invalid request origin header.' }, { status: 403 });
  }

  const adminCheck = await verifyServerAdminToken(request.headers.get('authorization'));
  if (!adminCheck.ok) {
    return Response.json({ error: 'Admin authentication required.' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'Knowledge document file is required.' }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return Response.json(
        { error: 'File size must be between 1 byte and 4 MB.' },
        { status: 400 }
      );
    }

    const safeFileName =
      sanitizeUserText(file.name || 'document.txt', 160).replace(/[^a-zA-Z0-9._\-\s\u0980-\u09FF]/g, '_') ||
      'document.txt';
    const ext = safeFileName.split('.').pop()?.toLowerCase() || '';

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return Response.json(
        { error: 'Unsupported format. Please upload .txt, .md, .csv, .pdf, or .docx files.' },
        { status: 400 }
      );
    }

    const arrayBuf = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);
    const declaredMime = String(file.type || '').toLowerCase();

    let rawText = '';
    let sourceType: 'txt' | 'csv' | 'pdf' | 'docx' = 'txt';

    if (ext === 'pdf') {
      if (!hasPdfMagicBytes(uint8) || (declaredMime && !declaredMime.includes('pdf') && declaredMime !== 'application/octet-stream')) {
        return Response.json(
          { error: 'File signature does not match a valid PDF document.' },
          { status: 400 }
        );
      }
      sourceType = 'pdf';
      const parsed = await extractText(uint8, { mergePages: true });
      rawText = String(parsed.text || '');
    } else if (ext === 'docx') {
      if (!hasZipMagicBytes(uint8)) {
        return Response.json(
          { error: 'File signature does not match a valid DOCX document.' },
          { status: 400 }
        );
      }
      sourceType = 'docx';
      const buffer = Buffer.from(arrayBuf);
      const parsed = await mammoth.extractRawText({ buffer });
      rawText = parsed.value || '';
    } else {
      if (!isPlainTextBufferValid(uint8)) {
        return Response.json(
          { error: 'File appears to contain binary payload rather than valid UTF-8 text.' },
          { status: 400 }
        );
      }
      sourceType = ext === 'csv' ? 'csv' : 'txt';
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(uint8);
      rawText = sourceType === 'csv' ? normalizeCsvToStructuredRows(decoded) : decoded;
    }

    const cleanContent = rawText
      .normalize('NFC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 60000);

    if (cleanContent.length < 10) {
      return Response.json(
        { error: 'Document contained too little readable text (minimum 10 characters).' },
        { status: 400 }
      );
    }

    const contentHash = createHash('sha256').update(cleanContent).digest('hex').slice(0, 24);
    const chunks = buildOverlappingChunks(cleanContent);

    return Response.json({
      ok: true,
      fileName: safeFileName,
      sourceType,
      content: cleanContent,
      contentHash,
      chunkCount: Math.max(1, chunks.length),
      chunks,
      charCount: cleanContent.length,
    });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Failed to extract text: ${err.message.slice(0, 120)}`
            : 'Failed to parse uploaded document.',
      },
      { status: 500 }
    );
  }
}
