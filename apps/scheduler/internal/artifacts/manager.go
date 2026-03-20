package artifacts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	schedulercrypto "spec-axis/scheduler/internal/crypto"
	"spec-axis/scheduler/internal/store"
)

type Manager struct {
	Store        *store.Store
	LocalDataDir string
}

type SaveArtifactInput struct {
	OrgID         string
	RunID         string
	JobID         string
	StepID        string
	RelativePath  string
	Content       io.Reader
	ContentLength int64
}

type storageConfig struct {
	LocalBasePath              string `json:"localBasePath"`
	S3Endpoint                 string `json:"s3Endpoint"`
	S3Region                   string `json:"s3Region"`
	S3Bucket                   string `json:"s3Bucket"`
	S3Prefix                   string `json:"s3Prefix"`
	S3AccessKeyID              string `json:"s3AccessKeyId"`
	S3SecretAccessKeyEncrypted string `json:"s3SecretAccessKeyEncrypted"`
	S3ForcePathStyle           bool   `json:"s3ForcePathStyle"`

	// Runtime-only decrypted value; never serialized back to DB.
	S3SecretAccessKey string `json:"-"`
}

func (m *Manager) SaveArtifact(ctx context.Context, input SaveArtifactInput) (store.PipelineArtifact, error) {
	cleanRelativePath, err := sanitizeRelativePath(input.RelativePath)
	if err != nil {
		return store.PipelineArtifact{}, err
	}
	if strings.TrimSpace(input.OrgID) == "" {
		return store.PipelineArtifact{}, fmt.Errorf("org id is required")
	}
	if strings.TrimSpace(input.RunID) == "" {
		return store.PipelineArtifact{}, fmt.Errorf("run id is required")
	}
	if strings.TrimSpace(input.JobID) == "" {
		return store.PipelineArtifact{}, fmt.Errorf("job id is required")
	}
	if strings.TrimSpace(input.StepID) == "" {
		return store.PipelineArtifact{}, fmt.Errorf("step id is required")
	}
	if m.Store == nil {
		return store.PipelineArtifact{}, fmt.Errorf("artifact manager store is not configured")
	}

	tempFile, size, shaSum, err := spoolToTemp(input.Content)
	if err != nil {
		return store.PipelineArtifact{}, err
	}
	defer func() {
		_ = os.Remove(tempFile)
	}()

	settings, err := m.loadSettings(ctx, input.OrgID)
	if err != nil {
		return store.PipelineArtifact{}, err
	}

	switch settings.provider {
	case "local":
		storagePath, err := m.saveToLocal(tempFile, input, cleanRelativePath, settings.cfg)
		if err != nil {
			return store.PipelineArtifact{}, err
		}
		return store.PipelineArtifact{
			RunID:       input.RunID,
			JobID:       input.JobID,
			StepID:      input.StepID,
			Path:        cleanRelativePath,
			StoragePath: storagePath,
			SizeBytes:   size,
			Sha256:      shaSum,
		}, nil
	case "s3":
		storagePath, err := m.saveToS3(ctx, tempFile, size, input, cleanRelativePath, settings.cfg)
		if err != nil {
			return store.PipelineArtifact{}, err
		}
		return store.PipelineArtifact{
			RunID:       input.RunID,
			JobID:       input.JobID,
			StepID:      input.StepID,
			Path:        cleanRelativePath,
			StoragePath: storagePath,
			SizeBytes:   size,
			Sha256:      shaSum,
		}, nil
	default:
		return store.PipelineArtifact{}, fmt.Errorf("unsupported storage provider: %s", settings.provider)
	}
}

type resolvedSettings struct {
	provider string
	cfg      storageConfig
}

func (m *Manager) loadSettings(ctx context.Context, orgID string) (resolvedSettings, error) {
	row, err := m.Store.GetOrgStorageSettings(ctx, orgID)
	if err != nil {
		return resolvedSettings{}, err
	}
	if row == nil {
		return resolvedSettings{
			provider: "local",
			cfg: storageConfig{
				LocalBasePath: "artifacts",
			},
		}, nil
	}

	cfg := storageConfig{}
	if len(row.Config) > 0 {
		if err := json.Unmarshal(row.Config, &cfg); err != nil {
			return resolvedSettings{}, err
		}
	}

	provider := strings.TrimSpace(strings.ToLower(row.Provider))
	if provider == "" {
		provider = "local"
	}
	if provider == "local" && strings.TrimSpace(cfg.LocalBasePath) == "" {
		cfg.LocalBasePath = "artifacts"
	}
	if provider == "s3" && strings.TrimSpace(cfg.S3SecretAccessKeyEncrypted) != "" {
		secret, err := schedulercrypto.DecryptSecret(cfg.S3SecretAccessKeyEncrypted)
		if err != nil {
			return resolvedSettings{}, err
		}
		cfg.S3SecretAccessKey = secret
	}
	return resolvedSettings{provider: provider, cfg: cfg}, nil
}

