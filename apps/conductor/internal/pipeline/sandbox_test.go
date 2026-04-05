package pipeline

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCacheVolumeMountsNamespaceByImage(t *testing.T) {
	workspaceDir := t.TempDir()
	packageJSON := `{"name":"demo","packageManager":"pnpm@9.0.0"}`
	if err := os.WriteFile(filepath.Join(workspaceDir, "package.json"), []byte(packageJSON), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}

	mountsA := cacheVolumeMounts(workspaceDir, "node:20-alpine")
	mountsB := cacheVolumeMounts(workspaceDir, "node:22-alpine")
	if len(mountsA) != 1 || len(mountsB) != 1 {
		t.Fatalf("expected single pnpm cache mount, got %v and %v", mountsA, mountsB)
	}
	if mountsA[0] == mountsB[0] {
		t.Fatalf("expected cache namespace to differ by image, got %s", mountsA[0])
	}
	if !strings.Contains(mountsA[0], "sykra-cache-pnpm-") {
		t.Fatalf("expected pnpm cache mount naming, got %s", mountsA[0])
	}
}

func TestSandboxValidationProfileIncludesPackageManager(t *testing.T) {
	workspaceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspaceDir, "package-lock.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("write package-lock.json: %v", err)
	}

	profile := sandboxValidationProfile("node:20", workspaceDir)
	if !strings.Contains(profile, "node:20|npm") {
		t.Fatalf("unexpected validation profile: %s", profile)
	}
}
