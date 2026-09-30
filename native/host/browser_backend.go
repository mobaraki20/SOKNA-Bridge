package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const browserBackendName = "whg517/browser-bridge"
const browserBackendComponentID = "browser-bridge-whg517"
const browserTargetSchema = "sokna-browser-target-v1"
const browserBackendTimeout = 35 * time.Second

type browserTargetClaim struct {
	Schema          string `json:"schema"`
	ConversationKey string `json:"conversation_key"`
	Backend         string `json:"backend"`
	TabID           int    `json:"tab_id"`
	URL             string `json:"url,omitempty"`
	Title           string `json:"title,omitempty"`
	ClaimedAt       int64  `json:"claimed_at"`
}

type browserBackendTab struct {
	ID       int    `json:"id"`
	Title    string `json:"title,omitempty"`
	URL      string `json:"url,omitempty"`
	Active   bool   `json:"active,omitempty"`
	WindowID int    `json:"windowId,omitempty"`
	GroupID  *int   `json:"groupId,omitempty"`
}

type browserManagedRelease struct {
	Path string `json:"path"`
}

type browserManagedComponent struct {
	ActiveVersion string                           `json:"active_version"`
	Releases      map[string]browserManagedRelease `json:"releases"`
}

type browserManagedRegistry struct {
	Components map[string]browserManagedComponent `json:"components"`
}

var browserBackendToolCall = callBrowserBridgeTool

func browserTargetRoot() (string, error) {
	base := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if base == "" {
		var err error
		base, err = os.UserConfigDir()
		if err != nil || strings.TrimSpace(base) == "" {
			return "", errors.New("user config directory unavailable")
		}
	}
	return filepath.Join(base, "SOKNA", "Bridge", "browser-targets"), nil
}

func browserTargetPath(scope string) (string, error) {
	if strings.TrimSpace(scope) == "" || scope == systemConversationKey {
		return "", errors.New("BROWSER_CONVERSATION_REQUIRED")
	}
	root, err := browserTargetRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, scopeHash(scope)+".json"), nil
}

func saveBrowserTarget(claim browserTargetClaim) error {
	p, err := browserTargetPath(claim.ConversationKey)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(claim, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + fmt.Sprintf(".tmp-%d", time.Now().UnixNano())
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func loadBrowserTarget(scope string) (browserTargetClaim, error) {
	var claim browserTargetClaim
	p, err := browserTargetPath(scope)
	if err != nil {
		return claim, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return claim, errors.New("BROWSER_TARGET_REQUIRED: claim a tab first")
		}
		return claim, err
	}
	if err := json.Unmarshal(b, &claim); err != nil {
		return claim, err
	}
	if claim.Schema != browserTargetSchema || claim.ConversationKey != scope || claim.Backend != browserBackendName || claim.TabID <= 0 {
		return claim, errors.New("BROWSER_TARGET_INVALID")
	}
	return claim, nil
}

func releaseBrowserTarget(scope string) error {
	p, err := browserTargetPath(scope)
	if err != nil {
		return err
	}
	err = os.Remove(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func managedBrowserBridgeExecutable() (string, error) {
	configPath, err := resolveConfigPath()
	if err != nil {
		return "", err
	}
	state := filepath.Join(filepath.Dir(configPath), "state", "components.json")
	b, err := os.ReadFile(state)
	if err != nil {
		return "", err
	}
	var registry browserManagedRegistry
	if err := json.Unmarshal(b, &registry); err != nil {
		return "", err
	}
	ids := []string{browserBackendComponentID, "browser-backend-whg517-browser-bridge"}
	for _, id := range ids {
		comp, ok := registry.Components[id]
		if !ok || strings.TrimSpace(comp.ActiveVersion) == "" {
			continue
		}
		rel, ok := comp.Releases[comp.ActiveVersion]
		if !ok || strings.TrimSpace(rel.Path) == "" {
			continue
		}
		name := "browser-bridge"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		candidate := filepath.Join(rel.Path, name)
		if st, er := os.Stat(candidate); er == nil && !st.IsDir() {
			return filepath.Clean(candidate), nil
		}
	}
	return "", errors.New("BROWSER_BACKEND_COMPONENT_NOT_ACTIVE")
}

func browserBridgeExecutable() (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("SOKNA_BROWSER_BRIDGE_PATH")); explicit != "" {
		if !filepath.IsAbs(explicit) {
			return "", errors.New("SOKNA_BROWSER_BRIDGE_PATH must be absolute")
		}
		st, err := os.Stat(explicit)
		if err != nil || st.IsDir() {
			return "", errors.New("SOKNA_BROWSER_BRIDGE_PATH not found")
		}
		return filepath.Clean(explicit), nil
	}
	if p, err := managedBrowserBridgeExecutable(); err == nil {
		return p, nil
	}
	if runtime.GOOS == "windows" {
		if local := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); local != "" {
			p := filepath.Join(local, "browser-bridge", "browser-bridge.exe")
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p, nil
			}
		}
	}
	return "", errors.New("BROWSER_BACKEND_UNAVAILABLE: install/activate the pinned browser backend")
}