func (m *Manager) saveToLocal(tempFile string, input SaveArtifactInput, relativePath string, cfg storageConfig) (string, error) {
	rootPath, err := resolveLocalRoot(m.LocalDataDir, cfg.LocalBasePath, input.OrgID)
	if err != nil {
		return "", err
	}

	artifactKey := filepath.ToSlash(filepath.Join(input.RunID, input.JobID, input.StepID, relativePath))
	absolutePath := filepath.Join(rootPath, filepath.FromSlash(artifactKey))
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		return "", err
	}
	src, err := os.Open(tempFile)
	if err != nil {
		return "", err
	}
	defer src.Close()
	dst, err := os.OpenFile(absolutePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return "", err
	}
	return fileURIFromPath(absolutePath), nil
}

func (m *Manager) saveToS3(
	ctx context.Context,
	tempFile string,
	size int64,
	input SaveArtifactInput,
	relativePath string,
	cfg storageConfig,
) (string, error) {
	bucket := strings.TrimSpace(cfg.S3Bucket)
	if bucket == "" {
		return "", fmt.Errorf("s3 bucket is required")
	}
	accessKey := strings.TrimSpace(cfg.S3AccessKeyID)
	secretKey := strings.TrimSpace(cfg.S3SecretAccessKey)
	if accessKey == "" || secretKey == "" {
		return "", fmt.Errorf("s3 access key and secret are required")
	}

	key := path.Join(
		strings.Trim(cfg.S3Prefix, "/"),
		input.OrgID,
		input.RunID,
		input.JobID,
		input.StepID,
		strings.ReplaceAll(relativePath, "\\", "/"),
	)

	client, err := m.newS3Client(cfg)
	if err != nil {
		return "", err
	}

	file, err := os.Open(tempFile)
	if err != nil {
		return "", err
	}
	defer file.Close()
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(bucket),
		Key:           aws.String(key),
		Body:          file,
		ContentLength: aws.Int64(size),
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("s3://%s/%s", bucket, key), nil
}

type OpenArtifactOutput struct {
	Reader      io.ReadCloser
	ContentType string
	ContentSize int64
}

func (m *Manager) OpenArtifact(ctx context.Context, orgID string, storagePath string) (*OpenArtifactOutput, error) {
	location, err := url.Parse(storagePath)
	if err != nil {
		return nil, err
	}
	switch strings.ToLower(strings.TrimSpace(location.Scheme)) {
	case "file":
		localPath := filepath.FromSlash(location.Path)
		file, err := os.Open(localPath)
		if err != nil {
			return nil, err
		}
		info, err := file.Stat()
		if err != nil {
			_ = file.Close()
			return nil, err
		}
		return &OpenArtifactOutput{
			Reader:      file,
			ContentType: mime.TypeByExtension(filepath.Ext(localPath)),
			ContentSize: info.Size(),
		}, nil
	case "s3":
		settings, err := m.loadSettings(ctx, orgID)
		if err != nil {
			return nil, err
		}
		if settings.provider != "s3" {
			return nil, fmt.Errorf("org storage provider is not s3")
		}
		client, err := m.newS3Client(settings.cfg)
		if err != nil {
			return nil, err
		}
		key := strings.TrimPrefix(location.Path, "/")
		bucket := location.Host
		if bucket == "" || key == "" {
			return nil, fmt.Errorf("invalid s3 storage path")
		}
		response, err := client.GetObject(ctx, &s3.GetObjectInput{
			Bucket: &bucket,
			Key:    &key,
		})
		if err != nil {
			return nil, err
		}
		contentType := ""
		if response.ContentType != nil {
			contentType = *response.ContentType
		}
		if contentType == "" {
			contentType = mime.TypeByExtension(filepath.Ext(key))
		}
		size := int64(0)
		if response.ContentLength != nil {
			size = *response.ContentLength
		}
		return &OpenArtifactOutput{
			Reader:      response.Body,
			ContentType: contentType,
			ContentSize: size,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported storage path scheme: %s", location.Scheme)
	}
}

func (m *Manager) CleanupExpiredArtifacts(ctx context.Context, batchSize int) (int, error) {
	if m.Store == nil {
		return 0, fmt.Errorf("artifact manager store is not configured")
	}
	if batchSize <= 0 {
		batchSize = 200
	}

	totalDeleted := 0
	for {
		expired, err := m.Store.ListExpiredPipelineArtifacts(ctx, time.Now().UTC(), batchSize)
		if err != nil {
			return totalDeleted, err
		}
		if len(expired) == 0 {
			return totalDeleted, nil
		}

		deletedIDs := make([]string, 0, len(expired))
		for _, artifact := range expired {
			if err := m.deleteStoredArtifact(ctx, artifact.OrgID, artifact.StoragePath); err != nil {
				continue
			}
			deletedIDs = append(deletedIDs, artifact.ID)
		}
		if len(deletedIDs) == 0 {
			return totalDeleted, nil
		}
		if err := m.Store.DeletePipelineArtifactsByID(ctx, deletedIDs); err != nil {
			return totalDeleted, err
		}
		totalDeleted += len(deletedIDs)
	}
}

func (m *Manager) deleteStoredArtifact(ctx context.Context, orgID string, storagePath string) error {
	location, err := url.Parse(storagePath)
	if err != nil {
		return err
	}
	switch strings.ToLower(strings.TrimSpace(location.Scheme)) {
	case "file":
		localPath := filepath.FromSlash(location.Path)
		err := os.Remove(localPath)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	case "s3":
		settings, err := m.loadSettings(ctx, orgID)
		if err != nil {
			return err
		}
		if settings.provider != "s3" {
			return fmt.Errorf("org storage provider is not s3")
		}
		client, err := m.newS3Client(settings.cfg)
		if err != nil {
			return err
		}
		key := strings.TrimPrefix(location.Path, "/")
		bucket := location.Host
		if bucket == "" || key == "" {
			return fmt.Errorf("invalid s3 storage path")
		}
		_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: &bucket,
			Key:    &key,
		})
		return err
	default:
		return fmt.Errorf("unsupported storage path scheme: %s", location.Scheme)
	}
}

