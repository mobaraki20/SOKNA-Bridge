package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type engine struct {
	allowHTTP bool
	sleep     func(time.Duration)
}

func newEngine() *engine       { return &engine{sleep: time.Sleep} }
func origin(u *url.URL) string { return strings.ToLower(u.Scheme + "://" + u.Host) }

func originAllowed(next *url.URL, initial *url.URL, extras []string, provider string) bool {
	if origin(next) == origin(initial) {
		return true
	}
	allowed := map[string]bool{}
	for _, raw := range extras {
		if x, err := url.Parse(raw); err == nil && x.Hostname() != "" {
			allowed[origin(x)] = true
		}
	}
	if provider == "github_release_asset" {
		h := strings.ToLower(next.Hostname())
		if h == "github.com" || h == "objects.githubusercontent.com" || strings.HasSuffix(h, ".githubusercontent.com") {
			return true
		}
	}
	return allowed[origin(next)]
}

func (e *engine) httpClient(initial *url.URL, extras []string, provider string, timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if req.URL.User != nil {
			return errors.New("redirect userinfo forbidden")
		}
		if req.URL.Scheme != "https" && !(e.allowHTTP && req.URL.Scheme == "http") {
			return errors.New("redirect downgraded from HTTPS")
		}
		if !originAllowed(req.URL, initial, extras, provider) {
			return fmt.Errorf("redirect origin not allowed: %s", origin(req.URL))
		}
		if len(via) > 0 && origin(req.URL) != origin(via[0].URL) {
			req.Header.Del("Authorization")
		}
		return nil
	}}
}

func bearerFromEnv(name string) (string, error) {
	if strings.TrimSpace(name) == "" {
		return "", nil
	}
	if !validEnvName(name) {
		return "", errors.New("invalid credential_env name")
	}
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return "", errors.New("credential_env is empty")
	}
	return v, nil
}

func applyBearerFromEnv(req *http.Request, name string) error {
	token, err := bearerFromEnv(name)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return nil
}

func (e *engine) githubResolve(ctx context.Context, req ProviderRequest) (*url.URL, string, error) {
	repo := strings.TrimSpace(req.Source.Repository)
	tag := strings.TrimSpace(req.Source.Tag)
	asset := strings.TrimSpace(req.Source.Asset)
	if repo == "" || asset == "" || strings.Count(repo, "/") != 1 {
		return nil, "", errors.New("github provider requires repository owner/name and asset")
	}
	for _, part := range strings.Split(repo, "/") {
		if !validGitHubPart(part) {
			return nil, "", errors.New("invalid github repository")
		}
	}
	if tag == "" {
		tag = "latest"
	}
	var api string
	if tag == "latest" {
		api = "https://api.github.com/repos/" + repo + "/releases/latest"
	} else {
		api = "https://api.github.com/repos/" + repo + "/releases/tags/" + url.PathEscape(tag)
	}
	u, _ := url.Parse(api)
	client := e.httpClient(u, req.Source.AllowedRedirectOrigins, req.Provider, requestTimeout(req))
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, api, nil)
	httpReq.Header.Set("Accept", "application/vnd.github+json")
	httpReq.Header.Set("User-Agent", "SOKNA-Artifact-Provider/1")
	if err := applyBearerFromEnv(httpReq, req.Source.CredentialEnv); err != nil {
		return nil, "", err
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, "", fmt.Errorf("github release probe failed: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, "", err
	}
	var payload struct {
		Assets []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, "", errors.New("github release response invalid")
	}
	for _, a := range payload.Assets {
		if a.Name == asset {
			ru, ref, err := sanitizeURL(a.BrowserDownloadURL, true, e.allowHTTP)
			if err != nil {
				return nil, "", err
			}
			return ru, ref, nil
		}
	}
	return nil, "", errors.New("github release asset not found")
}

func validGitHubPart(s string) bool {
	if s == "" || len(s) > 100 {
		return false
	}
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}
func requestTimeout(req ProviderRequest) time.Duration {
	s := req.TimeoutSeconds
	if s <= 0 {
		s = 120
	}
	if s > 900 {
		s = 900
	}
	return time.Duration(s) * time.Second
}
func requestRetries(req ProviderRequest) int {
	n := req.Retries
	if n <= 0 {
		n = 3
	}
	if n > 5 {
		n = 5
	}
	return n
}
func requestBackoff(req ProviderRequest) time.Duration {
	n := req.BackoffMS
	if n <= 0 {
		n = 500
	}
	if n > 5000 {
		n = 5000
	}
	return time.Duration(n) * time.Millisecond
}
func (e *engine) resolveRemoteURL(ctx context.Context, req ProviderRequest) (*url.URL, string, error) {
	if req.Provider == "github_release_asset" && strings.TrimSpace(req.Source.URL) == "" && strings.TrimSpace(req.Source.URLEnv) == "" {
		return e.githubResolve(ctx, req)
	}
	return sourceURL(req.Source, e.allowHTTP)
}
func contentType(resp *http.Response, fileName string) string {
	ct := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	if ct != "" {
		return ct
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".zip":
		return "application/zip"
	case ".json":
		return "application/json"
	case ".png":
		return "image/png"
	case ".txt", ".log":
		return "text/plain"
	}
	return "application/octet-stream"
}
func remoteFileName(u *url.URL, fallback string) string {
	n := filepath.Base(u.Path)
	if n == "." || n == "/" || n == "" {
		n = fallback
	}
	return safeFileName(n)
}
func redactedURL(u *url.URL) string {
	if u == nil {
		return ""
	}
	x := *u
	x.RawQuery = ""
	x.Fragment = ""
	x.User = nil
	return x.String()
}

