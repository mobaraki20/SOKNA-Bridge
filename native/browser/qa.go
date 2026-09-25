package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func jsString(s string) string { b, _ := json.Marshal(s); return string(b) }

func resolveActionValue(a Action) (string, error) {
	if a.CredentialRef != "" {
		return credentialValue(a.CredentialRef, a.CredentialField)
	}
	if a.ValueEnv != "" {
		v, ok := os.LookupEnv(a.ValueEnv)
		if !ok {
			return "", fmt.Errorf("environment value %s missing", a.ValueEnv)
		}
		return v, nil
	}
	if a.Value != "" {
		return a.Value, nil
	}
	return a.Text, nil
}

func waitSelector(c *cdpClient, selector string, visible bool, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	expr := fmt.Sprintf(`(()=>{const e=document.querySelector(%s);if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);const v=!!(r.width||r.height)&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity||1)>0;return %t?v:!v})()`, jsString(selector), visible)
	for time.Now().Before(deadline) {
		v, err := c.evaluate(expr)
		if err == nil {
			if b, ok := v.(bool); ok && b {
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("selector wait timeout: %s", selector)
}

func currentPage(c *cdpClient) (title, url string, err error) {
	v, err := c.evaluate(`({title:document.title,url:location.href})`)
	if err != nil {
		return "", "", err
	}
	m, ok := v.(map[string]any)
	if !ok {
		return "", "", errors.New("page metadata shape invalid")
	}
	return fmt.Sprint(m["title"]), fmt.Sprint(m["url"]), nil
}

func executeAction(c *cdpClient, a Action, allowed []string) error {
	to := time.Duration(a.Timeout) * time.Millisecond
	if to <= 0 {
		to = 10 * time.Second
	}
	switch a.Op {
	case "goto":
		if !isAllowedOrigin(a.URL, allowed) {
			return errors.New("navigation origin outside allowed_origins")
		}
		if err := c.navigate(a.URL, to); err != nil {
			return err
		}
	case "wait":
		if a.Selector != "" {
			if err := waitSelector(c, a.Selector, true, to); err != nil {
				return err
			}
		} else {
			ms := a.MS
			if ms <= 0 {
				ms = 250
			}
			if ms > 30000 {
				return errors.New("wait exceeds 30s")
			}
			time.Sleep(time.Duration(ms) * time.Millisecond)
		}
	case "click":
		if a.Selector == "" {
			return errors.New("click selector required")
		}
		if err := waitSelector(c, a.Selector, true, to); err != nil {
			return err
		}
		expr := fmt.Sprintf(`(()=>{const e=document.querySelector(%s);if(!e)throw new Error('selector missing');e.scrollIntoView({block:'center',inline:'center'});e.click();return true})()`, jsString(a.Selector))
		if _, err := c.evaluate(expr); err != nil {
			return err
		}
		time.Sleep(150 * time.Millisecond)
	case "type":
		if a.Selector == "" {
			return errors.New("type selector required")
		}
		if err := waitSelector(c, a.Selector, true, to); err != nil {
			return err
		}
		value, err := resolveActionValue(a)
		if err != nil {
			return err
		}
		expr := fmt.Sprintf(`(()=>{const e=document.querySelector(%s);if(!e)throw new Error('selector missing');e.focus();e.value=%s;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`, jsString(a.Selector), jsString(value))
		if _, err := c.evaluate(expr); err != nil {
			return err
		}
	case "select":
		if a.Selector == "" {
			return errors.New("select selector required")
		}
		if err := waitSelector(c, a.Selector, true, to); err != nil {
			return err
		}
		value, err := resolveActionValue(a)
		if err != nil {
			return err
		}
		expr := fmt.Sprintf(`(()=>{const e=document.querySelector(%s);if(!e)throw new Error('selector missing');e.value=%s;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`, jsString(a.Selector), jsString(value))
		if _, err := c.evaluate(expr); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported action %q", a.Op)
	}
	_, u, err := currentPage(c)
	if err == nil && !isAllowedOrigin(u, allowed) {
		return fmt.Errorf("top-level navigation escaped allowed_origins: %s", redactURL(u))
	}
	return nil
}

func applySetup(c *cdpClient, r Recipe) error {
	for _, ck := range r.Setup.Cookies {
		v := os.Getenv(ck.ValueEnv)
		params := map[string]any{"name": ck.Name, "value": v, "secure": ck.Secure, "httpOnly": ck.HTTPOnly}
		if ck.Domain != "" {
			params["domain"] = ck.Domain
		} else {
			params["url"] = r.URL
		}
		if ck.Path != "" {
			params["path"] = ck.Path
		}
		res, err := c.send("Network.setCookie", params, true, 10*time.Second)
		if err != nil {
			return err
		}
		var x struct {
			Success bool `json:"success"`
		}
		if json.Unmarshal(res, &x) == nil && !x.Success {
			return fmt.Errorf("failed to set cookie %s", ck.Name)
		}
	}
	if err := c.navigate(r.URL, 20*time.Second); err != nil {
		return err
	}
	_, currentURL, err := currentPage(c)
	if err != nil {
		return err
	}
	if !isAllowedOrigin(currentURL, r.AllowedOrigins) {
		return fmt.Errorf("initial navigation escaped allowed_origins: %s", redactURL(currentURL))
	}
	if len(r.Setup.LocalStorage) > 0 {
		for _, st := range r.Setup.LocalStorage {
			v := os.Getenv(st.ValueEnv)
			expr := fmt.Sprintf(`localStorage.setItem(%s,%s);true`, jsString(st.Key), jsString(v))
			if _, err := c.evaluate(expr); err != nil {
				return err
			}
		}
		if err := c.navigate(r.URL, 20*time.Second); err != nil {
			return err
		}
	}
	return nil
}

func captureScreenshot(c *cdpClient, path string, full bool, clip map[string]any) error {
	params := map[string]any{"format": "png", "fromSurface": true, "captureBeyondViewport": true}
	if clip != nil {
		params["clip"] = clip
	} else if full {
		res, err := c.send("Page.getLayoutMetrics", map[string]any{}, true, 10*time.Second)
		if err != nil {
			return err
		}
		var m struct {
			ContentSize struct {
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			} `json:"contentSize"`
		}
		if err := json.Unmarshal(res, &m); err != nil {
			return err
		}
		if m.ContentSize.Width > 0 && m.ContentSize.Height > 0 {
			if m.ContentSize.Width > 10000 || m.ContentSize.Height > 20000 || m.ContentSize.Width*m.ContentSize.Height > 80000000 {
				return errors.New("full-page capture exceeds safety dimensions")
			}
			params["clip"] = map[string]any{"x": 0, "y": 0, "width": m.ContentSize.Width, "height": m.ContentSize.Height, "scale": 1}
		}
	}
	res, err := c.send("Page.captureScreenshot", params, true, 30*time.Second)
	if err != nil {
		return err
	}
	var sr struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(res, &sr); err != nil {
		return err
	}
	b, err := base64.StdEncoding.DecodeString(sr.Data)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func captureElement(c *cdpClient, selector, path string) error {
	expr := fmt.Sprintf(`(()=>{const e=document.querySelector(%s);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height}})()`, jsString(selector))
	v, err := c.evaluate(expr)
	if err != nil {
		return err
	}
	m, ok := v.(map[string]any)
	if !ok || m == nil {
		return fmt.Errorf("element not found: %s", selector)
	}
	f := func(k string) float64 {
		switch n := m[k].(type) {
		case float64:
			return n
		case int:
			return float64(n)
		default:
			return 0
		}
	}
	clip := map[string]any{"x": f("x"), "y": f("y"), "width": f("width"), "height": f("height"), "scale": 1}
	if clip["width"].(float64) <= 0 || clip["height"].(float64) <= 0 {
		return errors.New("element has empty geometry")
	}
	if clip["width"].(float64) > 10000 || clip["height"].(float64) > 10000 || clip["width"].(float64)*clip["height"].(float64) > 50000000 {
		return errors.New("element capture exceeds safety dimensions")
	}
	return captureScreenshot(c, path, false, clip)
}

const geometryExpr = `(()=>{const max=1200,els=[...document.body.querySelectorAll('*')].slice(0,max);const vw=innerWidth,vh=innerHeight;const items=els.map((e,i)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),visible=!!(r.width||r.height)&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0;const clipped=visible&&(r.right>vw+0.5||r.left<-0.5||r.bottom>vh+0.5||r.top<-0.5);return{i,tag:e.tagName.toLowerCase(),id:e.id||'',class:(typeof e.className==='string'?e.className:'').slice(0,240),rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},visible,clipped,position:s.position,zIndex:s.zIndex,overflowX:s.overflowX,overflowY:s.overflowY,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}});return{viewport:{width:vw,height:vh,dpr:devicePixelRatio},document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight,horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1},sampled:items.length,truncated:els.length>=max,items}})()`

func captureDOMGeometryA11y(c *cdpClient, dir string, v Viewport, cfg CaptureConfig, arts *[]Artifact, scenario string, secrets []string) (map[string]any, error) {
	metrics := map[string]any{}
	if cfg.DOM {
		val, err := c.evaluate(`document.documentElement.outerHTML`)
		if err != nil {
			return metrics, err
		}
		path := filepath.Join(dir, "dom.html")
		if err := writeText(path, redactKnownSecrets(fmt.Sprint(val), secrets)); err != nil {
			return metrics, err
		}
		if err := addArtifact(arts, path, filepath.Dir(dir), scenario, v.ID, "dom", "text/html"); err != nil {
			return metrics, err
		}
	}
	if cfg.Geometry {
		val, err := c.evaluate(geometryExpr)
		if err != nil {
			return metrics, err
		}
		path := filepath.Join(dir, "geometry.json")
		if err := writeJSON(path, redactArtifactValue(val, secrets)); err != nil {
			return metrics, err
		}
		if m, ok := val.(map[string]any); ok {
			if d, ok := m["document"].(map[string]any); ok {
				metrics["horizontal_overflow"] = d["horizontalOverflow"]
			}
			metrics["geometry_sampled"] = m["sampled"]
		}
		if err := addArtifact(arts, path, filepath.Dir(dir), scenario, v.ID, "geometry", "application/json"); err != nil {
			return metrics, err
		}
	}
	if cfg.A11y {
		res, err := c.send("Accessibility.getFullAXTree", map[string]any{}, true, 20*time.Second)
		if err != nil {
			return metrics, err
		}
		var val any
		if err := json.Unmarshal(res, &val); err != nil {
			return metrics, err
		}
		path := filepath.Join(dir, "accessibility.json")
		if err := writeJSON(path, redactArtifactValue(val, secrets)); err != nil {
			return metrics, err
		}
		if err := addArtifact(arts, path, filepath.Dir(dir), scenario, v.ID, "accessibility", "application/json"); err != nil {
			return metrics, err
		}
	}
	return metrics, nil
}

func networkSlice(c *cdpClient, slowMS int) []networkEntry {
	out := make([]networkEntry, 0, len(c.requests))
	keys := make([]string, 0, len(c.requests))
	for k := range c.requests {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if c.requests[k] != nil {
			e := *c.requests[k]
			e.Slow = slowMS > 0 && e.DurationMS >= float64(slowMS)
			out = append(out, e)
		}
	}
	return out
}
func countConsoleErrors(entries []consoleEntry) int {
	n := 0
	for _, e := range entries {
		l := strings.ToLower(e.Level)
		if l == "error" || l == "assert" {
			n++
		}
	}
	return n
}
func countNetworkFailures(entries []networkEntry) int {
	n := 0
	for _, e := range entries {
		if e.Failed || e.Status >= 400 {
			n++
		}
	}
	return n
}
func countSlowResources(entries []networkEntry) int {
	n := 0
	for _, e := range entries {
		if e.Slow {
			n++
		}
	}
	return n
}
func countCORSErrors(entries []networkEntry) int {
	n := 0
	for _, e := range entries {
		if e.CORSError != "" || strings.Contains(strings.ToLower(e.BlockedReason), "cors") {
			n++
		}
	}
	return n
}

func evidenceForAssertion(kind string, artifacts []Artifact) string {
	preferred := map[string][]string{
		"selector_visible": {"screenshot", "full-page-screenshot"}, "selector_hidden": {"screenshot", "full-page-screenshot"},
		"no_horizontal_overflow": {"geometry", "full-page-screenshot"}, "console_errors_max": {"console"},
		"network_failures_max": {"network"}, "visual_changed_ratio_max": {"visual-diff", "screenshot", "full-page-screenshot"},
	}
	for _, want := range preferred[kind] {
		for _, a := range artifacts {
			if a.Kind == want {
				return a.ID
			}
		}
	}
	for _, a := range artifacts {
		if a.Kind == "page-metadata" {
			return a.ID
		}
	}
	if len(artifacts) > 0 {
		return artifacts[0].ID
	}
	return ""
}

func evaluateAssertions(c *cdpClient, r Recipe, v Viewport, metrics map[string]any, visual *DiffResult, artifacts []Artifact) ([]Finding, error) {
	findings := []Finding{}
	for _, a := range r.Assertions {
		fail := false
		msg := ""
		switch a.Type {
		case "selector_visible":
			err := waitSelector(c, a.Selector, true, 750*time.Millisecond)
			fail = err != nil
			msg = "selector not visible: " + a.Selector
		case "selector_hidden":
			val, err := c.evaluate(fmt.Sprintf(`(()=>{const e=document.querySelector(%s);if(!e)return true;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !(r.width||r.height)||s.display==='none'||s.visibility==='hidden'||Number(s.opacity||1)===0})()`, jsString(a.Selector)))
			fail = err != nil || val != true
			msg = "selector unexpectedly visible: " + a.Selector
		case "no_horizontal_overflow":
			if b, ok := metrics["horizontal_overflow"].(bool); ok {
				fail = b
			} else {
				val, err := c.evaluate(`document.documentElement.scrollWidth>document.documentElement.clientWidth+1`)
				fail = err != nil || val == true
			}
			msg = "document has horizontal overflow"
		case "console_errors_max":
			n := countConsoleErrors(c.console)
			metrics["console_errors"] = n
			fail = n > a.Max
			msg = fmt.Sprintf("console errors %d > %d", n, a.Max)
		case "network_failures_max":
			n := countNetworkFailures(networkSlice(c, r.Captures.SlowResourceMS))
			metrics["network_failures"] = n
			fail = n > a.Max
			msg = fmt.Sprintf("network failures %d > %d", n, a.Max)
		case "visual_changed_ratio_max":
			if visual == nil {
				if a.Required {
					fail = true
					msg = "visual baseline unavailable"
				}
			} else {
				limit := a.MaxRatio
				if limit == 0 {
					limit = r.Visual.MaxChangedRatio
				}
				fail = visual.ChangedRatio > limit || visual.DimensionMismatch
				msg = fmt.Sprintf("visual changed ratio %.6f > %.6f", visual.ChangedRatio, limit)
			}
		}
		if fail {
			findings = append(findings, Finding{Severity: "error", Code: strings.ToUpper(a.Type), Message: msg, ViewportID: v.ID, EvidenceID: evidenceForAssertion(a.Type, artifacts)})
		}
	}
	return findings, nil
}

func runViewport(r Recipe, rawHash, outRoot, baselineDir, browserPath string, v Viewport) (ViewportResult, error) {
	vdir := filepath.Join(outRoot, safeName(v.ID))
	if err := os.MkdirAll(vdir, 0o700); err != nil {
		return ViewportResult{}, err
	}
	bp, err := launchBrowser(browserPath, v.Width, v.Height)
	if err != nil {
		return ViewportResult{}, err
	}
	defer bp.Close()
	c, err := newCDP(bp.wsURL)
	if err != nil {
		return ViewportResult{}, err
	}
	defer c.Close()
	if err := c.createPage(); err != nil {
		return ViewportResult{}, err
	}
	if err := c.setViewport(v); err != nil {
		return ViewportResult{}, err
	}
	if err := applySetup(c, r); err != nil {
		return ViewportResult{}, err
	}
	for _, a := range r.Actions {
		if err := executeAction(c, a, r.AllowedOrigins); err != nil {
			return ViewportResult{}, fmt.Errorf("action %s failed: %w", a.Op, err)
		}
	}
	title, pageURL, err := currentPage(c)
	if err != nil {
		return ViewportResult{}, err
	}
	if !isAllowedOrigin(pageURL, r.AllowedOrigins) {
		return ViewportResult{}, fmt.Errorf("final page origin outside allowed_origins: %s", redactURL(pageURL))
	}
	secrets := knownRecipeSecrets(r)
	arts := []Artifact{}
	metrics := map[string]any{"recipe_sha256": rawHash, "dpr": v.DPR, "viewport_width": v.Width, "viewport_height": v.Height}
	var visual *DiffResult
	screenshotRel := ""
	if r.Captures.Screenshot {
		path := filepath.Join(vdir, "viewport.png")
		if err := captureScreenshot(c, path, false, nil); err != nil {
			return ViewportResult{}, err
		}
		if err := addArtifact(&arts, path, outRoot, r.ScenarioID, v.ID, "screenshot", "image/png"); err != nil {
			return ViewportResult{}, err
		}
		screenshotRel = filepath.Join(safeName(v.ID), "viewport.png")
	}
	if r.Captures.FullPage {
		path := filepath.Join(vdir, "full-page.png")
		if err := captureScreenshot(c, path, true, nil); err != nil {
			return ViewportResult{}, err
		}
		if err := addArtifact(&arts, path, outRoot, r.ScenarioID, v.ID, "full-page-screenshot", "image/png"); err != nil {
			return ViewportResult{}, err
		}
		screenshotRel = filepath.Join(safeName(v.ID), "full-page.png")
	}
	for i, sel := range r.Captures.Elements {
		path := filepath.Join(vdir, fmt.Sprintf("element-%02d-%s.png", i+1, safeName(sel)))
		if err := captureElement(c, sel, path); err != nil {
			return ViewportResult{}, err
		}
		if err := addArtifact(&arts, path, outRoot, r.ScenarioID, v.ID, "element-screenshot", "image/png"); err != nil {
			return ViewportResult{}, err
		}
	}
	gm, err := captureDOMGeometryA11y(c, vdir, v, r.Captures, &arts, r.ScenarioID, secrets)
	if err != nil {
		return ViewportResult{}, err
	}
	for k, val := range gm {
		metrics[k] = val
	}
	if r.Captures.Console {
		path := filepath.Join(vdir, "console.json")
		if err := writeJSON(path, redactArtifactValue(c.console, secrets)); err != nil {
			return ViewportResult{}, err
		}
		if err := addArtifact(&arts, path, outRoot, r.ScenarioID, v.ID, "console", "application/json"); err != nil {
			return ViewportResult{}, err
		}
	}
	nets := networkSlice(c, r.Captures.SlowResourceMS)
	if r.Captures.Network {
		path := filepath.Join(vdir, "network.json")
		if err := writeJSON(path, redactArtifactValue(nets, secrets)); err != nil {
			return ViewportResult{}, err
		}
		if err := addArtifact(&arts, path, outRoot, r.ScenarioID, v.ID, "network", "application/json"); err != nil {
			return ViewportResult{}, err
		}
	}
	metrics["console_errors"] = countConsoleErrors(c.console)
	metrics["network_failures"] = countNetworkFailures(nets)
	metrics["network_slow_resources"] = countSlowResources(nets)
	metrics["network_cors_errors"] = countCORSErrors(nets)
	if r.Visual.Enabled && screenshotRel != "" && baselineDir != "" {
		base := filepath.Join(baselineDir, screenshotRel)
		current := filepath.Join(outRoot, screenshotRel)
		if st, e := os.Stat(base); e == nil && !st.IsDir() {
			dp := filepath.Join(vdir, "visual-diff.png")
			dr, e := diffPNG(base, current, dp)
			if e != nil {
				return ViewportResult{}, e
			}
			visual = &dr
			metrics["visual_changed_ratio"] = dr.ChangedRatio
			metrics["visual_changed_pixels"] = dr.ChangedPixels
			metrics["visual_dimension_mismatch"] = dr.DimensionMismatch
			if err := addArtifact(&arts, dp, outRoot, r.ScenarioID, v.ID, "visual-diff", "image/png"); err != nil {
				return ViewportResult{}, err
			}
		} else {
			metrics["visual_baseline_missing"] = true
		}
	}
	pageMeta := map[string]any{"schema": "sokna-browser-page-metadata-v1", "scenario_id": r.ScenarioID, "viewport": v, "title": redactKnownSecrets(title, secrets), "url": redactKnownSecrets(redactURL(pageURL), secrets), "status_code": c.lastDocumentStatus, "recipe_sha256": rawHash, "commit": r.Commit, "build": r.Build, "workspace": r.Workspace, "job_id": r.JobID, "console_errors": metrics["console_errors"], "network_failures": metrics["network_failures"]}
	metaPath := filepath.Join(vdir, "page.json")
	if err := writeJSON(metaPath, redactArtifactValue(pageMeta, secrets)); err != nil {
		return ViewportResult{}, err
	}
	if err := addArtifact(&arts, metaPath, outRoot, r.ScenarioID, v.ID, "page-metadata", "application/json"); err != nil {
		return ViewportResult{}, err
	}
	findings, err := evaluateAssertions(c, r, v, metrics, visual, arts)
	if err != nil {
		return ViewportResult{}, err
	}
	ok := len(findings) == 0
	status := "PASS"
	if !ok {
		status = "FAIL"
	}
	return ViewportResult{Status: status, Viewport: v, OK: ok, URL: redactKnownSecrets(redactURL(pageURL), secrets), Title: redactKnownSecrets(title, secrets), StatusCode: c.lastDocumentStatus, Findings: findings, Metrics: metrics, Artifacts: arts}, nil
}