func (m *Manager) newS3Client(cfg storageConfig) (*s3.Client, error) {
	accessKey := strings.TrimSpace(cfg.S3AccessKeyID)
	secretKey := strings.TrimSpace(cfg.S3SecretAccessKey)
	if accessKey == "" || secretKey == "" {
		return nil, fmt.Errorf("s3 access key and secret are required")
	}
	region := strings.TrimSpace(cfg.S3Region)
	if region == "" {
		region = "us-east-1"
	}
	client := s3.NewFromConfig(aws.Config{
		Region:       region,
		BaseEndpoint: optionalString(strings.TrimSpace(cfg.S3Endpoint)),
		Credentials:  credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
	}, func(options *s3.Options) {
		options.UsePathStyle = cfg.S3ForcePathStyle
	})
	return client, nil
}

func spoolToTemp(content io.Reader) (string, int64, string, error) {
	file, err := os.CreateTemp("", "spec-axis-artifact-*")
	if err != nil {
		return "", 0, "", err
	}
	defer file.Close()

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, hasher), content)
	if err != nil {
		_ = os.Remove(file.Name())
		return "", 0, "", err
	}
	return file.Name(), written, hex.EncodeToString(hasher.Sum(nil)), nil
}

func sanitizeRelativePath(value string) (string, error) {
	// We always normalize paths to a relative unix style key.
	// Any parent traversal is rejected to keep artifact writes confined.
	normalized := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if normalized == "" {
		return "", fmt.Errorf("artifact path is required")
	}
	normalized = path.Clean("/" + normalized)
	normalized = strings.TrimPrefix(normalized, "/")
	if normalized == "." || strings.HasPrefix(normalized, "../") || strings.Contains(normalized, "/../") {
		return "", fmt.Errorf("invalid artifact path")
	}
	return normalized, nil
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func fileURIFromPath(absolutePath string) string {
	normalized := filepath.ToSlash(absolutePath)
	return (&url.URL{Scheme: "file", Path: normalized}).String()
}

func resolveLocalRoot(dataDir string, localBasePath string, orgID string) (string, error) {
	basePath := strings.TrimSpace(localBasePath)
	if basePath == "" {
		basePath = "artifacts"
	}
	if !filepath.IsAbs(basePath) {
		rootDataDir := strings.TrimSpace(dataDir)
		if rootDataDir == "" {
			rootDataDir = "data"
		}
		basePath = filepath.Join(rootDataDir, basePath)
	}
	absoluteBasePath, err := filepath.Abs(basePath)
	if err != nil {
		return "", err
	}
	return filepath.Join(absoluteBasePath, orgID), nil
}
