import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import BNA_STYLE_PROFILE from '@/lib/bna-style-profile';
import { WORKFLOW_SECTIONS } from '@/lib/insightwire-workflow';

async function scrapeUrl(url: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const text = await res.text();
  return text.split(/\s+/).slice(0, 3500).join(' ');
}

// Build source content blocks following the workflow's hard source injection format
function buildSourceBlocks(
  scrapedSources: { label: string; text: string }[],
  fileBlocks: { label: string; text: string }[],
): string[] {
  return [...scrapedSources, ...fileBlocks].map(
    (s, i) => `[SOURCE ${i + 1} — ${s.label}]\n${s.text}`
  );
}

// Prompt for brief generation (Workflow Sections 2 + 4)
const BRIEF_SYSTEM_PROMPT = `${WORKFLOW_SECTIONS.HARD_SOURCES}

${WORKFLOW_SECTIONS.BRIEF_GENERATION}

You are an editorial assistant for Business News Australia. Generate a brief from the hard sources provided. The brief must be 3–5 sentences and must surface:
- The main news hook — what happened, who did it, and why it matters.
- Key figures and dollar amounts.
- Who is quoted — named individuals and their roles.
- Gaps or contradictions — anything missing or conflicting between sources.

Do not use any external knowledge. Use only the hard sources provided. Output the brief only.`;

// Prompt for article generation (Workflow Sections 2 + 5 + 6 + BNA style guide)
const ARTICLE_SYSTEM_PROMPT = `${WORKFLOW_SECTIONS.HARD_SOURCES}

${WORKFLOW_SECTIONS.ARTICLE_GENERATION}

${WORKFLOW_SECTIONS.REFERENCES}

${BNA_STYLE_PROFILE}

You are a journalist for Business News Australia. Using the confirmed brief and the hard sources, generate a complete BNA-style article.

Rules:
- Use hard sources only. No external knowledge. No inference. No gap-filling.
- Follow the BNA style guide exactly for structure, tone, headlines, attribution, and formatting.
- Every claim, quote, and figure must be traceable to a hard source.
- Do not editorialise. Do not insert opinion or speculation.
- Generate 3–5 headline variants labelled by pattern type.
- End on a quote, financial metric, or share price note — never a summary paragraph.

After the article, return the references as a JSON array inside a fenced code block tagged json:references.
After the references, return the fact-check checklist as a JSON array inside a fenced code block tagged json:checklist.
After the checklist, add an "Editor Q&A" section with 3 suggested follow-up questions.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
    }
    const client = new Anthropic({ apiKey });

    const body = await req.json();
    const articles: { sources: string[]; topic: string; categorical?: boolean; fileContents?: string[] }[] = body.articles || [];

    const results = [];

    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];

      // ── Step 1: Gather hard sources ──────────────────────
      const scrapedSources: { label: string; text: string }[] = [];
      for (const src of art.sources || []) {
        if (src.trim()) {
          try {
            const text = await scrapeUrl(src.trim());
            scrapedSources.push({ label: `${src} (URL)`, text });
          } catch {
            scrapedSources.push({ label: `${src} (URL)`, text: '[Failed to fetch — URL may be paywalled or unavailable]' });
          }
        }
      }

      const fileBlocks = (art.fileContents || []).map((text, fi) => ({
        label: `Uploaded file ${fi + 1} (document)`,
        text: text.split(/\s+/).slice(0, 3500).join(' '),
      }));

      const sourceBlocks = buildSourceBlocks(scrapedSources, fileBlocks);
      const topicBlock = art.topic ? `ANGLE/FOCUS: ${art.topic}\n\n` : '';

      // ── Categorical mode: no sources, use topic directly ──
      if (art.categorical) {
        const message = await client.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 4000,
          system: BNA_STYLE_PROFILE,
          messages: [{
            role: 'user',
            content: `${topicBlock}Write an original BNA-style article on the topic above. No source material provided — draw on your knowledge of the subject. Output the article only.`,
          }],
        });
        const articleText = message.content[0]?.type === 'text' ? message.content[0].text : '';
        results.push({ index: i, topic: art.topic || '', articleText });
        continue;
      }

      // ── Step 2: Generate brief from hard sources ─────────
      const sourceContent = sourceBlocks.map(b => ({ type: 'text' as const, text: b }));

      const briefMessage = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1000,
        system: BRIEF_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `${topicBlock}Here are the hard sources for this article:` },
            ...sourceContent,
            { type: 'text', text: 'Generate the brief based on these sources only.' },
          ],
        }],
      });

      const brief = briefMessage.content[0]?.type === 'text' ? briefMessage.content[0].text : '';

      // ── Step 3: Generate article from brief + sources ────
      const articleMessage = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4000,
        system: ARTICLE_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `${topicBlock}CONFIRMED BRIEF:\n${brief}\n\nHere are the hard sources:` },
            ...sourceContent,
            { type: 'text', text: 'Generate the full BNA-style article based on the confirmed brief and hard sources. Include references JSON, fact-check checklist JSON, and Editor Q&A.' },
          ],
        }],
      });

      const fullOutput = articleMessage.content[0]?.type === 'text' ? articleMessage.content[0].text : '';

      // ── Step 4: Parse output blocks ──────────────────────
      // Extract article body (everything before first json: block)
      const articleBody = fullOutput.split(/```json:references/)[0]?.trim() ?? fullOutput;

      // Extract references JSON
      const refsMatch = fullOutput.match(/```json:references\s*\n([\s\S]*?)```/);
      let references = null;
      if (refsMatch) {
        try { references = JSON.parse(refsMatch[1].trim()); } catch { /* ignore parse errors */ }
      }

      // Extract checklist JSON
      const checkMatch = fullOutput.match(/```json:checklist\s*\n([\s\S]*?)```/);
      let checklist = null;
      if (checkMatch) {
        try { checklist = JSON.parse(checkMatch[1].trim()); } catch { /* ignore parse errors */ }
      }

      // Extract Editor Q&A (everything after last ``` block)
      const editorQA = fullOutput.split(/```\s*\n/).pop()?.trim() ?? '';

      results.push({
        index: i,
        topic: art.topic || '',
        articleText: articleBody,
        brief,
        references,
        checklist,
        editorQA,
      });
    }

    return NextResponse.json({ articles: results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[generate-articles-4] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
