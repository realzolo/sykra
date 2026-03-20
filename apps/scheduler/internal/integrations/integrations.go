package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"spec-axis/scheduler/internal/crypto"
	"spec-axis/scheduler/internal/domain"
	"spec-axis/scheduler/internal/store"
)

type VCSClient interface {
	GetCommitDiff(repo string, sha string) (string, error)
}

type AIClient interface {
	Analyze(prompt string, code string, timeout time.Duration) (domain.ReviewResult, error)
	Model() string
	OutputLanguage() string
}

type VCSConfig struct {
	BaseURL string
	Org     string
	Token   string
}

type AIConfig struct {
	BaseURL         string
	APIStyle        string
	ModelName       string
	OutputLanguage  string
	MaxTokens       int
	Temperature     float64
	ReasoningEffort string
	APIKey          string
}

var aiWebUIHosts = map[string]bool{
	"platform.openai.com": true,
	"chat.openai.com":     true,
	"openai.com":          true,
	"www.openai.com":      true,
}

func ResolveVCSClient(ctx context.Context, st *store.Store, project *store.Project) (VCSClient, error) {
	integration, err := resolveIntegration(ctx, st, project, "vcs")
	if err != nil {
		return nil, err
	}

	token, err := crypto.DecryptSecret(integration.VaultSecretName)
	if err != nil {
		return nil, wrapSecretDecryptError("VCS", err)
	}

	config := VCSConfig{
		BaseURL: readConfigString(integration.Config, "baseUrl"),
		Org:     readConfigString(integration.Config, "org"),
		Token:   token,
	}

	switch integration.Provider {
	case "github":
		return NewGitHubClient(config), nil
	case "gitlab":
		return NewGitLabClient(config), nil
	case "git":
		return NewGenericGitClient(config), nil
	default:
		return nil, fmt.Errorf("unsupported VCS provider: %s", integration.Provider)
	}
}

func ResolveAIClient(ctx context.Context, st *store.Store, project *store.Project) (AIClient, error) {
	return resolveAIClientWithPhase(ctx, st, project, "")
}

func ResolveAIClientForPhase(ctx context.Context, st *store.Store, project *store.Project, phase string) (AIClient, error) {
	return resolveAIClientWithPhase(ctx, st, project, phase)
}

func resolveAIClientWithPhase(ctx context.Context, st *store.Store, project *store.Project, phase string) (AIClient, error) {
	integration, err := resolveIntegration(ctx, st, project, "ai")
	if err != nil {
		return nil, err
	}

	apiKey, err := crypto.DecryptSecret(integration.VaultSecretName)
	if err != nil {
		return nil, wrapSecretDecryptError("AI", err)
	}

	config := AIConfig{
		BaseURL:         readConfigString(integration.Config, "baseUrl"),
		APIStyle:        readConfigString(integration.Config, "apiStyle"),
		ModelName:       readConfigString(integration.Config, "model"),
		OutputLanguage:  normalizeOutputLanguage(readConfigString(integration.Config, "outputLanguage")),
		MaxTokens:       readConfigInt(integration.Config, "maxTokens", 4096),
		Temperature:     readConfigFloat(integration.Config, "temperature", 0.7),
		ReasoningEffort: readConfigString(integration.Config, "reasoningEffort"),
		APIKey:          apiKey,
	}
	if phase != "" {
		if model := readConfigStringFromMap(integration.Config, "phaseModels", phase); strings.TrimSpace(model) != "" {
			config.ModelName = model
		}
		if maxTokens := readConfigIntFromMap(integration.Config, "phaseMaxTokens", phase, 0); maxTokens > 0 {
			config.MaxTokens = maxTokens
		}
		if effort := readConfigStringFromMap(integration.Config, "phaseReasoningEffort", phase); strings.TrimSpace(effort) != "" {
			config.ReasoningEffort = effort
		}
		if temp, ok := readConfigFloatFromMap(integration.Config, "phaseTemperature", phase); ok {
			config.Temperature = temp
		}
	}
	normalizedBaseURL, err := normalizeAIBaseURL(config.BaseURL)
	if err != nil {
		return nil, err
	}
	config.BaseURL = normalizedBaseURL
	normalizedAPIStyle, err := normalizeAPIStyle(config.APIStyle)
	if err != nil {
		return nil, err
	}
	config.APIStyle = normalizedAPIStyle
	if strings.TrimSpace(config.ModelName) == "" {
		return nil, fmt.Errorf("AI model is required")
	}

	switch integration.Provider {
	case "openai-api":
		return NewOpenAIAPIClient(config), nil
	default:
		return nil, fmt.Errorf("unsupported AI provider: %s", integration.Provider)
	}
}

func normalizeAIBaseURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("AI baseUrl is required")
	}

	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("AI baseUrl must be a valid absolute URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("AI baseUrl must use http or https")
	}

	host := strings.ToLower(parsed.Hostname())
	if aiWebUIHosts[host] {
		return "", fmt.Errorf(
			"AI baseUrl points to a web console URL. Use an API endpoint, for example https://api.openai.com/v1",
		)
	}

	path := strings.TrimSuffix(parsed.Path, "/")
	endpointSuffixes := []string{
		"/v1/chat/completions",
		"/v1/responses",
		"/v1/messages",
		"/chat/completions",
		"/responses",
		"/messages",
	}
	for _, suffix := range endpointSuffixes {
		if strings.HasSuffix(path, suffix) {
			path = strings.TrimSuffix(path, suffix)
			break
		}
	}

	if host == "api.openai.com" && (path == "" || path == "/") {
		path = "/v1"
	}

	parsed.Path = path
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func wrapSecretDecryptError(integrationType string, err error) error {
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "invalid iv length") ||
		strings.Contains(lower, "invalid auth tag length") ||
		strings.Contains(lower, "invalid encrypted data format") {
		return fmt.Errorf("%s integration secret format is invalid. Re-save this integration secret in Studio Settings > Integrations", integrationType)
	}
	return err
}

func resolveIntegration(ctx context.Context, st *store.Store, project *store.Project, integrationType string) (*store.IntegrationRow, error) {
	var integration *store.IntegrationRow
	var err error

	if integrationType == "vcs" && project.VCSIntegrationID != nil {
		integration, err = st.GetIntegrationByID(ctx, *project.VCSIntegrationID)
		if err != nil {
			return nil, err
		}
	} else if integrationType == "ai" && project.AIIntegrationID != nil {
		integration, err = st.GetIntegrationByID(ctx, *project.AIIntegrationID)
		if err != nil {
			return nil, err
		}
	}

	if integration != nil {
		if project.OrgID != "" && integration.OrgID != "" && integration.OrgID != project.OrgID {
			return nil, errors.New("integration does not belong to project organization")
		}
		return integration, nil
	}

	integration, err = st.GetDefaultIntegration(ctx, project.OrgID, integrationType)
	if err != nil {
		return nil, err
	}
	if integration == nil {
		return nil, fmt.Errorf("no %s integration configured", integrationType)
	}
	return integration, nil
}

func readConfigString(raw json.RawMessage, key string) string {
	if len(raw) == 0 {
		return ""
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return ""
	}
	value, _ := data[key]
	if str, ok := value.(string); ok {
		return str
	}
	return ""
}

func readConfigInt(raw json.RawMessage, key string, fallback int) int {
	if len(raw) == 0 {
		return fallback
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return fallback
	}
	value, ok := data[key]
	if !ok {
		return fallback
	}
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	default:
		return fallback
	}
}

func readConfigFloat(raw json.RawMessage, key string, fallback float64) float64 {
	if len(raw) == 0 {
		return fallback
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return fallback
	}
	value, ok := data[key]
	if !ok {
		return fallback
	}
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	default:
		return fallback
	}
}

func readConfigStringFromMap(raw json.RawMessage, key string, mapKey string) string {
	if len(raw) == 0 {
		return ""
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return ""
	}
	nested, ok := data[key].(map[string]any)
	if !ok {
		return ""
	}
	value, ok := nested[mapKey]
	if !ok {
		return ""
	}
	str, _ := value.(string)
	return str
}

func readConfigIntFromMap(raw json.RawMessage, key string, mapKey string, fallback int) int {
	if len(raw) == 0 {
		return fallback
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return fallback
	}
	nested, ok := data[key].(map[string]any)
	if !ok {
		return fallback
	}
	value, ok := nested[mapKey]
	if !ok {
		return fallback
	}
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	default:
		return fallback
	}
}

