/**
 * AI Client implementations
 */

import type {
  AIClient,
  AIConfigWithSecret,
  AnalysisResult,
  AIConnectionTestResult,
  AIProvider,
} from './types';
import { asJsonObject, type JsonObject } from '@/lib/json';
import { isOpenAIOfficialBase, supportsReasoningEffort, supportsTemperature } from '@/lib/aiModelCapabilities';

type ReasoningEffort = NonNullable<AIConfigWithSecret['reasoningEffort']>;
type APIStyle = NonNullable<AIConfigWithSecret['apiStyle']>;

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

const API_STYLES = new Set<APIStyle>(['openai', 'anthropic']);

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (REASONING_EFFORTS.has(normalized as ReasoningEffort)) {
    return normalized as ReasoningEffort;
  }
  return undefined;
}

function normalizeAPIStyle(value: unknown): APIStyle {
  if (typeof value !== 'string') {
    throw new Error('AI apiStyle is required');
  }
  const normalized = value.trim().toLowerCase();
  if (API_STYLES.has(normalized as APIStyle)) {
    return normalized as APIStyle;
  }
  throw new Error('AI apiStyle must be either "openai" or "anthropic"');
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
  const candidate = asJsonObject(data);
  if (!candidate) return null;

  if (typeof candidate.output_text === 'string' && candidate.output_text.trim()) {
    return candidate.output_text;
  }

  const output = candidate.output;
  if (!Array.isArray(output)) return null;

  const parts: string[] = [];
  for (const item of output) {
    const itemObject = asJsonObject(item);
    const content = itemObject?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      const text = asJsonObject(block)?.text;
      if (typeof text === 'string' && text) {
        parts.push(text);
      }
    }
  }

  if (parts.length === 0) return null;
  return parts.join('\n');
}

function looksLikeHTML(contentType: string | null, bodySnippet: string): boolean {
  const lowerType = (contentType ?? '').toLowerCase();
  if (lowerType.includes('text/html')) return true;
  return bodySnippet.trim().startsWith('<');
}

function extractJSONText(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return raw;
  }
  return raw.slice(start, end + 1);
}

function parseJSONLoose(raw: string): JsonObject {
  const candidate = extractJSONText(raw).trim();
  const parsed = JSON.parse(candidate);
  const object = asJsonObject(parsed);
  if (!object) {
    throw new Error('Expected JSON object response');
  }
  return object;
}