func (e *engine) probeHTTP(ctx context.Context, req ProviderRequest) (probeResult, error) {
	u, ref, err := e.resolveRemoteURL(ctx, req)
	if err != nil {
		return probeResult{}, err
	}
	client := e.httpClient(u, req.Source.AllowedRedirectOrigins, req.Provider, requestTimeout(req))
	do := func(method string) (*http.Response, error) {
		httpReq, _ := http.NewRequestWithContext(ctx, method, u.String(), nil)
		httpReq.Header.Set("User-Agent", "SOKNA-Artifact-Provider/1")
		if method == http.MethodGet {
			httpReq.Header.Set("Range", "bytes=0-0")
		}
		if err := applyBearerFromEnv(httpReq, req.Source.CredentialEnv); err != nil {
			return nil, err
		}
		return client.Do(httpReq)
	}
	resp, err := do(http.MethodHead)
	if err != nil {
		return probeResult{}, err
	}
	if resp.StatusCode == http.StatusMethodNotAllowed || resp.StatusCode == http.StatusNotImplemented {
		resp.Body.Close()
		resp, err = do(http.MethodGet)
		if err != nil {
			return probeResult{}, err
		}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return probeResult{}, fmt.Errorf("remote probe failed: HTTP %d", resp.StatusCode)
	}
	size := int64(-1)
	if v := resp.Header.Get("Content-Length"); v != "" {
		if n, e2 := strconv.ParseInt(v, 10, 64); e2 == nil {
			size = n
		}
	}
	if cr := resp.Header.Get("Content-Range"); strings.HasPrefix(cr, "bytes ") {
		if slash := strings.LastIndex(cr, "/"); slash >= 0 {
			if n, e2 := strconv.ParseInt(cr[slash+1:], 10, 64); e2 == nil {
				size = n
			}
		}
	}
	name := remoteFileName(resp.Request.URL, req.ArtifactID+".bin")
	return probeResult{SourceRef: ref, ResolvedRef: redactedURL(resp.Request.URL), FileName: name, Size: size, ContentType: contentType(resp, name), RemoteURL: u.String()}, nil
}

func retryableStatus(code int) bool { return code == 408 || code == 425 || code == 429 || code >= 500 }

func (e *engine) acquireHTTP(ctx context.Context, req ProviderRequest, partial string, u *url.URL) (int64, int, int64, string, string, error) {
	attempts := requestRetries(req)
	backoff := requestBackoff(req)
	var resumedAt int64
	var last error
	fileName := remoteFileName(u, req.ArtifactID+".bin")
	ct := "application/octet-stream"
	for attempt := 1; attempt <= attempts; attempt++ {
		current := int64(0)
		if st, err := os.Stat(partial); err == nil {
			current = st.Size()
		}
		if current > req.MaxBytes {
			_ = os.Remove(partial)
			return 0, attempt, 0, "", "", errors.New("partial artifact exceeds size policy")
		}
		httpReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		httpReq.Header.Set("User-Agent", "SOKNA-Artifact-Provider/1")
		if err := applyBearerFromEnv(httpReq, req.Source.CredentialEnv); err != nil {
			return 0, attempt, resumedAt, "", "", err
		}
		if current > 0 {
			httpReq.Header.Set("Range", fmt.Sprintf("bytes=%d-", current))
			if resumedAt == 0 {
				resumedAt = current
			}
		}
		client := e.httpClient(u, req.Source.AllowedRedirectOrigins, req.Provider, requestTimeout(req))
		resp, err := client.Do(httpReq)
		if err != nil {
			last = err
			if attempt < attempts {
				e.sleep(backoff * time.Duration(attempt))
				continue
			}
			break
		}
		func() {
			defer resp.Body.Close()
			if retryableStatus(resp.StatusCode) {
				last = fmt.Errorf("remote HTTP %d", resp.StatusCode)
				return
			}
			if resp.StatusCode != 200 && resp.StatusCode != 206 {
				last = fmt.Errorf("remote HTTP %d", resp.StatusCode)
				return
			}
			appendMode := current > 0 && resp.StatusCode == 206
			if current > 0 && resp.StatusCode == 200 {
				current = 0
				appendMode = false
				resumedAt = 0
			}
			flags := os.O_CREATE | os.O_WRONLY
			if appendMode {
				flags |= os.O_APPEND
			} else {
				flags |= os.O_TRUNC
			}
			f, e2 := os.OpenFile(partial, flags, 0644)
			if e2 != nil {
				last = e2
				return
			}
			defer f.Close()
			limit := req.MaxBytes - current + 1
			if limit <= 0 {
				last = errors.New("artifact size outside policy")
				return
			}
			n, e2 := io.Copy(f, io.LimitReader(resp.Body, limit))
			if e2 != nil {
				last = e2
				return
			}
			if e2 = f.Sync(); e2 != nil {
				last = e2
				return
			}
			if current+n > req.MaxBytes {
				last = errors.New("artifact exceeds size policy")
				return
			}
			ct = contentType(resp, fileName)
			last = nil
		}()
		if last == nil {
			st, _ := os.Stat(partial)
			return st.Size(), attempt, resumedAt, fileName, ct, nil
		}
		if attempt < attempts {
			e.sleep(backoff * time.Duration(attempt))
			continue
		}
	}
	if last == nil {
		last = errors.New("remote acquisition failed")
	}
	return 0, attempts, resumedAt, fileName, ct, last
}