func readConfigFloatFromMap(raw json.RawMessage, key string, mapKey string) (float64, bool) {
	if len(raw) == 0 {
		return 0, false
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return 0, false
	}
	nested, ok := data[key].(map[string]any)
	if !ok {
		return 0, false
	}
	value, ok := nested[mapKey]
	if !ok {
		return 0, false
	}
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	default:
		return 0, false
	}
}

// ───────────────────────── VCS Clients ─────────────────────────

type GitHubClient struct {
	baseURL string
	token   string
	client  *http.Client
}

func NewGitHubClient(config VCSConfig) *GitHubClient {
	base := strings.TrimSuffix(config.BaseURL, "/")
	if base == "" {
		base = "https://api.github.com"
	}
	if base == "https://github.com" || base == "http://github.com" {
		base = "https://api.github.com"
	}
	return &GitHubClient{
		baseURL: base,
		token:   config.Token,
		client:  &http.Client{Timeout: 60 * time.Second},
	}
}

func (c *GitHubClient) GetCommitDiff(repo string, sha string) (string, error) {
	owner, name, err := splitRepo(repo)
	if err != nil {
		return "", err
	}
	endpoint := fmt.Sprintf("%s/repos/%s/%s/commits/%s", c.baseURL, owner, name, sha)
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github.v3.diff")
	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("github diff failed: %s", resp.Status)
	}
	body, err := readAll(resp)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

type GitLabClient struct {
	baseURL string
	token   string
	client  *http.Client
}

func NewGitLabClient(config VCSConfig) *GitLabClient {
	base := strings.TrimSuffix(config.BaseURL, "/")
	if base == "" {
		base = "https://gitlab.com"
	}
	if !strings.HasSuffix(base, "/api/v4") {
		base = base + "/api/v4"
	}
	return &GitLabClient{
		baseURL: base,
		token:   config.Token,
		client:  &http.Client{Timeout: 60 * time.Second},
	}
}

func (c *GitLabClient) GetCommitDiff(repo string, sha string) (string, error) {
	projectPath := url.PathEscape(repo)
	endpoint := fmt.Sprintf("%s/projects/%s/repository/commits/%s/diff", c.baseURL, projectPath, sha)
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return "", err
	}
	if c.token != "" {
		req.Header.Set("PRIVATE-TOKEN", c.token)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("gitlab diff failed: %s", resp.Status)
	}
	body, err := readAll(resp)
	if err != nil {
		return "", err
	}

	var diffs []map[string]any
	if err := json.Unmarshal(body, &diffs); err != nil {
		return "", err
	}

	blocks := make([]string, 0, len(diffs))
	for _, diff := range diffs {
		oldPath, _ := diff["old_path"].(string)
		newPath, _ := diff["new_path"].(string)
		diffText, _ := diff["diff"].(string)
		if diffText == "" {
			continue
		}
		blocks = append(blocks, fmt.Sprintf("diff --git a/%s b/%s\n%s", oldPath, newPath, diffText))
	}

	return strings.Join(blocks, "\n"), nil
}

type GenericGitClient struct {
	config VCSConfig
}

func NewGenericGitClient(config VCSConfig) *GenericGitClient {
	return &GenericGitClient{config: config}
}

func (c *GenericGitClient) GetCommitDiff(_ string, _ string) (string, error) {
	return "", fmt.Errorf("generic git provider does not support commit diff")
}

func splitRepo(repo string) (string, string, error) {
	parts := strings.Split(repo, "/")
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid repo format: %s", repo)
	}
	return parts[0], parts[1], nil
}

// ───────────────────────── AI Clients ─────────────────────────

type OpenAIAPIClient struct {
	config AIConfig
	client *http.Client
}

func NewOpenAIAPIClient(config AIConfig) *OpenAIAPIClient {
	return &OpenAIAPIClient{
		config: config,
		client: &http.Client{Timeout: 120 * time.Second},
	}
}

const (
	aiRequestMaxAttempts = 3
	aiRetryBaseDelay     = 700 * time.Millisecond
	aiRetryMaxTokensCap  = 32768
	aiRetryMinTokens     = 6144
)

func (c *OpenAIAPIClient) Model() string {
	return c.config.ModelName
}

func (c *OpenAIAPIClient) OutputLanguage() string {
	return normalizeOutputLanguage(c.config.OutputLanguage)
}

