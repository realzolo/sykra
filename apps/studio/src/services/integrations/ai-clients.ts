/**
 * AI Client implementations
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AIClient, AIConfigWithSecret, AnalysisResult, AIProvider } from './types';

type ReasoningEffort = NonNullable<AIConfigWithSecret['reasoningEffort']>;

/**
 * Models that do not support the `temperature` parameter.
 * Includes OpenAI reasoning models and DeepSeek reasoner.
 */
const NO_TEMPERATURE_MODELS = new Set([
  'o1', 'o1-mini', 'o1-preview',
  'o3', 'o3-mini',
  'o4-mini',
  'codex',
  'codex-latest',
  'codex-mini-latest',
  'deepseek-reasoner',
]);

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

const REASONING_MODEL_PREFIXES = ['o', 'gpt-5', 'codex'];

function supportsTemperature(model: string): boolean {
  for (const m of NO_TEMPERATURE_MODELS) {
    if (model === m || model.startsWith(`${m}-`)) return false;
  }
  return true;
}

function supportsReasoningEffort(model: string): boolean {
  const normalizedModel = model.trim().toLowerCase();
  return REASONING_MODEL_PREFIXES.some((prefix) => (
    normalizedModel === prefix || normalizedModel.startsWith(`${prefix}-`)
  ));
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (REASONING_EFFORTS.has(normalized as ReasoningEffort)) {
    return normalized as ReasoningEffort;
  }
  return undefined;
}

function isOpenAIOfficialBase(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

function getReasoningEffort(config: AIConfigWithSecret): Exclude<ReasoningEffort, 'none'> | undefined {
  const effort = normalizeReasoningEffort(config.reasoningEffort);
  if (!effort || effort === 'none') return undefined;
  return effort;
}

function shouldUseResponsesAPI(config: AIConfigWithSecret): boolean {
  if (!isOpenAIOfficialBase(config.baseUrl)) return false;
  const effort = getReasoningEffort(config);
  return Boolean(effort) || supportsReasoningEffort(config.model);
}

function parseAnalysisContent(content: string): AnalysisResult {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // fall through to plain-text fallback
    }
  }

  return { summary: content, score: 70, categoryScores: {}, issues: [] };
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

  if (parts.length === 0) return null;
  return parts.join('\n');
}

function isAsyncIterable<T = unknown>(value: unknown): value is AsyncIterable<T> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Symbol.asyncIterator in value &&
      typeof (value as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function'
  );
}

/**
 * OpenAI API-format AI client.
 * Supports Anthropic, OpenAI, DeepSeek, and other providers.
 */
export class OpenAIAPIClient implements AIClient {
  provider: AIProvider = 'openai-api';
  private config: AIConfigWithSecret;
  private isAnthropic: boolean;
  private useResponsesAPI: boolean;
  private anthropicClient: Anthropic | null = null;

