import { NextRequest, NextResponse } from 'next/server';

async function extractPdf(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf');
  const { text } = await extractText(new Uint8Array(buffer));
  return Array.isArray(text) ? text.join('\n') : text;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const ext = file.name.split('.').pop()?.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    let text = '';

    if (ext === 'txt') {
      text = buffer.toString('utf-8');
    } else if (ext === 'pdf') {
      text = await extractPdf(buffer);
    } else if (ext === 'doc' || ext === 'docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    return NextResponse.json({ text });
  } catch (err: unknown) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : 'Unknown error';
    console.error('[extract-text] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