var noTemperatureModels = []string{
	"o1", "o1-mini", "o1-preview",
	"o3", "o3-mini",
	"o4-mini",
	"codex",
	"codex-latest",
	"codex-mini-latest",
	"deepseek-reasoner",
}

var reasoningModelPrefixes = []string{"o", "gpt-5", "codex"}
var supportedAPIStyles = map[string]bool{
	"openai":    true,
	"anthropic": true,
}

var supportedOutputLanguageCodes = map[string]bool{
	"en":    true,
	"zh-CN": true,
	"zh-TW": true,
	"ja":    true,
	"ko":    true,
	"es":    true,
	"fr":    true,
	"de":    true,
	"pt-BR": true,
	"ru":    true,
	"it":    true,
	"nl":    true,
	"tr":    true,
	"pl":    true,
	"ar":    true,
	"hi":    true,
	"th":    true,
	"vi":    true,
	"id":    true,
	"ms":    true,
}

func supportsTemperature(model string) bool {
	normalized := strings.TrimSpace(strings.ToLower(model))
	for _, m := range noTemperatureModels {
		if normalized == m || strings.HasPrefix(normalized, m+"-") {
			return false
		}
	}
	return true
}

func supportsReasoningEffort(model string) bool {
	normalized := strings.TrimSpace(strings.ToLower(model))
	for _, prefix := range reasoningModelPrefixes {
		if normalized == prefix || strings.HasPrefix(normalized, prefix+"-") {
			return true
		}
	}
	return false
}

func normalizeReasoningEffort(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "minimal", "low", "medium", "high", "xhigh":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return ""
	}
}

func normalizeOutputLanguage(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "en"
	}
	if supportedOutputLanguageCodes[normalized] {
		return normalized
	}
	return "en"
}

func normalizeAPIStyle(value string) (string, error) {
	style := strings.TrimSpace(strings.ToLower(value))
	if supportedAPIStyles[style] {
		return style, nil
	}
	return "", fmt.Errorf("AI apiStyle must be either \"openai\" or \"anthropic\"")
}

func isOpenAIOfficialBase(baseURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Hostname(), "api.openai.com")
}

func shouldUseResponsesAPI(config AIConfig) bool {
	if !isOpenAIOfficialBase(config.BaseURL) {
		return false
	}
	if normalizeReasoningEffort(config.ReasoningEffort) != "" {
		return true
	}
	return supportsReasoningEffort(config.ModelName)
}

func (c *OpenAIAPIClient) Analyze(prompt string, code string, timeout time.Duration) (domain.ReviewResult, error) {
	if strings.TrimSpace(c.config.BaseURL) == "" {
		return domain.ReviewResult{}, fmt.Errorf("AI baseUrl is required")
	}
	apiStyle, err := normalizeAPIStyle(c.config.APIStyle)
	if err != nil {
		return domain.ReviewResult{}, err
	}
	useAnthropic := apiStyle == "anthropic"
	if useAnthropic {
		return c.analyzeAnthropic(prompt, code, timeout)
	}
	if shouldUseResponsesAPI(c.config) {
		return c.analyzeOpenAIResponses(prompt, code, timeout)
	}
	return c.analyzeOpenAI(prompt, code, timeout)
}

func (c *OpenAIAPIClient) analyzeAnthropic(prompt string, code string, timeout time.Duration) (domain.ReviewResult, error) {
	return c.analyzeAnthropicWithBudget(prompt, code, timeout, c.config.MaxTokens, true)
}

