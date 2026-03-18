package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"spec-axis/runner/internal/crypto"
	"spec-axis/runner/internal/domain"
	"spec-axis/runner/internal/store"
)

type VCSClient interface {
	GetCommitDiff(repo string, sha string) (string, error)
}

type AIClient interface {
	Analyze(prompt string, code string, timeout time.Duration) (domain.ReviewResult, error)
	Model() string
}

type VCSConfig struct {
	BaseURL string
	Org     string
	Token   string
}

type AIConfig struct {
	BaseURL         string
	ModelName       string
	MaxTokens       int
	Temperature     float64
	ReasoningEffort string
	APIKey          string
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
		ModelName:       readConfigString(integration.Config, "model"),
		MaxTokens:       readConfigInt(integration.Config, "maxTokens", 4096),
		Temperature:     readConfigFloat(integration.Config, "temperature", 0.7),
		ReasoningEffort: readConfigString(integration.Config, "reasoningEffort"),
		APIKey:          apiKey,
	}
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

func (c *OpenAIAPIClient) Model() string {
	return c.config.ModelName
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
	if strings.Contains(strings.ToLower(c.config.BaseURL), "anthropic.com") {
		return c.analyzeAnthropic(prompt, code, timeout)
	}
	if shouldUseResponsesAPI(c.config) {
		return c.analyzeOpenAIResponses(prompt, code, timeout)
	}
	return c.analyzeOpenAI(prompt, code, timeout)
}

func (c *OpenAIAPIClient) analyzeAnthropic(prompt string, code string, timeout time.Duration) (domain.ReviewResult, error) {
	fullPrompt := buildClientPrompt(prompt, code, true)
	body := map[string]any{
		"model":      c.config.ModelName,
		"max_tokens": c.config.MaxTokens,
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
	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(payload))
	if err != nil {
		return domain.ReviewResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.config.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return domain.ReviewResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return domain.ReviewResult{}, fmt.Errorf("anthropic error: %s", resp.Status)
	}

	raw, err := readAll(resp)
	if err != nil {
		return domain.ReviewResult{}, err
	}

	parsed, err := parseJSONBody(raw, "anthropic")
	if err != nil {
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
	fullPrompt := buildClientPrompt(prompt, code, false)
	body := map[string]any{
		"model": c.config.ModelName,
		"messages": []map[string]any{
			{"role": "user", "content": fullPrompt},
		},
		"max_tokens": c.config.MaxTokens,
	}
	if supportsTemperature(c.config.ModelName) {
		body["temperature"] = c.config.Temperature
	}
	payload, _ := json.Marshal(body)

	base := strings.TrimSuffix(c.config.BaseURL, "/")
	endpoint := base + "/chat/completions"
	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(payload))
	if err != nil {
		return domain.ReviewResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return domain.ReviewResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return domain.ReviewResult{}, fmt.Errorf("openai-api error: %s", resp.Status)
	}

	raw, err := readAll(resp)
	if err != nil {
		return domain.ReviewResult{}, err
	}

	parsed, err := parseJSONBody(raw, "openai-chat-completions")
	if err != nil {
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
	fullPrompt := buildClientPrompt(prompt, code, false)
	body := map[string]any{
		"model":             c.config.ModelName,
		"input":             fullPrompt,
		"max_output_tokens": c.config.MaxTokens,
	}
	if effort := normalizeReasoningEffort(c.config.ReasoningEffort); effort != "" && supportsReasoningEffort(c.config.ModelName) {
		body["reasoning"] = map[string]any{"effort": effort}
	}

	payload, _ := json.Marshal(body)
	base := strings.TrimSuffix(c.config.BaseURL, "/")
	endpoint := base + "/responses"
	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(payload))
	if err != nil {
		return domain.ReviewResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return domain.ReviewResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return domain.ReviewResult{}, fmt.Errorf("openai-responses error: %s", resp.Status)
	}

	raw, err := readAll(resp)
	if err != nil {
		return domain.ReviewResult{}, err
	}

	parsed, err := parseJSONBody(raw, "openai-responses")
	if err != nil {
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
