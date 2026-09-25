package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
)

const (
	recipeSchema = "sokna-browser-recipe-v1"
	reportSchema = "sokna-browser-qa-report-v1"
	toolVersion  = "0.4.0-p3"
)

type Viewport struct {
	ID     string  `json:"id"`
	Width  int     `json:"width"`
	Height int     `json:"height"`
	DPR    float64 `json:"dpr,omitempty"`
}

type Action struct {
	Op              string `json:"op"`
	URL             string `json:"url,omitempty"`
	Selector        string `json:"selector,omitempty"`
	Text            string `json:"text,omitempty"`
	Value           string `json:"value,omitempty"`
	ValueEnv        string `json:"value_env,omitempty"`
	CredentialRef   string `json:"credential_ref,omitempty"`
	CredentialField string `json:"credential_field,omitempty"`
	MS              int    `json:"ms,omitempty"`
	Timeout         int    `json:"timeout_ms,omitempty"`
}

type Assertion struct {
	Type     string  `json:"type"`
	Selector string  `json:"selector,omitempty"`
	Max      int     `json:"max,omitempty"`
	MaxRatio float64 `json:"max_ratio,omitempty"`
	Required bool    `json:"required,omitempty"`
}

type CaptureConfig struct {
	Screenshot     bool     `json:"screenshot,omitempty"`
	FullPage       bool     `json:"full_page,omitempty"`
	DOM            bool     `json:"dom,omitempty"`
	Geometry       bool     `json:"geometry,omitempty"`
	A11y           bool     `json:"a11y,omitempty"`
	Console        bool     `json:"console,omitempty"`
	Network        bool     `json:"network,omitempty"`
	SlowResourceMS int      `json:"slow_resource_ms,omitempty"`
	Elements       []string `json:"elements,omitempty"`
}

type CookieSetup struct {
	Name     string `json:"name"`
	ValueEnv string `json:"value_env"`
	Domain   string `json:"domain,omitempty"`
	Path     string `json:"path,omitempty"`
	Secure   bool   `json:"secure,omitempty"`
	HTTPOnly bool   `json:"http_only,omitempty"`
}

type StorageSetup struct {
	Key      string `json:"key"`
	ValueEnv string `json:"value_env"`
}

type SetupConfig struct {
	Cookies      []CookieSetup  `json:"cookies,omitempty"`
	LocalStorage []StorageSetup `json:"local_storage,omitempty"`
}

type VisualConfig struct {
	Enabled         bool    `json:"enabled,omitempty"`
	MaxChangedRatio float64 `json:"max_changed_ratio,omitempty"`
}

type Recipe struct {
	Schema         string        `json:"schema"`
	ScenarioID     string        `json:"scenario_id"`
	URL            string        `json:"url"`
	Route          string        `json:"route,omitempty"`
	Workspace      string        `json:"workspace,omitempty"`
	JobID          string        `json:"job_id,omitempty"`
	Commit         string        `json:"commit,omitempty"`
	Build          string        `json:"build,omitempty"`
	AllowedOrigins []string      `json:"allowed_origins,omitempty"`
	Viewports      []Viewport    `json:"viewports"`
	Actions        []Action      `json:"actions,omitempty"`
	Assertions     []Assertion   `json:"assertions,omitempty"`
	Captures       CaptureConfig `json:"captures"`
	Setup          SetupConfig   `json:"setup,omitempty"`
	Visual         VisualConfig  `json:"visual,omitempty"`
}

type Artifact struct {
	ID          string `json:"artifact_id"`
	Kind        string `json:"kind"`
	ViewportID  string `json:"viewport_id,omitempty"`
	Path        string `json:"path"`
	Bytes       int64  `json:"bytes"`
	SHA256      string `json:"sha256"`
	ContentType string `json:"content_type"`
}

type Finding struct {
	Severity   string `json:"severity"`
	Code       string `json:"code"`
	Message    string `json:"message"`
	ViewportID string `json:"viewport_id,omitempty"`
	EvidenceID string `json:"evidence_artifact_id,omitempty"`
}