func (c *OpenAIAPIClient) analyzeAnthropicWithBudget(
	prompt string,
	code string,
	timeout time.Duration,
	maxTokens int,
	allowTokenRetry bool,
) (domain.ReviewResult, error) {
	fullPrompt := buildClientPrompt(prompt, code, true)
	body := map[string]any{
		"model":      c.config.ModelName,
		"max_tokens": maxTokens,
		"messages": []map[string]any{
			{"role": "user", "content": fullPrompt},
		},
	}
	if supportsTemperature(c.config.ModelName) {
		body["temperature"] = c.config.Temperature
	}
	payload, _ := json.Marshal(body)

	base := strings.TrimSuffix(c.config.BaseURL, "/")
	endpoint := base + "/v1/messages"
	if strings.HasSuffix(base, "/v1") {
		endpoint = base + "/messages"
	}
	parsed, err := c.postJSONWithRetry(endpoint, payload, timeout, "anthropic", func(req *http.Request) {
		req.Header.Set("x-api-key", c.config.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	})
	if err != nil {
		return domain.ReviewResult{}, err
	}
	if err := detectAnthropicOutputLimit(parsed); err != nil {
		if allowTokenRetry {
			if retryBudget, ok := nextRetryTokenBudget(maxTokens); ok {
				return c.analyzeAnthropicWithBudget(prompt, code, timeout, retryBudget, false)
			}
		}
		if !allowTokenRetry {
			return domain.ReviewResult{}, fmt.Errorf("%w; automatic token retry exhausted", err)
		}
		return domain.ReviewResult{}, err
	}

	content, _ := parsed["content"].([]any)
	if len(content) == 0 {
		return domain.ReviewResult{}, fmt.Errorf("anthropic response missing content")
	}
	first := content[0].(map[string]any)
	text, _ := first["text"].(string)
	result, err := parseReviewResult(text)
	if err != nil {
		return domain.ReviewResult{}, err
	}
	result.TokenUsage = parseTokenUsageFromAnthropic(parsed)
	return result, nil
}

func (c *OpenAIAPIClient) analyzeOpenAI(prompt string, code string, timeout time.Duration) (domain.ReviewResult, error) {
	return c.analyzeOpenAIWithBudget(prompt, code, timeout, c.config.MaxTokens, true)
}

func (c *OpenAIAPIClient) analyzeOpenAIWithBudget(
	prompt string,
	code string,
	timeout time.Duration,
	maxTokens int,
	allowTokenRetry bool,
) (domain.ReviewResult, error) {
	fullPrompt := buildClientPrompt(prompt, code, false)
	body := map[string]any{
		"model": c.config.ModelName,
		"messages": []map[string]any{
			{"role": "user", "content": fullPrompt},
		},
		"max_tokens": maxTokens,
	}
	if supportsTemperature(c.config.ModelName) {
		body["temperature"] = c.config.Temperature
	}
	payload, _ := json.Marshal(body)

	base := strings.TrimSuffix(c.config.BaseURL, "/")
	endpoint := base + "/chat/completions"
	parsed, err := c.postJSONWithRetry(endpoint, payload, timeout, "openai-chat-completions", func(req *http.Request) {
		if c.config.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
		}
	})
	if err != nil {
		return domain.ReviewResult{}, err
	}
	if err := detectOpenAIChatOutputLimit(parsed); err != nil {
		if allowTokenRetry {
			if retryBudget, ok := nextRetryTokenBudget(maxTokens); ok {
				return c.analyzeOpenAIWithBudget(prompt, code, timeout, retryBudget, false)
			}
		}
		if !allowTokenRetry {
			return domain.ReviewResult{}, fmt.Errorf("%w; automatic token retry exhausted", err)
		}
		return domain.ReviewResult{}, err
	}
	choices, _ := parsed["choices"].([]any)
	if len(choices) == 0 {
		return domain.ReviewResult{}, fmt.Errorf("openai response missing choices")
	}
	first := choices[0].(map[string]any)
	message, _ := first["message"].(map[string]any)
	content, _ := message["content"].(string)
	result, err := parseReviewResult(content)
	if err != nil {
		return domain.ReviewResult{}, err
	}
	result.TokenUsage = parseTokenUsageFromOpenAIChat(parsed)
	return result, nil
}

func (c *OpenAIAPIClient) analyzeOpenAIResponses(prompt string, code string, timeout time.Duration) (domain.ReviewResult, error) {
	return c.analyzeOpenAIResponsesWithBudget(prompt, code, timeout, c.config.MaxTokens, true)
}