func callBrowserBridgeTool(tool string, params map[string]any) (json.RawMessage, error) {
	exe, err := browserBridgeExecutable()
	if err != nil {
		return nil, err
	}
	argsJSON, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), browserBackendTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "call", tool, string(argsJSON))
	cmd.Env = append(os.Environ(), "BB_LOG=error")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, errors.New("BROWSER_BACKEND_TIMEOUT")
	}
	if err != nil {
		code := -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		}
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 700 {
			msg = msg[:700] + "..."
		}
		return nil, fmt.Errorf("BROWSER_BACKEND_CALL_FAILED: tool=%s exit=%d detail=%s", tool, code, msg)
	}
	raw := bytes.TrimSpace(stdout.Bytes())
	if len(raw) == 0 {
		return nil, errors.New("BROWSER_BACKEND_EMPTY_RESULT")
	}
	if !json.Valid(raw) {
		return nil, errors.New("BROWSER_BACKEND_INVALID_JSON")
	}
	return append(json.RawMessage(nil), raw...), nil
}

func browserBackendTabs() ([]browserBackendTab, error) {
	raw, err := browserBackendToolCall("tab_list", map[string]any{})
	if err != nil {
		return nil, err
	}
	var tabs []browserBackendTab
	if err := json.Unmarshal(raw, &tabs); err != nil {
		return nil, errors.New("BROWSER_BACKEND_TAB_LIST_INVALID")
	}
	return tabs, nil
}

func findBrowserTab(tabs []browserBackendTab, id int) (browserBackendTab, bool) {
	for _, t := range tabs {
		if t.ID == id {
			return t, true
		}
	}
	return browserBackendTab{}, false
}

func claimBrowserTab(c CommandEnvelope, tabID int) (browserTargetClaim, error) {
	if tabID <= 0 {
		return browserTargetClaim{}, errors.New("browser.tab.claim requires positive tab_id")
	}
	scope := commandScope(c)
	if scope == systemConversationKey {
		return browserTargetClaim{}, errors.New("BROWSER_CONVERSATION_REQUIRED")
	}
	tabs, err := browserBackendTabs()
	if err != nil {
		return browserTargetClaim{}, err
	}
	tab, ok := findBrowserTab(tabs, tabID)
	if !ok {
		return browserTargetClaim{}, errors.New("BROWSER_TARGET_TAB_NOT_FOUND")
	}
	claim := browserTargetClaim{
		Schema: browserTargetSchema, ConversationKey: scope, Backend: browserBackendName,
		TabID: tab.ID, URL: tab.URL, Title: tab.Title, ClaimedAt: time.Now().UTC().UnixMilli(),
	}
	if err := saveBrowserTarget(claim); err != nil {
		return browserTargetClaim{}, err
	}
	return claim, nil
}

func ensureClaimedBrowserTarget(c CommandEnvelope) (browserTargetClaim, error) {
	scope := commandScope(c)
	claim, err := loadBrowserTarget(scope)
	if err != nil {
		return claim, err
	}
	tabs, err := browserBackendTabs()
	if err != nil {
		return claim, err
	}
	tab, ok := findBrowserTab(tabs, claim.TabID)
	if !ok {
		_ = releaseBrowserTarget(scope)
		return claim, errors.New("BROWSER_TARGET_STALE: claimed tab no longer exists")
	}
	if _, err := browserBackendToolCall("tab_focus", map[string]any{"tabId": claim.TabID}); err != nil {
		return claim, err
	}
	claim.URL = tab.URL
	claim.Title = tab.Title
	return claim, nil
}