type ViewportResult struct {
	Status     string         `json:"status"`
	Viewport   Viewport       `json:"viewport"`
	OK         bool           `json:"ok"`
	URL        string         `json:"url"`
	Title      string         `json:"title"`
	StatusCode int            `json:"status_code,omitempty"`
	Findings   []Finding      `json:"findings"`
	Metrics    map[string]any `json:"metrics"`
	Artifacts  []Artifact     `json:"artifacts"`
}

type Report struct {
	Schema       string           `json:"schema"`
	OK           bool             `json:"ok"`
	Status       string           `json:"status"`
	ToolVersion  string           `json:"tool_version"`
	ScenarioID   string           `json:"scenario_id"`
	RecipeSHA256 string           `json:"recipe_sha256"`
	StartedAt    string           `json:"started_at"`
	FinishedAt   string           `json:"finished_at"`
	Browser      string           `json:"browser"`
	BrowserPath  string           `json:"browser_path"`
	Workspace    string           `json:"workspace,omitempty"`
	JobID        string           `json:"job_id,omitempty"`
	Commit       string           `json:"commit,omitempty"`
	Build        string           `json:"build,omitempty"`
	Results      []ViewportResult `json:"results"`
	Findings     []Finding        `json:"findings"`
	Artifacts    []Artifact       `json:"artifacts"`
}

var safeID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)

func loadRecipe(path string) (Recipe, []byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Recipe{}, nil, err
	}
	if len(raw) > 1<<20 {
		return Recipe{}, nil, errors.New("recipe exceeds 1 MiB")
	}
	var r Recipe
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&r); err != nil {
		return Recipe{}, nil, fmt.Errorf("invalid recipe JSON: %w", err)
	}
	if err := validateRecipe(&r); err != nil {
		return Recipe{}, nil, err
	}
	return r, raw, nil
}

