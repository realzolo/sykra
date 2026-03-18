/**
 * GET /api/integrations/providers - Get available providers and their configuration templates
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = {
    vcs: {
      github: {
        name: 'GitHub',
        description: 'GitHub.com and GitHub Enterprise',
        fields: [
          {
            key: 'token',
            label: 'Personal Access Token',
            type: 'password',
            required: true,
            placeholder: 'ghp_...',
            help: 'Create a token with repo scope',
          },
          {
            key: 'baseUrl',
            label: 'Base URL (for Enterprise)',
            type: 'text',
            required: false,
            placeholder: 'https://github.company.com/api/v3',
            help: 'Leave empty for GitHub.com',
          },
          {
            key: 'org',
            label: 'Default Organization',
            type: 'text',
            required: false,
            placeholder: 'my-org',
            help: 'Default organization for repositories',
          },
        ],
        docs: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token',
      },
      gitlab: {
        name: 'GitLab',
        description: 'GitLab.com and self-hosted GitLab',
        fields: [
          {
            key: 'token',
            label: 'Personal Access Token',
            type: 'password',
            required: true,
            placeholder: 'glpat-...',
            help: 'Create a token with api scope',
          },
          {
            key: 'baseUrl',
            label: 'Base URL',
            type: 'text',
            required: true,
            placeholder: 'https://gitlab.com',
            help: 'GitLab instance URL',
          },
          {
            key: 'org',
            label: 'Default Group',
            type: 'text',
            required: false,
            placeholder: 'my-group',
            help: 'Default group for repositories',
          },
        ],
        docs: 'https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html',
      },
      git: {
        name: 'Generic Git',
        description: 'Custom Git service',
        fields: [
          {
            key: 'token',
            label: 'Access Token',
            type: 'password',
            required: true,
            placeholder: 'your-token',
          },
          {
            key: 'baseUrl',
            label: 'Base URL',
            type: 'text',
            required: true,
            placeholder: 'https://git.company.com',
          },
        ],
        docs: null,
      },
    },
    ai: {
      'openai-api': {
        name: 'OpenAI API Format',
        description: 'Anthropic, OpenAI, DeepSeek, and other providers',
        fields: [
          {
            key: 'apiKey',
            label: 'API Key',
            type: 'password',
            required: true,
            placeholder: 'sk-...',
          },
          {
            key: 'baseUrl',
            label: 'Base URL',
            type: 'text',
            required: true,
            placeholder: 'https://api.anthropic.com',
            help: 'API endpoint URL',
          },
          {
            key: 'model',
            label: 'Model',
            type: 'text',
            required: true,
            placeholder: 'claude-sonnet-4-6',
            help: 'Model identifier',
          },
          {
            key: 'maxTokens',
            label: 'Max Tokens',
            type: 'number',
            required: false,
            placeholder: '4096',
          },
          {
            key: 'temperature',
            label: 'Temperature',
            type: 'number',
            required: false,
            placeholder: '0.7',
            help: 'Value between 0 and 1. Not applicable to reasoning models (o1, o3, o4-mini, etc.).',
          },
          {
            key: 'reasoningEffort',
            label: 'Reasoning Effort',
            type: 'select',
            required: false,
            placeholder: 'Select effort (optional)',
            help: 'Use for OpenAI reasoning-capable models on official OpenAI base URL. "none" keeps provider default.',
            options: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
          },
        ],
        docs: null,  // no single docs URL — provider-specific (e.g. platform.openai.com, console.anthropic.com)
        presets: [
          // Anthropic
          {
            name: 'Claude Opus 4.6',
            category: 'anthropic',
            config: {
              baseUrl: 'https://api.anthropic.com',
              model: 'claude-opus-4-6',
            },
          },
          {
            name: 'Claude Sonnet 4.6',
            category: 'anthropic',
            config: {
              baseUrl: 'https://api.anthropic.com',
              model: 'claude-sonnet-4-6',
            },
          },
          {
            name: 'Claude Haiku 4.5',
            category: 'anthropic',
            config: {
              baseUrl: 'https://api.anthropic.com',
              model: 'claude-haiku-4-5-20251001',
            },
          },
          // OpenAI — GPT
          {
            name: 'GPT-4.1',
            category: 'openai-gpt',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4.1',
            },
          },
          {
            name: 'GPT-4.1 mini',
            category: 'openai-gpt',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4.1-mini',
            },
          },
          {
            name: 'GPT-4o',
            category: 'openai-gpt',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o',
            },
          },
          {
            name: 'GPT-4o mini',
            category: 'openai-gpt',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini',
            },
          },
          {
            name: 'GPT-5.4',
            category: 'openai-reasoning',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-5.4',
              reasoningEffort: 'medium',
            },
          },
          {
            name: 'GPT-5.4 (xhigh)',
            category: 'openai-reasoning',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-5.4',
              reasoningEffort: 'xhigh',
            },
          },
          // OpenAI — reasoning
          {
            name: 'o3',
            category: 'openai-reasoning',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'o3',
              reasoningEffort: 'medium',
            },
          },
          {
            name: 'o4-mini',
            category: 'openai-reasoning',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'o4-mini',
              reasoningEffort: 'medium',
            },
          },
          {
            name: 'o3-mini',
            category: 'openai-reasoning',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'o3-mini',
              reasoningEffort: 'medium',
            },
          },
          // OpenAI — Codex
          {
            name: 'Codex (codex-latest)',
            category: 'openai-codex',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'codex-latest',
            },
          },
          {
            name: 'Codex mini (codex-mini-latest)',
            category: 'openai-codex',
            config: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'codex-mini-latest',
            },
          },
          // Google Gemini
          {
            name: 'Gemini 2.5 Pro',
            category: 'google-gemini',
            config: {
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
              model: 'gemini-2.5-pro-preview-05-06',
            },
          },
          {
            name: 'Gemini 2.5 Flash',
            category: 'google-gemini',
            config: {
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
              model: 'gemini-2.5-flash-preview-04-17',
            },
          },
          {
            name: 'Gemini 2.0 Flash',
            category: 'google-gemini',
            config: {
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
              model: 'gemini-2.0-flash',
            },
          },
          // DeepSeek
          {
            name: 'DeepSeek V3',
            category: 'deepseek',
            config: {
              baseUrl: 'https://api.deepseek.com/v1',
              model: 'deepseek-chat',
            },
          },
          {
            name: 'DeepSeek R1',
            category: 'deepseek',
            config: {
              baseUrl: 'https://api.deepseek.com/v1',
              model: 'deepseek-reasoner',
            },
          },
          // Mistral
          {
            name: 'Mistral Large',
            category: 'mistral',
            config: {
              baseUrl: 'https://api.mistral.ai/v1',
              model: 'mistral-large-latest',
            },
          },
          {
            name: 'Mistral Small',
            category: 'mistral',
            config: {
              baseUrl: 'https://api.mistral.ai/v1',
              model: 'mistral-small-latest',
            },
          },
          {
            name: 'Codestral',
            category: 'mistral',
            config: {
              baseUrl: 'https://codestral.mistral.ai/v1',
              model: 'codestral-latest',
            },
          },
          // Meta Llama (via Groq)
          {
            name: 'Llama 4 Scout (Groq)',
            category: 'llama-groq',
            config: {
              baseUrl: 'https://api.groq.com/openai/v1',
              model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            },
          },
          {
            name: 'Llama 3.3 70B (Groq)',
            category: 'llama-groq',
            config: {
              baseUrl: 'https://api.groq.com/openai/v1',
              model: 'llama-3.3-70b-versatile',
            },
          },
          // xAI Grok
          {
            name: 'Grok 3',
            category: 'xai-grok',
            config: {
              baseUrl: 'https://api.x.ai/v1',
              model: 'grok-3',
            },
          },
          {
            name: 'Grok 3 mini',
            category: 'xai-grok',
            config: {
              baseUrl: 'https://api.x.ai/v1',
              model: 'grok-3-mini',
            },
          },
        ],
      },
    },
  };

  return NextResponse.json(providers);
}