func (c *OpenAIAPIClient) analyzeOpenAIResponsesWithBudget(
	prompt string,
	code string,
	timeout time.Duration,
	maxOutputTokens int,
	allowTokenRetry bool,
) (domain.ReviewResult, error) {
	fullPrompt := buildClientPrompt(prompt, code, false)
	body := map[string]any{
		"model":             c.config.ModelName,
		"input":             fullPrompt,
		"max_output_tokens": maxOutputTokens,
	}
	if effort := normalizeReasoningEffort(c.config.ReasoningEffort); effort != "" && supportsReasoningEffort(c.config.ModelName) {
		body["reasoning"] = map[string]any{"effort": effort}
	}

	payload, _ := json.Marshal(body)
	base := strings.TrimSuffix(c.config.BaseURL, "/")
	endpoint := base + "/responses"
	parsed, err := c.postJSONWithRetry(endpoint, payload, timeout, "openai-responses", func(req *http.Request) {
		if c.config.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
		}
	})
	if err != nil {
		return domain.ReviewResult{}, err
	}
	if err := detectOpenAIResponsesOutputLimit(parsed); err != nil {
		if allowTokenRetry {
			if retryBudget, ok := nextRetryTokenBudget(maxOutputTokens); ok {
				return c.analyzeOpenAIResponsesWithBudget(prompt, code, timeout, retryBudget, false)
			}
		}
		if !allowTokenRetry {
			return domain.ReviewResult{}, fmt.Errorf("%w; automatic token retry exhausted", err)
		}
		return domain.ReviewResult{}, err
	}

	content := extractResponsesText(parsed)
	if strings.TrimSpace(content) == "" {
		return domain.ReviewResult{}, fmt.Errorf("openai responses missing output text")
	}

	result, err := parseReviewResult(content)
	if err != nil {
		return domain.ReviewResult{}, err
	}
	result.TokenUsage = parseTokenUsageFromOpenAIResponses(parsed)
	return result, nil
}

func nextRetryTokenBudget(current int) (int, bool) {
	if current <= 0 {
		current = 4096
	}
	retry := current * 2
	if retry < aiRetryMinTokens {
		retry = aiRetryMinTokens
	}
	if retry > aiRetryMaxTokensCap {
		retry = aiRetryMaxTokensCap
	}
	if retry <= current {
		return 0, false
	}
	return retry, true
}

func (c *OpenAIAPIClient) postJSONWithRetry(
	endpoint string,
	payload []byte,
	timeout time.Duration,
	source string,
	extraHeaders func(*http.Request),
) (map[string]any, error) {
	clientTimeout := timeout
	if clientTimeout <= 0 {
		clientTimeout = 120 * time.Second
	}

	client := &http.Client{Timeout: clientTimeout}
	var lastErr error

	for attempt := 1; attempt <= aiRequestMaxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		if extraHeaders != nil {
			extraHeaders(req)
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			if attempt < aiRequestMaxAttempts && isRetryableUpstreamError(err) {
				time.Sleep(retryDelay(attempt))
				continue
			}
			return nil, err
		}

		raw, readErr := readAll(resp)
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			if attempt < aiRequestMaxAttempts && isRetryableUpstreamError(readErr) {
				time.Sleep(retryDelay(attempt))
				continue
			}
			return nil, readErr
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			lastErr = fmt.Errorf("%s error: %s", source, resp.Status)
			if attempt < aiRequestMaxAttempts && isRetryableStatus(resp.StatusCode) {
				time.Sleep(retryDelay(attempt))
				continue
			}
			return nil, fmt.Errorf("%s error: %s, body=%s", source, resp.Status, trimBody(raw))
		}

		parsed, parseErr := parseJSONBody(raw, source)
		if parseErr != nil {
			lastErr = parseErr
			if attempt < aiRequestMaxAttempts && isRetryableParseError(parseErr) {
				time.Sleep(retryDelay(attempt))
				continue
			}
			return nil, parseErr
		}
		return parsed, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("%s request failed without details", source)
}

func retryDelay(attempt int) time.Duration {
	if attempt <= 1 {
		return aiRetryBaseDelay
	}
	return time.Duration(attempt) * aiRetryBaseDelay
}

func isRetryableStatus(code int) bool {
	return code == http.StatusTooManyRequests || code == http.StatusRequestTimeout || code >= 500
}

func isRetryableParseError(err error) bool {
	if err == nil {
		return false
	}
	low := strings.ToLower(err.Error())
	return strings.Contains(low, "unexpected end of json input") ||
		strings.Contains(low, "unexpected eof") ||
		strings.Contains(low, "empty response body")
}

func isRetryableUpstreamError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return netErr.Timeout() || netErr.Temporary()
	}
	low := strings.ToLower(err.Error())
	retryableSignals := []string{
		"unexpected eof",
		"eof",
		"connection reset by peer",
		"broken pipe",
		"server closed idle connection",
		"http2: client connection lost",
		"stream error",
	}
	for _, token := range retryableSignals {
		if strings.Contains(low, token) {
			return true
		}
	}
	return false
}

