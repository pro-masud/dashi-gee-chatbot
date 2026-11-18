import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { chunkKnowledgeText, sanitizeUserText } from '../../../../src/lib/chatbot/security';

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

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

    const fileName = sanitizeUserText(file.name || 'document.txt', 160);
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    let rawText = '';
    let sourceType: 'txt' | 'csv' | 'pdf' | 'docx' = 'txt';

    if (ext === 'txt' || ext === 'csv' || ext === 'md') {
      sourceType = ext === 'csv' ? 'csv' : 'txt';
      rawText = await file.text();
    } else if (ext === 'pdf') {
      sourceType = 'pdf';
      const buffer = new Uint8Array(await file.arrayBuffer());
      const parsed = await extractText(buffer, { mergePages: true });
      rawText = String(parsed.text || '');
    } else if (ext === 'docx') {
      sourceType = 'docx';
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await mammoth.extractRawText({ buffer });
      rawText = parsed.value || '';
    } else {
      return Response.json(
        { error: 'Unsupported format. Please upload .txt, .csv, .pdf, or .docx files.' },
        { status: 400 }
      );
    }

    const cleanContent = rawText
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

    const chunks = chunkKnowledgeText(cleanContent, 900);
    return Response.json({
      ok: true,
      fileName,
      sourceType,
      content: cleanContent,
      chunkCount: Math.max(1, chunks.length),
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
