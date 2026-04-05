package pipeline

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// CheckDockerAvailable verifies that the local Docker daemon is reachable.
// CI sandbox creation depends on this check passing.
func CheckDockerAvailable(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "docker", "info")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker daemon unavailable: %w (%s)", err, strings.TrimSpace(string(output)))
	}
	return nil
}