func trimBody(raw []byte) string {
	body := strings.TrimSpace(string(raw))
	if body == "" {
		return "<empty>"
	}
	if len(body) > 240 {
		return body[:240]
	}
	return body
}

func parseTokenUsageFromOpenAIChat(parsed map[string]any) *domain.TokenUsage {
	usage, _ := parsed["usage"].(map[string]any)
	if usage == nil {
		return nil
	}
	prompt := readInt(usage["prompt_tokens"])
	completion := readInt(usage["completion_tokens"])
	total := readInt(usage["total_tokens"])
	if total <= 0 {
		total = prompt + completion
	}
	if total <= 0 {
		return nil
	}
	return &domain.TokenUsage{
		InputTokens:  prompt,
		OutputTokens: completion,
		TotalTokens:  total,
	}
}

func parseTokenUsageFromOpenAIResponses(parsed map[string]any) *domain.TokenUsage {
	usage, _ := parsed["usage"].(map[string]any)
	if usage == nil {
		return nil
	}
	input := readInt(usage["input_tokens"])
	output := readInt(usage["output_tokens"])
	total := readInt(usage["total_tokens"])
	if total <= 0 {
		total = input + output
	}
	if total <= 0 {
		return nil
	}
	return &domain.TokenUsage{
		InputTokens:  input,
		OutputTokens: output,
		TotalTokens:  total,
	}
}

func parseTokenUsageFromAnthropic(parsed map[string]any) *domain.TokenUsage {
	usage, _ := parsed["usage"].(map[string]any)
	if usage == nil {
		return nil
	}
	input := readInt(usage["input_tokens"])
	output := readInt(usage["output_tokens"])
	total := input + output
	if total <= 0 {
		return nil
	}
	return &domain.TokenUsage{
		InputTokens:  input,
		OutputTokens: output,
		TotalTokens:  total,
	}
}

func readInt(value any) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	default:
		return 0
	}
}

