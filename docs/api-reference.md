# Integration System API Reference

## Overview

The Integration System provides a unified way to manage VCS (Version Control System) and AI model integrations. All integrations are configured through the web UI and stored securely in the database.

## Base URL

All API endpoints are relative to your application's base URL.

## Authentication

All endpoints require authentication. Use the `session` HTTP-only cookie issued by `/api/auth/login` (browser requests include it automatically).

## Endpoints

### List Integrations

Get all integrations for the authenticated user.

**Endpoint**: `GET /api/integrations`

**Query Parameters**:
- `type` (optional): Filter by integration type (`vcs` or `ai`)

**Response**:
```json
[
  {
    "id": "uuid",
    "type": "vcs",
    "provider": "github",
    "name": "Company GitHub",
    "is_default": true,
    "config": {
      "baseUrl": "https://github.com",
      "org": "my-org"
    },
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
]
```

**Note**: Sensitive data (tokens, API keys) is not included in the response.

---

### Create Integration

Create a new integration.

**Endpoint**: `POST /api/integrations`

**Request Body**:
```json
{
  "type": "vcs",
  "provider": "github",
  "name": "Company GitHub",
  "config": {
    "baseUrl": "https://github.com",
    "org": "my-org"
  },
  "secret": "ghp_xxxxxxxxxxxx",
  "isDefault": true
}
```

**Fields**:
- `type` (required): Integration type (`vcs` or `ai`)
- `provider` (required): Provider identifier
- `name` (required): User-defined name
- `config` (required): Non-sensitive configuration (object)
- `secret` (required): Sensitive data (token or API key)
- `isDefault` (optional): Set as default integration (boolean)

**Response**: Same as List Integrations (single object)

---

### Update Integration

Update an existing integration.

**Endpoint**: `PUT /api/integrations/:id`

**Request Body**:
```json
{
  "name": "Updated Name",
  "config": {
    "baseUrl": "https://github.enterprise.com"
  },
  "secret": "new_token",
  "isDefault": false
}
```

**Fields**: All fields are optional. Only provided fields will be updated.

**Response**: Updated integration object

---

### Delete Integration

Delete an integration.

**Endpoint**: `DELETE /api/integrations/:id`

**Response**:
```json
{
  "success": true
}
```

**Error**: Returns 400 if integration is in use by any projects.

---

### Test Integration

Test connection to an integration.

**Endpoint**: `POST /api/integrations/:id/test`

**Response**:
```json
{
  "success": true,
  "error": null
}
```

Or on failure:
```json
{
  "success": false,
  "error": "Connection failed: Invalid token"
}
```

---

### Set Default Integration

Set an integration as the default for its type.

**Endpoint**: `POST /api/integrations/:id/set-default`

**Response**:
```json
{
  "success": true
}
```

**Note**: This automatically unsets any other default integration of the same type.

---

### Get Provider Templates

Get configuration templates for all supported providers.

**Endpoint**: `GET /api/integrations/providers`

**Response**:
```json
{
  "vcs": {
    "github": {
      "name": "GitHub",
      "description": "GitHub.com and GitHub Enterprise",
      "fields": [
        {
          "key": "token",
          "label": "Personal Access Token",
          "type": "password",
          "required": true,
          "placeholder": "ghp_...",
          "help": "Create a token with repo scope"
        },
        {
          "key": "baseUrl",
          "label": "Base URL (for Enterprise)",
          "type": "text",
          "required": false,
          "placeholder": "https://github.company.com/api/v3",
          "help": "Leave empty for GitHub.com"
        }
      ],
      "docs": "https://docs.github.com/..."
    }
  },
  "ai": {
    "openai-api": {
      "name": "OpenAI API Format",
      "description": "Anthropic, OpenAI, DeepSeek, and other providers",
      "fields": [...],
      "presets": [
        {
          "name": "Anthropic Claude",
          "category": "anthropic",
          "config": {
            "baseUrl": "https://api.anthropic.com",
            "model": "claude-sonnet-4-6"
          }
        }
      ]
    }
  }
}
```

## Integration Types

### VCS Integration

**Supported Providers**:
- `github`: GitHub (github.com and Enterprise)
- `gitlab`: GitLab (gitlab.com and self-hosted)
- `git`: Generic Git service

**Configuration Fields**:
- `token` (required): Personal Access Token
- `baseUrl` (optional): API base URL for self-hosted instances
- `org` (optional): Default organization/namespace

### AI Integration

**Supported Providers**:
- `openai-api`: OpenAI API format

**Configuration Fields**:
- `apiKey` (required): API key
- `baseUrl` (required): API endpoint URL
- `model` (required): Model identifier
- `maxTokens` (optional): Maximum tokens
- `temperature` (optional): Temperature (0-1)
- `reasoningEffort` (optional): `none | minimal | low | medium | high | xhigh`

**Preset Metadata**:
- `presets[].category` (optional): Provider/model family used by UI for category filtering
- Presets are convenience templates only; users can always manually enter any valid model ID in `config.model`

**Execution Routing**:
- Official OpenAI base URL (`https://api.openai.com/v1`) + reasoning-capable model (`gpt-5*`, `o*`, `codex*`) uses `/responses`
- Other OpenAI-compatible providers continue using `/chat/completions`

## Error Responses

All endpoints return standard error responses:

```json
{
  "error": "Error message"
}
```

**Common Status Codes**:
- `400`: Bad request (missing required fields, validation error)
- `401`: Unauthorized (not logged in)
- `403`: Forbidden (trying to access another user's integration)
- `404`: Not found
- `500`: Internal server error

## Usage Examples

### Create GitHub Integration

```typescript
const response = await fetch('/api/integrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'vcs',
    provider: 'github',
    name: 'My GitHub',
    config: {
      org: 'my-company'
    },
    secret: 'ghp_xxxxxxxxxxxx',
    isDefault: true
  })
});

const integration = await response.json();
```

### Create Anthropic Integration

```typescript
const response = await fetch('/api/integrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'ai',
    provider: 'openai-api',
    name: 'Claude Sonnet 4.6',
    config: {
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      maxTokens: 4096,
      temperature: 0.7
    },
    secret: 'sk-ant-xxxxxxxxxxxx',
    isDefault: true
  })
});

const integration = await response.json();
```

### Create OpenAI GPT-5.4 Integration with xhigh Effort

```typescript
const response = await fetch('/api/integrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'ai',
    provider: 'openai-api',
    name: 'GPT-5.4 xhigh',
    config: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      maxTokens: 4096
    },
    secret: 'sk-xxxxxxxxxxxx',
    isDefault: false
  })
});

const integration = await response.json();
```

### Test Integration

```typescript
const response = await fetch(`/api/integrations/${integrationId}/test`, {
  method: 'POST'
});

const result = await response.json();
if (result.success) {
  console.log('Connection successful');
} else {
  console.error('Connection failed:', result.error);
}
```

## Security Considerations

1. **Sensitive Data**: Tokens and API keys are encrypted with AES-256-GCM and stored in `org_integrations.vault_secret_name`
2. **Tenant Isolation**: Org scoping is enforced in the API/service layer for all queries and mutations
3. **HTTPS Only**: All API requests must use HTTPS in production
4. **Token Validation**: Always test connections after creating/updating integrations

## Rate Limiting

API endpoints are subject to rate limiting. Excessive requests may result in temporary blocks.

## Webhooks

Currently, webhooks are not supported for integration events. This may be added in future versions.