func validateRecipe(r *Recipe) error {
	if r.Schema != recipeSchema {
		return fmt.Errorf("unsupported recipe schema: %q", r.Schema)
	}
	if !safeID.MatchString(r.ScenarioID) {
		return errors.New("scenario_id must match [A-Za-z0-9._-]{1,100}")
	}
	if err := validateHTTPURL(r.URL); err != nil {
		return fmt.Errorf("url: %w", err)
	}
	if len(r.Viewports) == 0 || len(r.Viewports) > 12 {
		return errors.New("viewports must contain 1..12 entries")
	}
	seen := map[string]bool{}
	for i := range r.Viewports {
		v := &r.Viewports[i]
		if !safeID.MatchString(v.ID) {
			return fmt.Errorf("viewport[%d].id invalid", i)
		}
		if seen[v.ID] {
			return fmt.Errorf("duplicate viewport id: %s", v.ID)
		}
		seen[v.ID] = true
		if v.Width < 240 || v.Width > 7680 || v.Height < 240 || v.Height > 4320 {
			return fmt.Errorf("viewport %s dimensions outside safe range", v.ID)
		}
		if v.DPR == 0 {
			v.DPR = 1
		}
		if v.DPR < 0.5 || v.DPR > 4 {
			return fmt.Errorf("viewport %s dpr outside 0.5..4", v.ID)
		}
	}
	if len(r.Actions) > 100 {
		return errors.New("max 100 actions")
	}
	for i, a := range r.Actions {
		switch a.Op {
		case "goto":
			if err := validateHTTPURL(a.URL); err != nil {
				return fmt.Errorf("action[%d] goto: %w", i, err)
			}
		case "wait", "click", "type", "select":
		default:
			return fmt.Errorf("action[%d] unsupported op %q", i, a.Op)
		}
		if len(a.Selector) > 1000 || len(a.Text) > 65536 || len(a.Value) > 65536 || len(a.ValueEnv) > 200 || len(a.CredentialRef) > 100 || len(a.CredentialField) > 20 {
			return fmt.Errorf("action[%d] input too large", i)
		}
		if a.Value != "" && a.ValueEnv != "" {
			return fmt.Errorf("action[%d] cannot set both value and value_env", i)
		}
		if a.CredentialRef != "" {
			if !safeID.MatchString(a.CredentialRef) {
				return fmt.Errorf("action[%d] credential_ref invalid", i)
			}
			if a.CredentialField != "username" && a.CredentialField != "secret" && a.CredentialField != "password" {
				return fmt.Errorf("action[%d] credential_field must be username or secret", i)
			}
			if a.Value != "" || a.ValueEnv != "" || a.Text != "" {
				return fmt.Errorf("action[%d] credential_ref cannot be combined with value/value_env/text", i)
			}
		} else if a.CredentialField != "" {
			return fmt.Errorf("action[%d] credential_field requires credential_ref", i)
		}
	}
	if len(r.Assertions) > 100 {
		return errors.New("max 100 assertions")
	}
	for i, a := range r.Assertions {
		switch a.Type {
		case "selector_visible", "selector_hidden", "no_horizontal_overflow", "console_errors_max", "network_failures_max", "visual_changed_ratio_max":
		default:
			return fmt.Errorf("assertion[%d] unsupported type %q", i, a.Type)
		}
		if len(a.Selector) > 1000 {
			return fmt.Errorf("assertion[%d] selector too large", i)
		}
	}
	if len(r.Captures.Elements) > 30 {
		return errors.New("max 30 element captures")
	}
	if r.Captures.SlowResourceMS == 0 {
		r.Captures.SlowResourceMS = 2000
	}
	if r.Captures.SlowResourceMS < 100 || r.Captures.SlowResourceMS > 120000 {
		return errors.New("captures.slow_resource_ms must be 100..120000")
	}
	for _, s := range r.Captures.Elements {
		if len(s) == 0 || len(s) > 1000 {
			return errors.New("invalid element capture selector")
		}
	}
	if r.Visual.MaxChangedRatio == 0 {
		r.Visual.MaxChangedRatio = 0.001
	}
	if r.Visual.MaxChangedRatio < 0 || r.Visual.MaxChangedRatio > 1 {
		return errors.New("visual.max_changed_ratio must be 0..1")
	}
	origins, err := normalizedAllowedOrigins(r)
	if err != nil {
		return err
	}
	r.AllowedOrigins = origins
	for i, c := range r.Setup.Cookies {
		if c.Name == "" || c.ValueEnv == "" || len(c.Name) > 256 || len(c.ValueEnv) > 200 {
			return fmt.Errorf("setup.cookies[%d] requires name and value_env", i)
		}
		if _, ok := os.LookupEnv(c.ValueEnv); !ok {
			return fmt.Errorf("setup.cookies[%d] environment secret %s is missing", i, c.ValueEnv)
		}
	}
	for i, s := range r.Setup.LocalStorage {
		if s.Key == "" || s.ValueEnv == "" || len(s.Key) > 512 || len(s.ValueEnv) > 200 {
			return fmt.Errorf("setup.local_storage[%d] requires key and value_env", i)
		}
		if _, ok := os.LookupEnv(s.ValueEnv); !ok {
			return fmt.Errorf("setup.local_storage[%d] environment secret %s is missing", i, s.ValueEnv)
		}
	}
	return nil
}

func validateHTTPURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("only http/https URLs are allowed")
	}
	if u.Hostname() == "" {
		return errors.New("host required")
	}
	if u.User != nil {
		return errors.New("userinfo/credentials in URL are forbidden")
	}
	return nil
}

func originOf(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Host)
	if scheme != "http" && scheme != "https" || host == "" {
		return "", errors.New("invalid origin")
	}
	return scheme + "://" + host, nil
}

func normalizedAllowedOrigins(r *Recipe) ([]string, error) {
	first, err := originOf(r.URL)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{first: true}
	for _, raw := range r.AllowedOrigins {
		o, err := originOf(raw)
		if err != nil {
			return nil, fmt.Errorf("allowed_origins: %w", err)
		}
		set[o] = true
	}
	for _, a := range r.Actions {
		if a.Op == "goto" {
			o, err := originOf(a.URL)
			if err != nil {
				return nil, err
			}
			if !set[o] {
				return nil, fmt.Errorf("goto origin %s is outside allowed_origins", o)
			}
		}
	}
	out := make([]string, 0, len(set))
	for o := range set {
		out = append(out, o)
	}
	sort.Strings(out)
	return out, nil
}

func recipeHash(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }
