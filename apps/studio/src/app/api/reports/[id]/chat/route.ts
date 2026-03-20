import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exec, query, queryOne } from '@/lib/db';
import { readSecret } from '@/lib/vault';
import { getOutputLanguageLabel } from '@/lib/outputLanguage';
import {
  isOpenAIOfficialBase,
  supportsReasoningEffort,
  supportsTemperature,
} from '@/lib/aiModelCapabilities';
import { createRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { requireUser, unauthorized } from '@/services/auth';
import { requireReportAccess } from '@/services/orgs';
import { IntegrationResolutionError, resolveAIIntegration } from '@/services/integrations';
import { sanitizeAIConfig } from '@/services/integrations/ai-config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const rateLimiter = createRateLimiter(RATE_LIMITS.general);

interface ReportRow {
  project_id: string;
  score: number | null;
  summary: string | null;
  issues: Array<Record<string, unknown>> | null;
  project_name: string | null;
  project_repo: string | null;
}

type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
};

type ConversationRow = {
  id: string;
  issue_id: string | null;
  updated_at: string | null;
  messages: unknown;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id: reportId } = await params;
  const body = await request.json();
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
  const issueId = typeof body?.issueId === 'string' ? body.issueId : null;

  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  await requireReportAccess(reportId, user.id);

  const reportRow = await queryOne<ReportRow>(
    `select
      r.project_id,
      r.score,
      r.summary,
      r.issues,
      p.name as project_name,
      p.repo as project_repo
     from analysis_reports r
     join code_projects p on p.id = r.project_id
     where r.id = $1`,
    [reportId]
  );
  if (!reportRow) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  let conversation: ConversationRow | null = null;
  if (conversationId) {
    conversation = await queryOne<ConversationRow>(
      `select id, issue_id, messages
       , updated_at
       from analysis_conversations
       where id = $1 and report_id = $2`,
      [conversationId, reportId]
    );
  }
  if (!conversation) {
    conversation = await queryOne<ConversationRow>(
      `insert into analysis_conversations
       (report_id, issue_id, messages, created_at, updated_at)
       values ($1, $2, '[]'::jsonb, now(), now())
       returning id, issue_id, updated_at, messages`,
      [reportId, isUuid(issueId) ? issueId : null]
    );
  }
  if (!conversation) {
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
  }

  const messages = normalizeConversationMessages(conversation.messages);
  const issues = Array.isArray(reportRow.issues) ? reportRow.issues : [];
  const summary = typeof reportRow.summary === 'string' ? reportRow.summary : '';
  const score = typeof reportRow.score === 'number' ? reportRow.score : 0;

  let context = `You are a senior code reviewer assisting a developer with code quality questions.

## Project
- Name: ${reportRow.project_name}
- Repository: ${reportRow.project_repo}
- Overall score: ${score}/100

## Report summary
${summary}

## Issue stats
- Total issues: ${issues.length}
- Critical/high issues: ${issues.filter((item) => item.severity === 'critical' || item.severity === 'high').length}
`;

  if (issueId) {
    let issue: Record<string, unknown> | null = null;
    if (isUuid(issueId)) {
      issue = await queryOne<Record<string, unknown>>(
        `select * from analysis_issues where id = $1`,
        [issueId]
      );
    }
    if (!issue) {
      const ref = parseIssueReference(issueId);
      if (ref) {
        issue = issues.find((item) =>
          asString(item.file) === ref.file &&
          String(item.line ?? '') === ref.line &&
          asString(item.category) === ref.category &&
          asString(item.rule) === ref.rule &&
          (ref.message == null || asString(item.message) === ref.message)
        ) ?? null;
      } else {
        issue = issues.find((item) => asString(item.file) === issueId) ?? null;
      }
    }
    if (issue) {
      context += `\n## Focus issue
File: ${issue.file}
Line: ${issue.line ?? 'Unknown'}
Severity: ${issue.severity}
Category: ${issue.category}
Rule: ${issue.rule}
Issue: ${issue.message}
Suggestion: ${issue.suggestion ?? 'None'}
`;
      if (issue.code_snippet || issue.codeSnippet) {
        const snippet = (issue.code_snippet || issue.codeSnippet) as string;
        context += `\nCode snippet:\n\`\`\`\n${snippet}\n\`\`\`\n`;
      }
    }
  }

  let aiConfig: ReturnType<typeof sanitizeAIConfig>;
  let apiKey: string;
  try {
    const { integration } = await resolveAIIntegration(reportRow.project_id);
    aiConfig = sanitizeAIConfig(integration.config);
    apiKey = await readSecret(integration.vault_secret_name);
  } catch (error) {
    if (error instanceof IntegrationResolutionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'AI_INTEGRATION_REBIND_REQUIRED' ? 409 : 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve AI integration' },
      { status: 400 }
    );
  }

  context += `\nPlease respond in ${getOutputLanguageLabel(aiConfig.outputLanguage)} (${aiConfig.outputLanguage}) with clear, actionable guidance.`;

  const chatMessages: ChatMessage[] = [
    ...messages.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: message },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writeSSEEvent(controller, encoder, 'meta', { conversationId: conversation.id });

      void (async () => {
        let assistantMessage = '';
        try {
          for await (const chunk of requestChatCompletionStream({
            config: aiConfig,
            apiKey,
            system: context,
            messages: chatMessages,
            signal: request.signal,
          })) {
            if (!chunk) continue;
            assistantMessage += chunk;
            writeSSEEvent(controller, encoder, 'delta', { text: chunk });
          }

          if (!assistantMessage.trim()) {
            throw new Error('AI response missing text content');
          }

          const now = new Date().toISOString();
          const updatedMessages = [
            ...messages,
            { role: 'user', content: message, timestamp: now },
            { role: 'assistant', content: assistantMessage, timestamp: now },
          ];

          await exec(
            `update analysis_conversations
             set messages = $2, updated_at = now()
             where id = $1`,
            [conversation.id, JSON.stringify(updatedMessages)]
          );

          writeSSEEvent(controller, encoder, 'done', {
            conversationId: conversation.id,
            message: assistantMessage,
          });
        } catch (error) {
          if (!request.signal.aborted) {
            writeSSEEvent(controller, encoder, 'error', {
              error: error instanceof Error ? error.message : 'AI chat request failed',
            });
          }
        } finally {
          try {
            controller.close();
          } catch {
            // ignore double-close
          }
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = rateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await requireUser();
  if (!user) return unauthorized();

  const { id: reportId } = await params;
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversationId');
  const issueId = searchParams.get('issueId');
  const latestOnly = searchParams.get('latest') === '1';

  await requireReportAccess(reportId, user.id);

  if (conversationId) {
    const data = await queryOne<ConversationRow>(
      `select id, issue_id, messages
       , updated_at
       from analysis_conversations
       where id = $1 and report_id = $2`,
      [conversationId, reportId]
    );
    if (!data) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  if (issueId && isUuid(issueId)) {
    const data = await queryOne<ConversationRow>(
      `select id, issue_id, messages
       , updated_at
       from analysis_conversations
       where report_id = $1 and issue_id = $2
       order by updated_at desc
       limit 1`,
      [reportId, issueId]
    );
    return NextResponse.json(data ?? null);
  }

  if (latestOnly) {
    const data = await queryOne<ConversationRow>(
      `select id, issue_id, messages
       , updated_at
       from analysis_conversations
       where report_id = $1
       order by updated_at desc
       limit 1`,
      [reportId]
    );
    return NextResponse.json(data ?? null);
  }

  const data = await query<Record<string, unknown>>(
    `select id, issue_id, messages, updated_at
     from analysis_conversations
     where report_id = $1
     order by updated_at desc`,
    [reportId]
  );
  return NextResponse.json(data ?? []);
}

function writeSSEEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  payload: Record<string, unknown>
) {
  const text = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(encoder.encode(text));
}

function isUuid(value?: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeConversationMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ConversationMessage | null => {
      if (!item || typeof item !== 'object') return null;
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
        return null;
      }
      const timestamp = (item as { timestamp?: unknown }).timestamp;
      return {
        role,
        content,
        ...(typeof timestamp === 'string' ? { timestamp } : {}),
      };
    })
    .filter((item): item is ConversationMessage => item !== null);
}

