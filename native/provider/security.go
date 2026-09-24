package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

var sensitiveQueryKeys = map[string]struct{}{
	"access_token": {}, "token": {}, "api_key": {}, "apikey": {}, "key": {}, "signature": {}, "sig": {},
	"x-amz-credential": {}, "x-amz-signature": {}, "x-amz-security-token": {}, "x-goog-signature": {},
	"se": {}, "sp": {}, "sv": {}, "sr": {}, "skoid": {}, "sktid": {}, "skt": {}, "ske": {}, "sks": {},
}

func validID(s string) bool {
	if len(s) < 1 || len(s) > 100 {
		return false
	}
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-", r) {
			continue
		}
		return false
	}
	return true
}

func normalizeSHA(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "", nil
	}
	if len(s) != 64 {
		return "", errors.New("expected_sha256 must be 64 hex characters")
	}
	if _, err := hex.DecodeString(s); err != nil {
		return "", errors.New("expected_sha256 must be hexadecimal")
	}
	return s, nil
}

func safeFileName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-", r) {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	out := strings.Trim(b.String(), ".")
	if out == "" {
		out = "artifact.bin"
	}
	if len(out) > 120 {
		out = out[:120]
	}
	return out
}

func samePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func cleanAbs(p string) (string, error) {
	if strings.TrimSpace(p) == "" {
		return "", errors.New("path required")
	}
	v, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	return filepath.Clean(v), nil
}

func assertExistingPathNoSymlink(path string) error {
	abs, err := cleanAbs(path)
	if err != nil {
		return err
	}
	for cur := abs; ; cur = filepath.Dir(cur) {
		info, err := os.Lstat(cur)
		if err != nil {
			return err
		}
		mode := info.Mode()
		if mode&os.ModeSymlink != 0 || mode&os.ModeIrregular != 0 {
			return fmt.Errorf("reparse/symlink path blocked: %s", path)
		}
		parent := filepath.Dir(cur)
		if samePath(parent, cur) {
			break
		}
	}
	return nil
}

func resolveManagedChild(root, rel string, mustExist bool) (string, error) {
	rootAbs, err := cleanAbs(root)
	if err != nil {
		return "", err
	}
	if err := assertExistingPathNoSymlink(rootAbs); err != nil {
		return "", err
	}
	if filepath.IsAbs(rel) {
		return "", errors.New("managed relative path must not be absolute")
	}
	cleanRel := filepath.Clean(rel)
	if cleanRel == "." || cleanRel == "" || cleanRel == ".." || strings.HasPrefix(cleanRel, ".."+string(filepath.Separator)) {
		return "", errors.New("managed relative path invalid")
	}
	full := filepath.Join(rootAbs, cleanRel)
	relCheck, err := filepath.Rel(rootAbs, full)
	if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) || filepath.IsAbs(relCheck) {
		return "", errors.New("managed path escapes root")
	}
	if mustExist {
		if err := assertExistingPathNoSymlink(full); err != nil {
			return "", err
		}
	} else {
		parent := filepath.Dir(full)
		for {
			if _, err := os.Lstat(parent); err == nil {
				if err := assertExistingPathNoSymlink(parent); err != nil {
					return "", err
				}
				break
			}
			next := filepath.Dir(parent)
			if next == parent {
				return "", errors.New("managed parent not found")
			}
			parent = next
		}
	}
	return full, nil
}

func sanitizeURL(raw string, fromEnv bool, allowHTTP bool) (*url.URL, string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, "", errors.New("invalid URL")
	}
	if u.User != nil {
		return nil, "", errors.New("URL userinfo credentials are forbidden")
	}
	if u.Hostname() == "" {
		return nil, "", errors.New("URL host required")
	}
	if u.Scheme != "https" && !(allowHTTP && u.Scheme == "http") {
		return nil, "", errors.New("remote provider requires HTTPS")
	}
	if !fromEnv {
		for k := range u.Query() {
			if _, ok := sensitiveQueryKeys[strings.ToLower(k)]; ok {
				return nil, "", errors.New("credential-bearing URL must be supplied via url_env")
			}
		}
	}
	ref := *u
	ref.RawQuery = ""
	ref.Fragment = ""
	ref.User = nil
	return u, ref.String(), nil
}

func sourceURL(src ProviderSource, allowHTTP bool) (*url.URL, string, error) {
	if strings.TrimSpace(src.URL) != "" && strings.TrimSpace(src.URLEnv) != "" {
		return nil, "", errors.New("specify url or url_env, not both")
	}
	if strings.TrimSpace(src.URLEnv) != "" {
		if !validEnvName(src.URLEnv) {
			return nil, "", errors.New("invalid url_env name")
		}
		raw := os.Getenv(src.URLEnv)
		if strings.TrimSpace(raw) == "" {
			return nil, "", errors.New("url_env is empty")
		}
		return sanitizeURL(raw, true, allowHTTP)
	}
	if strings.TrimSpace(src.URL) == "" {
		return nil, "", errors.New("remote URL required")
	}
	return sanitizeURL(src.URL, false, allowHTTP)
}

func validEnvName(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for i, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || r == '_' || (i > 0 && r >= '0' && r <= '9') {
			continue
		}
		return false
	}
	return true
}

func sha256File(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func sourceFingerprint(provider, sourceRef, expected string) string {
	h := sha256.Sum256([]byte(provider + "\n" + sourceRef + "\n" + strings.ToLower(expected)))
	return hex.EncodeToString(h[:])
}

var errorURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)
var errorSecretPattern = regexp.MustCompile(`(?i)(access_token|token|api_key|apikey|signature|sig|x-amz-credential|x-amz-signature|x-amz-security-token)=([^&\s]+)`)
var errorBearerPattern = regexp.MustCompile(`(?i)Bearer\s+[A-Za-z0-9._~+\-/=]+`)

func redactErrorMessage(message string) string {
	message = errorURLPattern.ReplaceAllStringFunc(message, func(raw string) string {
		trail := ""
		for len(raw) > 0 && strings.ContainsRune(".,;:)]}", rune(raw[len(raw)-1])) {
			trail = raw[len(raw)-1:] + trail
			raw = raw[:len(raw)-1]
		}
		if u, err := url.Parse(raw); err == nil && u.Hostname() != "" {
			u.RawQuery = ""
			u.Fragment = ""
			u.User = nil
			return u.String() + trail
		}
		return "[REDACTED_URL]" + trail
	})
	message = errorSecretPattern.ReplaceAllString(message, `$1=[REDACTED]`)
	message = errorBearerPattern.ReplaceAllString(message, `Bearer [REDACTED]`)
	return message
}