func browserBackendStatus() map[string]any {
	exe, err := browserBridgeExecutable()
	if err != nil {
		return map[string]any{
			"ok": true, "schema": "sokna-browser-backend-status-v1", "backend": browserBackendName,
			"available": false, "error": err.Error(), "target_gate": "conversation-claimed-tab",
		}
	}
	return map[string]any{
		"ok": true, "schema": "sokna-browser-backend-status-v1", "backend": browserBackendName,
		"available": true, "executable": exe, "target_gate": "conversation-claimed-tab",
		"ambient_tab_actions": false,
		"disabled_upstream_tools": []string{"page_eval", "cookie_get", "storage_get", "tab_close", "page_snapshot_precise"},
	}
}

func browserPageTool(action string) (string, bool) {
	switch action {
	case "browser.page.snapshot":
		return "page_snapshot", true
	case "browser.page.text":
		return "page_text", true
	case "browser.page.click":
		return "page_click", true
	case "browser.page.fill":
		return "page_fill", true
	case "browser.page.scroll":
		return "page_scroll", true
	case "browser.page.wait":
		return "page_wait_for", true
	case "browser.page.screenshot":
		return "page_screenshot", true
	default:
		return "", false
	}
}

func browserScreenshotArtifact(c CommandEnvelope, claim browserTargetClaim, raw json.RawMessage) (map[string]any, error) {
	var shot struct {
		Image    string `json:"image"`
		MimeType string `json:"mimeType"`
	}
	if err := json.Unmarshal(raw, &shot); err != nil || strings.TrimSpace(shot.Image) == "" {
		return nil, errors.New("BROWSER_SCREENSHOT_RESULT_INVALID")
	}
	if shot.MimeType != "" && !strings.EqualFold(shot.MimeType, "image/png") {
		return nil, errors.New("BROWSER_SCREENSHOT_CONTENT_TYPE_INVALID")
	}
	data, err := base64.StdEncoding.DecodeString(shot.Image)
	if err != nil {
		return nil, errors.New("BROWSER_SCREENSHOT_BASE64_INVALID")
	}
	if len(data) < 8 || !bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		return nil, errors.New("BROWSER_SCREENSHOT_PNG_INVALID")
	}
	if len(data) > 32*1024*1024 {
		return nil, errors.New("BROWSER_SCREENSHOT_TOO_LARGE")
	}
	root, err := configuredArtifactRoot()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, "browser", "live", scopeHash(commandScope(c)))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	name := fmt.Sprintf("viewport-%d-%s.png", time.Now().UTC().UnixMilli(), c.ID)
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return nil, err
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return nil, err
	}
	pub, err := publishArtifact(map[string]any{"path": filepath.ToSlash(rel), "name": name})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"ok": true, "backend": browserBackendName, "target": claim,
		"artifact_ref": pub["artifact_ref"], "capture": "visible_viewport",
	}, nil
}

func localBrowserBackend(c CommandEnvelope) (json.RawMessage, bool, error) {
	action := strings.TrimSpace(c.Action)
	if action != "browser.backend.status" && action != "browser.tabs.list" && action != "browser.tab.open" &&
		action != "browser.tab.claim" && action != "browser.tab.release" {
		if _, ok := browserPageTool(action); !ok {
			return nil, false, nil
		}
	}
	params := parseParams(c.Params)
	var result any
	switch action {
	case "browser.backend.status":
		result = browserBackendStatus()
	case "browser.tabs.list":
		tabs, err := browserBackendTabs()
		if err != nil {
			return nil, true, err
		}
		result = map[string]any{"ok": true, "backend": browserBackendName, "tabs": tabs}
	case "browser.tab.claim":
		tabID := intParam(params, "tab_id", 0)
		claim, err := claimBrowserTab(c, tabID)
		if err != nil {
			return nil, true, err
		}
		result = map[string]any{"ok": true, "claimed": true, "target": claim}
	case "browser.tab.release":
		if err := releaseBrowserTarget(commandScope(c)); err != nil {
			return nil, true, err
		}
		result = map[string]any{"ok": true, "released": true}
	case "browser.tab.open":
		urlValue := strings.TrimSpace(fmt.Sprint(params["url"]))
		if urlValue == "" {
			return nil, true, errors.New("browser.tab.open requires url")
		}
		raw, err := browserBackendToolCall("tab_open", map[string]any{"url": urlValue})
		if err != nil {
			return nil, true, err
		}
		var opened struct {
			Opened int    `json:"opened"`
			URL    string `json:"url"`
		}
		if err := json.Unmarshal(raw, &opened); err != nil || opened.Opened <= 0 {
			return nil, true, errors.New("BROWSER_BACKEND_TAB_OPEN_INVALID")
		}
		autoClaim := true
		if v, ok := params["claim"].(bool); ok {
			autoClaim = v
		}
		if autoClaim {
			claim, err := claimBrowserTab(c, opened.Opened)
			if err != nil {
				return nil, true, err
			}
			result = map[string]any{"ok": true, "opened": opened.Opened, "url": opened.URL, "claimed": true, "target": claim}
		} else {
			result = map[string]any{"ok": true, "opened": opened.Opened, "url": opened.URL, "claimed": false}
		}
	default:
		tool, _ := browserPageTool(action)
		claim, err := ensureClaimedBrowserTarget(c)
		if err != nil {
			return nil, true, err
		}
		upstream := map[string]any{}
		switch action {
		case "browser.page.text":
			if mode := strings.TrimSpace(fmt.Sprint(params["mode"])); mode != "" {
				if mode != "visible" && mode != "full" {
					return nil, true, errors.New("browser.page.text mode must be visible or full")
				}
				upstream["mode"] = mode
			}
		case "browser.page.click":
			if ref := strings.TrimSpace(fmt.Sprint(params["ref"])); ref != "" {
				upstream["ref"] = ref
			}
			if sel := strings.TrimSpace(fmt.Sprint(params["selector"])); sel != "" {
				upstream["selector"] = sel
			}
			if len(upstream) == 0 {
				return nil, true, errors.New("browser.page.click requires ref or selector")
			}
		case "browser.page.fill":
			if ref := strings.TrimSpace(fmt.Sprint(params["ref"])); ref != "" {
				upstream["ref"] = ref
			}
			if sel := strings.TrimSpace(fmt.Sprint(params["selector"])); sel != "" {
				upstream["selector"] = sel
			}
			value, exists := params["value"]
			if !exists {
				return nil, true, errors.New("browser.page.fill requires value")
			}
			upstream["value"] = fmt.Sprint(value)
			if _, hasRef := upstream["ref"]; !hasRef {
				if _, hasSelector := upstream["selector"]; !hasSelector {
					return nil, true, errors.New("browser.page.fill requires ref or selector")
				}
			}
		case "browser.page.scroll":
			if direction := strings.TrimSpace(fmt.Sprint(params["direction"])); direction != "" {
				switch direction {
				case "up", "down", "top", "bottom":
					upstream["direction"] = direction
				default:
					return nil, true, errors.New("browser.page.scroll direction invalid")
				}
			}
			if rawPixels, ok := params["pixels"]; ok {
				pixels, err := strconv.Atoi(strings.Split(fmt.Sprint(rawPixels), ".")[0])
				if err != nil {
					return nil, true, errors.New("browser.page.scroll pixels invalid")
				}
				upstream["pixels"] = pixels
			}
		case "browser.page.wait":
			for _, key := range []string{"selector", "text", "until"} {
				if v := strings.TrimSpace(fmt.Sprint(params[key])); v != "" {
					upstream[key] = v
				}
			}
			for _, key := range []string{"nav", "settled"} {
				if v, ok := params[key].(bool); ok {
					upstream[key] = v
				}
			}
			for _, key := range []string{"minCount", "timeoutMs"} {
				if v, ok := params[key]; ok {
					n, err := strconv.Atoi(strings.Split(fmt.Sprint(v), ".")[0])
					if err != nil || n < 0 {
						return nil, true, fmt.Errorf("browser.page.wait %s invalid", key)
					}
					upstream[key] = n
				}
			}
		}
		raw, err := browserBackendToolCall(tool, upstream)
		if err != nil {
			return nil, true, err
		}
		if action == "browser.page.screenshot" {
			shot, err := browserScreenshotArtifact(c, claim, raw)
			if err != nil {
				return nil, true, err
			}
			result = shot
		} else {
			var payload any
			if err := json.Unmarshal(raw, &payload); err != nil {
				return nil, true, errors.New("BROWSER_BACKEND_RESULT_INVALID")
			}
			result = map[string]any{"ok": true, "backend": browserBackendName, "target": claim, "result": payload}
		}
	}
	b, err := json.Marshal(result)
	return b, true, err
}
