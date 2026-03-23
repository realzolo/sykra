import type { AIConfig } from './types';
import { asJsonObject } from '@/lib/json';
import { parseOutputLanguage } from '@/lib/outputLanguage';

const WEB_UI_HOSTS = new Set([
  'platform.openai.com',
  'chat.openai.com',
  'openai.com',
  'www.openai.com',
]);

const ENDPOINT_SUFFIXES = [
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages',
  '/chat/completions',
  '/responses',
  '/messages',
];


function trimEndpointSuffix(pathname: string): string {
  let path = pathname;
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (path.endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }
  return path;
}

export function normalizeAIBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('AI baseUrl is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error('AI baseUrl must be a valid absolute URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('AI baseUrl must use http or https');
  }

  const host = parsed.hostname.toLowerCase();
  if (WEB_UI_HOSTS.has(host)) {
    throw new Error(
      'AI baseUrl points to a web site, not an API endpoint. Use an API URL such as https://api.openai.com/v1.'
    );
  }

  let path = trimEndpointSuffix(parsed.pathname.replace(/\/+$/, ''));
  if (host === 'api.openai.com' && (path === '' || path === '/')) {
    path = '/v1';
  }

  parsed.pathname = path || '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

export function sanitizeAIConfig(input: unknown): AIConfig {
  const raw = asJsonObject(input);
  if (!raw) {
    throw new Error('AI config is required');
  }
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!model) {
    throw new Error('AI model is required');
  }

  const next: AIConfig = {
    model,
    baseUrl: normalizeAIBaseUrl(raw.baseUrl),
    apiStyle: 'openai',
    outputLanguage: parseOutputLanguage(raw.outputLanguage),
  };

  if (typeof raw.apiStyle !== 'string') {
    throw new Error('AI apiStyle is required');
  }
  const apiStyle = raw.apiStyle.trim().toLowerCase();
  if (apiStyle !== 'openai' && apiStyle !== 'anthropic') {
    throw new Error('AI apiStyle must be either "openai" or "anthropic"');
  }
  next.apiStyle = apiStyle;

  if (typeof raw.maxTokens === 'number' && Number.isFinite(raw.maxTokens)) {
    const maxTokens = Math.trunc(raw.maxTokens);
    if (maxTokens > 0) next.maxTokens = maxTokens;
  }

  if (typeof raw.temperature === 'number' && Number.isFinite(raw.temperature)) {
    next.temperature = raw.temperature;
  }

  if (typeof raw.reasoningEffort === 'string') {
    const effort = raw.reasoningEffort.trim().toLowerCase();
    if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort)) {
      next.reasoningEffort = effort as NonNullable<AIConfig['reasoningEffort']>;
    }
  }

  return next;
}