function looksLikeHTML(contentType: string | null, bodySnippet: string): boolean {
  const lowerType = (contentType ?? '').toLowerCase();
  if (lowerType.includes('text/html')) return true;
  return bodySnippet.trim().startsWith('<');
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseIssueReference(
  issueId: string
): { file: string; line: string; category: string; rule: string; message?: string } | null {
  const value = issueId.trim();
  if (!value) return null;
  const parts = value.split('::');
  if (parts.length < 4) return null;

  const file = parts[0]?.trim();
  const line = parts[1]?.trim() ?? '';
  const category = parts[2]?.trim();
  const rule = parts[3]?.trim();
  const message = parts.length > 4 ? parts.slice(4).join('::').trim() : '';

  if (!file || !category || !rule) return null;
  return {
    file,
    line,
    category,
    rule,
    ...(message ? { message } : {}),
  };
}

function parseJSONLoose(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('invalid json');
  }
  const candidate = raw.slice(start, end + 1).trim();
  return JSON.parse(candidate) as Record<string, unknown>;
}

function extractErrorMessage(raw: string): string | null {
  try {
    const parsed = parseJSONLoose(raw);
    const top = asString(parsed.message);
    if (top) return top;
    const nested = parsed.error;
    if (!nested) return null;
    if (typeof nested === 'string') return nested;
    if (typeof nested !== 'object') return null;
    return asString((nested as Record<string, unknown>).message) ?? null;
  } catch {
    return null;
  }
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (REASONING_EFFORTS.has(normalized as ReasoningEffort)) {
    return normalized as ReasoningEffort;
  }
  return undefined;
}

