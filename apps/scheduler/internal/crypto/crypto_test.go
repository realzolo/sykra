package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"testing"
)

func TestDecryptSecret_Rejects16ByteIV(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	t.Setenv("ENCRYPTION_KEY", hex.EncodeToString(key))

	plain := "ghp_test_secret_token"
	encrypted := encryptForTest(t, key, 16, plain)

	_, err := DecryptSecret(encrypted)
	if err == nil {
		t.Fatal("expected error for 16-byte IV, got nil")
	}
}

func TestDecryptSecret_SupportsStandard12ByteIV(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(255 - i)
	}
	t.Setenv("ENCRYPTION_KEY", hex.EncodeToString(key))

	plain := "sk-test-123456"
	encrypted := encryptForTest(t, key, 12, plain)

	got, err := DecryptSecret(encrypted)
	if err != nil {
		t.Fatalf("DecryptSecret returned error: %v", err)
	}
	if got != plain {
		t.Fatalf("decrypted value mismatch: got %q want %q", got, plain)
	}
}

func TestDecryptSecret_InvalidAuthTagLength(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	t.Setenv("ENCRYPTION_KEY", hex.EncodeToString(key))

	iv := make([]byte, 16)
	if _, err := rand.Read(iv); err != nil {
		t.Fatalf("failed to generate iv: %v", err)
	}
	cipherText := []byte{1, 2, 3, 4}
	shortTag := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	salt := make([]byte, 64)
	if _, err := rand.Read(salt); err != nil {
		t.Fatalf("failed to generate salt: %v", err)
	}

	encrypted := hex.EncodeToString(iv) + ":" +
		hex.EncodeToString(shortTag) + ":" +
		hex.EncodeToString(salt) + ":" +
		hex.EncodeToString(cipherText)

	_, err := DecryptSecret(encrypted)
	if err == nil {
		t.Fatal("expected error for invalid auth tag length, got nil")
	}
}

func encryptForTest(t *testing.T, key []byte, nonceSize int, plain string) string {
	t.Helper()

	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("failed to create cipher: %v", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, nonceSize)
	if err != nil {
		t.Fatalf("failed to create gcm: %v", err)
	}

	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatalf("failed to generate nonce: %v", err)
	}
	salt := make([]byte, 64)
	if _, err := rand.Read(salt); err != nil {
		t.Fatalf("failed to generate salt: %v", err)
	}

	combined := gcm.Seal(nil, nonce, []byte(plain), nil)
	tagSize := gcm.Overhead()
	cipherText := combined[:len(combined)-tagSize]
	authTag := combined[len(combined)-tagSize:]

	return hex.EncodeToString(nonce) + ":" +
		hex.EncodeToString(authTag) + ":" +
		hex.EncodeToString(salt) + ":" +
		hex.EncodeToString(cipherText)
}