function modelsCompatible(expected: string, observed?: string): boolean {
  if (!observed) return false;
  const left = expected.trim().toLowerCase();
  const right = observed.trim().toLowerCase();
  if (!left || !right) return false;
  return left === right || right.startsWith(`${left}-`) || left.startsWith(`${right}-`);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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
  private apiStyle: APIStyle;

  constructor(config: AIConfigWithSecret) {
    this.config = config;
    this.apiStyle = normalizeAPIStyle(config.apiStyle);
    this.isAnthropic = this.apiStyle === 'anthropic';
    this.useResponsesAPI = !this.isAnthropic && shouldUseResponsesAPI(config);
  }

  async testConnection(): Promise<AIConnectionTestResult> {
    if (this.useResponsesAPI) {
      return this.testWithResponsesAPI();
    }
    return this.testWithChatCompletions();
  }

  private async testWithResponsesAPI(): Promise<AIConnectionTestResult> {
    const endpoint = `${this.config.baseUrl}/responses`;
    const payload: JsonObject = {
      model: this.config.model,
      input: 'Return ONLY JSON: {"ok":true,"probe":"connectivity"}',
      max_output_tokens: 64,
    };
    const effort = getReasoningEffort(this.config);
    if (effort && supportsReasoningEffort(this.config.model)) {
      payload.reasoning = { effort };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`AI test request failed: ${response.status} ${response.statusText}`);
    }
    if (looksLikeHTML(response.headers.get('content-type'), raw)) {
      throw new Error(
        'AI baseUrl returned HTML instead of JSON. Use provider API base URL, not a web console URL.'
      );
    }

    const parsed = parseJSONLoose(raw);
    const outputText = extractResponsesText(parsed);
    if (!outputText) {
      throw new Error('AI test response missing output text');
    }

    let structured = false;
    try {
      const probe = parseJSONLoose(outputText);
      structured = probe.ok === true;
    } catch {
      structured = false;
    }
    if (!structured) {
      throw new Error('AI test failed: model did not return required JSON probe');
    }

    const observedModel = asString(parsed.model);
    const warnings: string[] = [];
    const modelMetadata = modelsCompatible(this.config.model, observedModel);
    if (!observedModel) {
      warnings.push('Provider response did not include model metadata');
    } else if (!modelMetadata) {
      warnings.push(`Configured model "${this.config.model}" differs from response model "${observedModel}"`);
    }

    return {
      success: true,
      endpoint,
      expectedModel: this.config.model,
      ...(observedModel ? { observedModel } : {}),
      checks: {
        protocol: true,
        structuredOutput: true,
        modelMetadata,
      },
      warnings,
    };
  }

  private async testWithChatCompletions(): Promise<AIConnectionTestResult> {
    const endpoint = this.isAnthropic
      ? (() => {
        const base = (this.config.baseUrl || '').replace(/\/+$/, '');
        return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
      })()
      : `${this.config.baseUrl}/chat/completions`;
    const payload: JsonObject = this.isAnthropic
      ? {
        model: this.config.model,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Return ONLY JSON: {"ok":true,"probe":"connectivity"}' }],
      }
      : {
        model: this.config.model,
        messages: [{ role: 'user', content: 'Return ONLY JSON: {"ok":true,"probe":"connectivity"}' }],
        max_tokens: 64,
      };

    if (!this.isAnthropic && supportsTemperature(this.config.model)) {
      payload.temperature = 0;
    }

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.isAnthropic) {
      headers['x-api-key'] = this.config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`AI test request failed: ${response.status} ${response.statusText}`);
    }
    if (looksLikeHTML(response.headers.get('content-type'), raw)) {
      throw new Error(
        'AI baseUrl returned HTML instead of JSON. Use provider API base URL, not a web console URL.'
      );
    }

    const parsed = parseJSONLoose(raw);
    let modelText = '';
    if (this.isAnthropic) {
      const content = parsed.content;
      if (!Array.isArray(content) || content.length === 0 || typeof content[0] !== 'object' || !content[0]) {
        throw new Error('AI test response missing content');
      }
      modelText = asString(asJsonObject(content[0])?.text) ?? '';
    } else {
      const choices = parsed.choices;
      if (!Array.isArray(choices) || choices.length === 0 || typeof choices[0] !== 'object' || !choices[0]) {
        throw new Error('AI test response missing choices');
      }
      const message = asJsonObject(asJsonObject(choices[0])?.message);
      modelText = asString(message?.content) ?? '';
    }
    if (!modelText) {
      throw new Error('AI test response missing model message content');
    }

    let structured = false;
    try {
      const probe = parseJSONLoose(modelText);
      structured = probe.ok === true;
    } catch {
      structured = false;
    }
    if (!structured) {
      throw new Error('AI test failed: model did not return required JSON probe');
    }

    const observedModel = asString(parsed.model);
    const warnings: string[] = [];
    const modelMetadata = modelsCompatible(this.config.model, observedModel);
    if (!observedModel) {
      warnings.push('Provider response did not include model metadata');
    } else if (!modelMetadata) {
      warnings.push(`Configured model "${this.config.model}" differs from response model "${observedModel}"`);
    }

    return {
      success: true,
      endpoint,
      expectedModel: this.config.model,
      ...(observedModel ? { observedModel } : {}),
      checks: {
        protocol: true,
        structuredOutput: true,
        modelMetadata,
      },
      warnings,
    };
  }

  async analyze(prompt: string, code: string): Promise<AnalysisResult> {
    try {
      if (this.isAnthropic) {
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

    const payload: JsonObject = {
      model: this.config.model,
      max_tokens: this.config.maxTokens || 4096,
      messages: [{ role: 'user', content: fullPrompt }],
    };
    if (supportsTemperature(this.config.model)) {
      payload.temperature = this.config.temperature ?? 0.7;
    }

    const base = (this.config.baseUrl || '').replace(/\/+$/, '');
    const endpoint = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }
    if (looksLikeHTML(response.headers.get('content-type'), raw)) {
      throw new Error('Anthropic endpoint returned HTML instead of JSON');
    }

    const parsed = parseJSONLoose(raw);
    const contentBlocks = parsed.content;
    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
      throw new Error('Anthropic response missing content');
    }
    const firstBlock = asJsonObject(contentBlocks[0]);
    const content = asString(firstBlock?.text) ?? '';
    if (!content.trim()) {
      throw new Error('Anthropic response missing text content');
    }
    return parseAnalysisContent(content);
  }

  private async analyzeWithOpenAI(prompt: string, code: string): Promise<AnalysisResult> {
    // When code is empty the caller has already embedded the full content in prompt
    const fullPrompt = code
      ? `${prompt}\n\nCode to analyze:\n\`\`\`\n${code}\n\`\`\`\n\nPlease provide your analysis in JSON format.`
      : prompt;

    if (this.useResponsesAPI) {
      const body: JsonObject = {
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

    const body: JsonObject = {
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

    if (this.isAnthropic) {
      const body: JsonObject = {
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        messages: [{ role: 'user', content: fullPrompt }],
        stream: true,
      };
      if (supportsTemperature(this.config.model)) {
        body.temperature = this.config.temperature ?? 0.7;
      }

      const base = (this.config.baseUrl || '').replace(/\/+$/, '');
      const endpoint = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start Anthropic streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const eventChunk of events) {
          const dataLines = eventChunk
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6));
          for (const dataLine of dataLines) {
            if (!dataLine || dataLine === '[DONE]') continue;
            try {
              const parsed = asJsonObject(JSON.parse(dataLine));
              if (!parsed) continue;
              const type = asString(parsed.type);
              if (type !== 'content_block_delta') continue;
              const delta = asJsonObject(parsed.delta);
              if (!delta) continue;
              if (asString(delta.type) !== 'text_delta') continue;
              const text = asString(delta.text);
              if (text) yield text;
            } catch {
              // ignore malformed stream event
            }
          }
        }
      }
    } else if (this.useResponsesAPI) {
      // Fallback to non-stream Responses API and yield once.
      const result = await this.analyzeWithOpenAI(prompt, code);
      yield result.summary;
    } else {
      const body: JsonObject = {
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