function getReasoningEffort(
  value: unknown
): Exclude<ReasoningEffort, 'none'> | undefined {
  const effort = normalizeReasoningEffort(value);
  if (!effort || effort === 'none') return undefined;
  return effort;
}

function shouldUseResponsesAPIForChat(config: ReturnType<typeof sanitizeAIConfig>): boolean {
  if (!config.baseUrl || !isOpenAIOfficialBase(config.baseUrl)) return false;
  const effort = getReasoningEffort(config.reasoningEffort);
  return Boolean(effort) || supportsReasoningEffort(config.model);
}

function extractResponsesText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;

  if (typeof candidate.output_text === 'string' && candidate.output_text.trim()) {
    return candidate.output_text;
  }

  const output = candidate.output;
  if (!Array.isArray(output)) return null;

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const text = (block as Record<string, unknown>).text;
      if (typeof text === 'string' && text) {
        parts.push(text);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

async function* requestChatCompletionStream(input: {
  config: ReturnType<typeof sanitizeAIConfig>;
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): AsyncGenerator<string> {
  if (input.config.apiStyle === 'anthropic') {
    yield* requestAnthropicChatStream(input);
    return;
  }
  if (shouldUseResponsesAPIForChat(input.config)) {
    yield* requestOpenAIResponsesStream(input);
    return;
  }
  yield* requestOpenAIChatStream(input);
}

async function* requestAnthropicChatStream(input: {
  config: ReturnType<typeof sanitizeAIConfig>;
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): AsyncGenerator<string> {
  const base = requiredBaseUrl(input.config);
  const endpoint = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  const payload: Record<string, unknown> = {
    model: input.config.model,
    max_tokens: input.config.maxTokens ?? 4096,
    system: input.system,
    messages: input.messages,
    stream: true,
  };
  if (supportsTemperature(input.config.model)) {
    payload.temperature = input.config.temperature ?? 0.7;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
    signal: input.signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    const detail = extractErrorMessage(raw);
    throw new Error(
      detail
        ? `Anthropic API error: ${detail}`
        : `Anthropic API error: ${response.status} ${response.statusText}`
    );
  }
  if (!response.body) {
    throw new Error('Anthropic API stream body is empty');
  }

  for await (const dataLine of iterateSSEDataLines(response.body)) {
    if (!dataLine || dataLine === '[DONE]') continue;
    const parsed = safeJSONParse(dataLine);
    if (!parsed) continue;
    const type = asString(parsed.type);
    if (type !== 'content_block_delta') continue;

    const delta = parsed.delta;
    if (!delta || typeof delta !== 'object') continue;
    if (asString((delta as Record<string, unknown>).type) !== 'text_delta') continue;
    const text = asString((delta as Record<string, unknown>).text);
    if (text) yield text;
  }
}

async function* requestOpenAIChatStream(input: {
  config: ReturnType<typeof sanitizeAIConfig>;
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): AsyncGenerator<string> {
  const base = requiredBaseUrl(input.config);
  const payload: Record<string, unknown> = {
    model: input.config.model,
    messages: [{ role: 'system', content: input.system }, ...input.messages],
    max_tokens: input.config.maxTokens ?? 4096,
    stream: true,
  };
  if (supportsTemperature(input.config.model)) {
    payload.temperature = input.config.temperature ?? 0.7;
  }

  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: input.signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    const detail = extractErrorMessage(raw);
    throw new Error(
      detail
        ? `OpenAI API error: ${detail}`
        : `OpenAI API error: ${response.status} ${response.statusText}`
    );
  }
  if (!response.body) {
    throw new Error('OpenAI API stream body is empty');
  }

  for await (const dataLine of iterateSSEDataLines(response.body)) {
    if (!dataLine || dataLine === '[DONE]') continue;
    const parsed = safeJSONParse(dataLine);
    if (!parsed) continue;

    const choices = parsed.choices;
    if (!Array.isArray(choices) || choices.length === 0 || typeof choices[0] !== 'object' || !choices[0]) {
      continue;
    }
    const delta = (choices[0] as Record<string, unknown>).delta;
    if (!delta || typeof delta !== 'object') continue;
    const text = asString((delta as Record<string, unknown>).content);
    if (text) yield text;
  }
}

async function* requestOpenAIResponsesStream(input: {
  config: ReturnType<typeof sanitizeAIConfig>;
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): AsyncGenerator<string> {
  const base = requiredBaseUrl(input.config);
  const transcript = input.messages
    .map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`)
    .join('\n\n');

  const payload: Record<string, unknown> = {
    model: input.config.model,
    input: `${input.system}\n\nConversation:\n${transcript}\n\nAssistant:`,
    max_output_tokens: input.config.maxTokens ?? 4096,
    stream: true,
  };
  const effort = getReasoningEffort(input.config.reasoningEffort);
  if (effort && supportsReasoningEffort(input.config.model)) {
    payload.reasoning = { effort };
  }
  if (supportsTemperature(input.config.model)) {
    payload.temperature = input.config.temperature ?? 0.7;
  }

  const response = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: input.signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    const detail = extractErrorMessage(raw);
    throw new Error(
      detail
        ? `OpenAI Responses API error: ${detail}`
        : `OpenAI Responses API error: ${response.status} ${response.statusText}`
    );
  }
  if (!response.body) {
    const text = await requestOpenAIResponsesOnce(input);
    yield text;
    return;
  }

  let gotOutput = false;
  let completedResponse: unknown = null;

  for await (const dataLine of iterateSSEDataLines(response.body)) {
    if (!dataLine || dataLine === '[DONE]') continue;
    const parsed = safeJSONParse(dataLine);
    if (!parsed) continue;

    const type = asString(parsed.type);
    if (type === 'response.output_text.delta') {
      const delta = asString(parsed.delta);
      if (delta) {
        gotOutput = true;
        yield delta;
      }
      continue;
    }
    if (type === 'response.output_text.done') {
      const text = asString(parsed.text);
      if (text && !gotOutput) {
        gotOutput = true;
        yield text;
      }
      continue;
    }
    if (type === 'response.completed') {
      completedResponse = parsed.response;
    }
    if (type === 'error') {
      const message = extractErrorFromParsed(parsed);
      throw new Error(message ?? 'OpenAI Responses API stream failed');
    }
  }

  if (!gotOutput) {
    const recovered = extractResponsesText(completedResponse);
    if (recovered) {
      yield recovered;
      return;
    }
    const text = await requestOpenAIResponsesOnce(input);
    yield text;
  }
}

async function requestOpenAIResponsesOnce(input: {
  config: ReturnType<typeof sanitizeAIConfig>;
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): Promise<string> {
  const base = requiredBaseUrl(input.config);
  const transcript = input.messages
    .map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`)
    .join('\n\n');

  const payload: Record<string, unknown> = {
    model: input.config.model,
    input: `${input.system}\n\nConversation:\n${transcript}\n\nAssistant:`,
    max_output_tokens: input.config.maxTokens ?? 4096,
  };
  const effort = getReasoningEffort(input.config.reasoningEffort);
  if (effort && supportsReasoningEffort(input.config.model)) {
    payload.reasoning = { effort };
  }
  if (supportsTemperature(input.config.model)) {
    payload.temperature = input.config.temperature ?? 0.7;
  }

  const response = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: input.signal,
  });

  const raw = await response.text();
  if (!response.ok) {
    const detail = extractErrorMessage(raw);
    throw new Error(
      detail
        ? `OpenAI Responses API error: ${detail}`
        : `OpenAI Responses API error: ${response.status} ${response.statusText}`
    );
  }
  if (looksLikeHTML(response.headers.get('content-type'), raw)) {
    throw new Error('OpenAI Responses endpoint returned HTML instead of JSON');
  }

  const parsed = parseJSONLoose(raw);
  const text = extractResponsesText(parsed);
  if (!text) {
    throw new Error('OpenAI Responses response missing output text');
  }
  return text;
}

async function* iterateSSEDataLines(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const data = parseSSEData(chunk);
      if (data) {
        yield data;
      }
    }
  }

  if (buffer.trim()) {
    const data = parseSSEData(buffer);
    if (data) {
      yield data;
    }
  }
}

function requiredBaseUrl(config: ReturnType<typeof sanitizeAIConfig>): string {
  const value = config.baseUrl?.trim();
  if (!value) {
    throw new Error('AI integration base URL is required');
  }
  return value.replace(/\/+$/, '');
}

function parseSSEData(raw: string): string | null {
  const lines = raw.split('\n');
  const dataLines: string[] = [];

  for (const line of lines) {
    const normalized = line.trimEnd();
    if (normalized.startsWith('data:')) {
      dataLines.push(normalized.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join('\n');
}

function safeJSONParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractErrorFromParsed(parsed: Record<string, unknown>): string | null {
  const top = asString(parsed.message);
  if (top) return top;
  const nested = parsed.error;
  if (!nested) return null;
  if (typeof nested === 'string') return nested;
  if (typeof nested !== 'object') return null;
  return asString((nested as Record<string, unknown>).message) ?? null;
}