  constructor(config: AIConfigWithSecret) {
    this.config = config;
    this.isAnthropic = (config.baseUrl || '').includes('anthropic.com');
    this.useResponsesAPI = shouldUseResponsesAPI(config);

    if (this.isAnthropic) {
      this.anthropicClient = new Anthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (this.isAnthropic && this.anthropicClient) {
        const response = await this.anthropicClient.messages.create({
          model: this.config.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        });
        return !!response;
      }

      if (this.useResponsesAPI) {
        const body: Record<string, unknown> = {
          model: this.config.model,
          input: 'hi',
          max_output_tokens: 16,
        };
        const effort = getReasoningEffort(this.config);
        if (effort && supportsReasoningEffort(this.config.model)) {
          body.reasoning = { effort };
        }

        const response = await fetch(`${this.config.baseUrl}/responses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        return response.ok;
      }

      // Send a minimal chat completion for health checks
      // (more reliable than GET /models which many providers don't implement)
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      };
      if (supportsTemperature(this.config.model)) {
        body.temperature = 0;
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch (error) {
      console.error('AI connection test failed:', error);
      return false;
    }
  }

  async analyze(prompt: string, code: string): Promise<AnalysisResult> {
    try {
      if (this.isAnthropic && this.anthropicClient) {
        return await this.analyzeWithAnthropic(prompt, code);
      }
      return await this.analyzeWithOpenAI(prompt, code);
    } catch (error) {
      console.error('AI analysis failed:', error);
      throw new Error('Failed to analyze code with AI');
    }
  }

  private async analyzeWithAnthropic(prompt: string, code: string): Promise<AnalysisResult> {
    // When code is empty the caller has already embedded the full content in prompt
    const schema = `{
  "summary": "Overall summary of the code quality",
  "score": 85,
  "categoryScores": { "style": 90, "security": 80, "architecture": 85, "performance": 85, "maintainability": 80 },
  "issues": [{ "category": "security", "severity": "error", "message": "Issue description", "file": "path/to/file.ts", "line": 42 }]
}`;
    const fullPrompt = code
      ? `${prompt}\n\nCode to analyze:\n\`\`\`\n${code}\n\`\`\`\n\nPlease provide your analysis in JSON format with the following structure:\n${schema}`
      : prompt;

    const params: Parameters<Anthropic['messages']['create']>[0] = {
      model: this.config.model,
      max_tokens: this.config.maxTokens || 4096,
      messages: [{ role: 'user', content: fullPrompt }],
    };
    if (supportsTemperature(this.config.model)) {
      params.temperature = this.config.temperature ?? 0.7;
    }

    const response = await this.anthropicClient!.messages.create(params);
    if (!('content' in response)) {
      throw new Error('Unexpected streaming response from Anthropic');
    }

    const content = (response.content[0] as { text: string }).text;
    return parseAnalysisContent(content);
  }

  private async analyzeWithOpenAI(prompt: string, code: string): Promise<AnalysisResult> {
    // When code is empty the caller has already embedded the full content in prompt
    const fullPrompt = code
      ? `${prompt}\n\nCode to analyze:\n\`\`\`\n${code}\n\`\`\`\n\nPlease provide your analysis in JSON format.`
      : prompt;

    if (this.useResponsesAPI) {
      const body: Record<string, unknown> = {
        model: this.config.model,
        input: fullPrompt,
        max_output_tokens: this.config.maxTokens || 4096,
      };
      const effort = getReasoningEffort(this.config);
      if (effort && supportsReasoningEffort(this.config.model)) {
        body.reasoning = { effort };
      }

      const response = await fetch(`${this.config.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const errBody = await response.json();
          detail = errBody?.error?.message || errBody?.message || detail;
        } catch {
          // ignore parse failure, keep statusText
        }
        throw new Error(`OpenAI Responses API error: ${detail}`);
      }

      const data = await response.json();
      const content = extractResponsesText(data);
      if (!content) {
        throw new Error('OpenAI Responses API response missing output text');
      }
      return parseAnalysisContent(content);
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [{ role: 'user', content: fullPrompt }],
      max_tokens: this.config.maxTokens || 4096,
    };
    if (supportsTemperature(this.config.model)) {
      body.temperature = this.config.temperature ?? 0.7;
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errBody = await response.json();
        detail = errBody?.error?.message || errBody?.message || detail;
      } catch {
        // ignore parse failure, keep statusText
      }
      throw new Error(`OpenAI API error: ${detail}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('OpenAI chat completion response missing message content');
    }
    return parseAnalysisContent(content);
  }

  async *streamAnalyze(prompt: string, code: string): AsyncGenerator<string> {
    const fullPrompt = `${prompt}\n\nCode to analyze:\n\`\`\`\n${code}\n\`\`\``;

    if (this.isAnthropic && this.anthropicClient) {
      const params: Parameters<Anthropic['messages']['create']>[0] = {
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        messages: [{ role: 'user', content: fullPrompt }],
        stream: true,
      };
      if (supportsTemperature(this.config.model)) {
        params.temperature = this.config.temperature ?? 0.7;
      }

      const stream = await this.anthropicClient.messages.create(params);
      if (!isAsyncIterable(stream)) {
        throw new Error('Unexpected non-stream response from Anthropic');
      }
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
    } else if (this.useResponsesAPI) {
      // Fallback to non-stream Responses API and yield once.
      const result = await this.analyzeWithOpenAI(prompt, code);
      yield result.summary;
    } else {
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages: [{ role: 'user', content: fullPrompt }],
        max_tokens: this.config.maxTokens || 4096,
        stream: true,
      };
      if (supportsTemperature(this.config.model)) {
        body.temperature = this.config.temperature ?? 0.7;
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((line) => line.trim().startsWith('data: '));

        for (const line of lines) {
          const data = line.replace('data: ', '');
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // skip invalid JSON chunks
          }
        }
      }
    }
  }
}
