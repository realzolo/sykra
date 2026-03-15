package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

func DecryptSecret(encrypted string) (string, error) {
	keyHex := os.Getenv("ENCRYPTION_KEY")
	if keyHex == "" {
		return "", fmt.Errorf("ENCRYPTION_KEY is not set")
	}
	if len(keyHex) != 64 {
		return "", fmt.Errorf("ENCRYPTION_KEY must be 64 hex characters")
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return "", fmt.Errorf("invalid ENCRYPTION_KEY: %w", err)
	}

	parts := strings.Split(encrypted, ":")
	if len(parts) != 4 {
		return "", fmt.Errorf("invalid encrypted data format")
	}

	ivHex := parts[0]
	authTagHex := parts[1]
	cipherHex := parts[3]

	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		return "", fmt.Errorf("invalid iv: %w", err)
	}
	authTag, err := hex.DecodeString(authTagHex)
	if err != nil {
		return "", fmt.Errorf("invalid auth tag: %w", err)
	}
	cipherText, err := hex.DecodeString(cipherHex)
	if err != nil {
		return "", fmt.Errorf("invalid ciphertext: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher init failed: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm init failed: %w", err)
	}

	combined := append(cipherText, authTag...)
	plain, err := gcm.Open(nil, iv, combined, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt failed: %w", err)
	}

	return string(plain), nil
}
