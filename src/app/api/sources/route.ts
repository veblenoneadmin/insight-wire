import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

async function ensureTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS saved_sources (
      id INT AUTO_INCREMENT PRIMARY KEY,
      url VARCHAR(2048) NOT NULL,
      title VARCHAR(512) NOT NULL,
      source_type VARCHAR(128) NOT NULL,
      rationale TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function GET() {
  try {
    await ensureTable();
    const [rows] = await pool.execute('SELECT * FROM saved_sources ORDER BY created_at DESC');
    return NextResponse.json({ sources: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { url, title, source_type, rationale } = body;
    if (!url || !title) {
      return NextResponse.json({ error: 'url and title are required' }, { status: 400 });
    }
    const [result] = await pool.execute(
      'INSERT INTO saved_sources (url, title, source_type, rationale) VALUES (?, ?, ?, ?)',
      [url, title, source_type || '', rationale || '']
    );
    return NextResponse.json({ id: (result as { insertId: number }).insertId }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
