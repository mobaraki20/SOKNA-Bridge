package main

import (
	"encoding/json"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
)

var sensitiveKey = regexp.MustCompile(`(?i)(token|secret|password|passwd|pwd|auth|authorization|cookie|session|api[_-]?key|access[_-]?key|refresh[_-]?token|credential|jwt)`)
var bearerLike = regexp.MustCompile(`(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}`)
var keyValueLike = regexp.MustCompile(`(?i)\b(token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|session|access[_-]?key|refresh[_-]?token)\s*[:=]\s*([^\s,;]+)`)

func redactText(s string) string {
	if s == "" {
		return s
	}
	s = bearerLike.ReplaceAllString(s, "$1 [REDACTED]")
	s = keyValueLike.ReplaceAllString(s, "$1=[REDACTED]")
	if len(s) > 8192 {
		s = s[:8192] + "...[TRUNCATED]"
	}
	return s
}

func knownRecipeSecrets(r Recipe) []string {
	seen := map[string]bool{}
	out := []string{}
	addValue := func(value string) {
		if value != "" && len(value) >= 4 && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	addEnv := func(envName string) {
		if envName == "" {
			return
		}
		if value, ok := os.LookupEnv(envName); ok {
			addValue(value)
		}
	}
	for _, a := range r.Actions {
		addEnv(a.ValueEnv)
		if a.CredentialRef != "" {
			if rec, err := loadCredential(a.CredentialRef); err == nil {
				addValue(rec.Secret)
				addValue(rec.Username)
			}
		}
	}
	for _, c := range r.Setup.Cookies {
		addEnv(c.ValueEnv)
	}
	for _, s := range r.Setup.LocalStorage {
		addEnv(s.ValueEnv)
	}
	return out
}

func redactKnownSecrets(s string, secrets []string) string {
	for _, secret := range secrets {
		if len(secret) < 4 {
			continue
		}
		s = strings.ReplaceAll(s, secret, "[REDACTED]")
	}
	return redactText(s)
}

func redactArtifactValue(v any, secrets []string) any {
	b, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var x any
	if json.Unmarshal(b, &x) != nil {
		return v
	}
	return redactAny(x, secrets)
}

func redactAny(v any, secrets []string) any {
	switch x := v.(type) {
	case string:
		return redactKnownSecrets(x, secrets)
	case []any:
		for i := range x {
			x[i] = redactAny(x[i], secrets)
		}
		return x
	case map[string]any:
		for k := range x {
			x[k] = redactAny(x[k], secrets)
		}
		return x
	default:
		return v
	}
}

func redactURLString(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return redactText(raw)
	}
	if u.User != nil {
		u.User = url.User("[REDACTED]")
	}
	q := u.Query()
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if sensitiveKey.MatchString(k) {
			q.Set(k, "[REDACTED]")
		}
	}
	u.RawQuery = q.Encode()
	u.Fragment = ""
	return u.String()
}

func isAllowedOrigin(raw string, allowed []string) bool {
	o, err := originOf(raw)
	if err != nil {
		return false
	}
	for _, a := range allowed {
		if strings.EqualFold(o, a) {
			return true
		}
	}
	return false
}