func extractResponsesText(parsed map[string]any) string {
	if text, ok := parsed["output_text"].(string); ok && strings.TrimSpace(text) != "" {
		return text
	}

	output, ok := parsed["output"].([]any)
	if !ok {
		return ""
	}

	parts := make([]string, 0)
	for _, item := range output {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content, ok := itemMap["content"].([]any)
		if !ok {
			continue
		}
		for _, block := range content {
			blockMap, ok := block.(map[string]any)
			if !ok {
				continue
			}
			text, ok := blockMap["text"].(string)
			if !ok || strings.TrimSpace(text) == "" {
				continue
			}
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}

func buildClientPrompt(prompt string, code string, strictJSON bool) string {
	fullPrompt := prompt
	if strings.TrimSpace(code) != "" {
		fullPrompt = fmt.Sprintf("%s\n\nCode to analyze:\n```\n%s\n```\n", prompt, code)
	}
	if strictJSON {
		return fullPrompt + "\n\nPlease provide your analysis in JSON format."
	}
	return fullPrompt + "\n\nPlease provide your analysis in JSON format."
}

func parseReviewResult(content string) (domain.ReviewResult, error) {
	extracted := extractJSON(content)
	if extracted == "" {
		return domain.ReviewResult{
			Summary: content,
			Score:   70,
		}, nil
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(extracted), &raw); err != nil {
		return domain.ReviewResult{}, err
	}

	result := domain.ReviewResult{
		CategoryScores: map[string]float64{},
	}

	if score, ok := raw["score"].(float64); ok {
		result.Score = int(score)
	}
	if summary, ok := raw["summary"].(string); ok {
		result.Summary = summary
	}
	if scores, ok := raw["categoryScores"].(map[string]any); ok {
		for k, v := range scores {
			if num, ok := v.(float64); ok {
				result.CategoryScores[k] = num
			}
		}
	}

	if issuesRaw, ok := raw["issues"].([]any); ok {
		for _, item := range issuesRaw {
			if issueMap, ok := item.(map[string]any); ok {
				result.Issues = append(result.Issues, parseIssue(issueMap))
			}
		}
	}

	result.ComplexityMetrics = marshalRawField(raw["complexityMetrics"])
	result.DuplicationMetrics = marshalRawField(raw["duplicationMetrics"])
	result.DependencyMetrics = marshalRawField(raw["dependencyMetrics"])
	result.SecurityFindings = marshalRawField(raw["securityFindings"])
	result.PerformanceFindings = marshalRawField(raw["performanceFindings"])
	result.AISuggestions = marshalRawField(raw["aiSuggestions"])
	result.CodeExplanations = marshalRawField(raw["codeExplanations"])
	result.ContextAnalysis = marshalRawField(raw["contextAnalysis"])

	return result, nil
}

func parseIssue(raw map[string]any) domain.ReviewIssue {
	issue := domain.ReviewIssue{}
	if v, ok := raw["file"].(string); ok {
		issue.File = v
	}
	if v, ok := raw["line"].(float64); ok {
		line := int(v)
		issue.Line = &line
	}
	if v, ok := raw["severity"].(string); ok {
		issue.Severity = v
	}
	if v, ok := raw["category"].(string); ok {
		issue.Category = v
	}
	if v, ok := raw["rule"].(string); ok {
		issue.Rule = v
	}
	if v, ok := raw["message"].(string); ok {
		issue.Message = v
	}
	if v, ok := raw["suggestion"].(string); ok {
		issue.Suggestion = &v
	}
	if v, ok := raw["codeSnippet"].(string); ok {
		issue.CodeSnippet = &v
	}
	if v, ok := raw["fixPatch"].(string); ok {
		issue.FixPatch = &v
	}
	if v, ok := raw["priority"].(float64); ok {
		priority := int(v)
		issue.Priority = &priority
	}
	if v, ok := raw["impactScope"].(string); ok {
		issue.ImpactScope = &v
	}
	if v, ok := raw["estimatedEffort"].(string); ok {
		issue.EstimatedEffort = &v
	}
	return issue
}

func marshalRawField(value any) json.RawMessage {
	if value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return raw
}

func extractJSON(content string) string {
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start == -1 || end == -1 || end <= start {
		return ""
	}
	return content[start : end+1]
}

func readAll(resp *http.Response) ([]byte, error) {
	return io.ReadAll(resp.Body)
}

func parseJSONBody(raw []byte, source string) (map[string]any, error) {
	if strings.TrimSpace(string(raw)) == "" {
		return nil, fmt.Errorf("%s returned empty response body", source)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		bodySnippet := strings.TrimSpace(string(raw))
		if len(bodySnippet) > 180 {
			bodySnippet = bodySnippet[:180]
		}
		if strings.HasPrefix(bodySnippet, "<") {
			return nil, fmt.Errorf("%s upstream returned HTML instead of JSON. Check integration baseUrl and gateway routing", source)
		}
		return nil, fmt.Errorf("%s returned invalid JSON: %w", source, err)
	}
	return parsed, nil
}

func detectOpenAIChatOutputLimit(parsed map[string]any) error {
	choices, _ := parsed["choices"].([]any)
	if len(choices) == 0 {
		return nil
	}
	first, ok := choices[0].(map[string]any)
	if !ok {
		return nil
	}
	finishReason, _ := first["finish_reason"].(string)
	if finishReason == "length" {
		return fmt.Errorf("AI output truncated because max tokens was reached (chat finish_reason=length)")
	}
	return nil
}

func detectOpenAIResponsesOutputLimit(parsed map[string]any) error {
	status, _ := parsed["status"].(string)
	if status != "incomplete" {
		return nil
	}
	incompleteDetails, _ := parsed["incomplete_details"].(map[string]any)
	reason, _ := incompleteDetails["reason"].(string)
	if reason == "max_output_tokens" {
		return fmt.Errorf("AI output truncated because max_output_tokens was reached (responses incomplete)")
	}
	if reason != "" {
		return fmt.Errorf("AI output incomplete (responses reason=%s)", reason)
	}
	return fmt.Errorf("AI output incomplete (responses status=incomplete)")
}

func detectAnthropicOutputLimit(parsed map[string]any) error {
	stopReason, _ := parsed["stop_reason"].(string)
	if stopReason == "max_tokens" {
		return fmt.Errorf("AI output truncated because max_tokens was reached (anthropic stop_reason=max_tokens)")
	}
	return nil
}
