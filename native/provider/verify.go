package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"strings"
	"time"
)

func envOrLiteral(literal, envName string) (string, error) {
	if strings.TrimSpace(literal) != "" && strings.TrimSpace(envName) != "" {
		return "", errors.New("signature value and env reference are mutually exclusive")
	}
	if strings.TrimSpace(envName) != "" {
		if !validEnvName(envName) {
			return "", errors.New("invalid signature env name")
		}
		v := strings.TrimSpace(os.Getenv(envName))
		if v == "" {
			return "", errors.New("signature env value is empty")
		}
		return v, nil
	}
	return strings.TrimSpace(literal), nil
}

func verifySignature(path string, policy SignaturePolicy) (string, bool, error) {
	if !policy.Required && strings.TrimSpace(policy.Algorithm) == "" && strings.TrimSpace(policy.SignatureB64) == "" && strings.TrimSpace(policy.SignatureEnv) == "" {
		return "not_required", false, nil
	}
	if strings.ToLower(strings.TrimSpace(policy.Algorithm)) != "ed25519-sha256" {
		return "", false, errors.New("unsupported signature algorithm")
	}
	pubText, err := envOrLiteral(policy.PublicKeyB64, policy.PublicKeyEnv)
	if err != nil {
		return "", false, err
	}
	sigText, err := envOrLiteral(policy.SignatureB64, policy.SignatureEnv)
	if err != nil {
		return "", false, err
	}
	if pubText == "" || sigText == "" {
		if policy.Required {
			return "", false, errors.New("required signature material missing")
		}
		return "not_present", false, nil
	}
	pub, err := base64.StdEncoding.DecodeString(pubText)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return "", false, errors.New("invalid ed25519 public key")
	}
	sig, err := base64.StdEncoding.DecodeString(sigText)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return "", false, errors.New("invalid ed25519 signature")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false, err
	}
	digest := sha256.Sum256(data)
	if !ed25519.Verify(ed25519.PublicKey(pub), digest[:], sig) {
		return "invalid", false, errors.New("artifact signature mismatch")
	}
	return "ed25519-sha256", true, nil
}

func verifyFile(path, expected string, maxBytes int64, policy SignaturePolicy) (string, int64, string, bool, error) {
	sha, size, err := sha256File(path)
	if err != nil {
		return "", 0, "", false, err
	}
	if size <= 0 || (maxBytes > 0 && size > maxBytes) {
		return "", 0, "", false, errors.New("artifact size outside policy")
	}
	if expected != "" && sha != strings.ToLower(expected) {
		return sha, size, "", false, errors.New("artifact sha256 mismatch")
	}
	sigName, sigOK, err := verifySignature(path, policy)
	if err != nil {
		return sha, size, sigName, sigOK, err
	}
	return sha, size, sigName, sigOK, nil
}

func verifiedAt() time.Time { return time.Now().UTC() }
