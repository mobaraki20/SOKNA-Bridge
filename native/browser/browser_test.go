package main

import (
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRedaction(t *testing.T) {
	got := redactText("Authorization: Bearer abcdef123456 token=hello password=hunter2")
	if strings.Contains(got, "abcdef123456") || strings.Contains(got, "hello") || strings.Contains(got, "hunter2") {
		t.Fatalf("secret leaked: %s", got)
	}
	u := redactURLString("https://example.test/a?token=abc&x=1&session=xyz#frag")
	if strings.Contains(u, "abc") || strings.Contains(u, "xyz") || strings.Contains(u, "frag") || !strings.Contains(u, "x=1") {
		t.Fatalf("url redaction failed: %s", u)
	}
}

func TestRecipeValidationOriginAndSecrets(t *testing.T) {
	t.Setenv("QA_SECRET", "value")
	r := Recipe{Schema: recipeSchema, ScenarioID: "case", URL: "https://example.test/a", Viewports: []Viewport{{ID: "desktop", Width: 1280, Height: 720}}, Actions: []Action{{Op: "goto", URL: "https://other.test/b"}}, Setup: SetupConfig{Cookies: []CookieSetup{{Name: "sid", ValueEnv: "QA_SECRET"}}}}
	if err := validateRecipe(&r); err == nil {
		t.Fatal("cross-origin goto should fail without allowlist")
	}
	r.AllowedOrigins = []string{"https://other.test"}
	if err := validateRecipe(&r); err != nil {
		t.Fatalf("valid recipe rejected: %v", err)
	}
	r.URL = "file:///etc/passwd"
	if err := validateRecipe(&r); err == nil {
		t.Fatal("file URL should fail")
	}
}

func writePNG(t *testing.T, path string, c color.NRGBA) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.SetNRGBA(x, y, c)
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}
func TestPNGDiff(t *testing.T) {
	d := t.TempDir()
	a := filepath.Join(d, "a.png")
	b := filepath.Join(d, "b.png")
	o := filepath.Join(d, "diff.png")
	writePNG(t, a, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
	writePNG(t, b, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
	r, err := diffPNG(a, b, o)
	if err != nil {
		t.Fatal(err)
	}
	if r.ChangedPixels != 0 || r.ChangedRatio != 0 {
		t.Fatalf("unexpected diff: %+v", r)
	}
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
		}
	}
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
	f, _ := os.Create(b)
	_ = png.Encode(f, img)
	_ = f.Close()
	r, err = diffPNG(a, b, o)
	if err != nil {
		t.Fatal(err)
	}
	if r.ChangedPixels != 1 || r.ChangedRatio != 1.0/16.0 {
		t.Fatalf("wrong diff: %+v", r)
	}
}

func TestArtifactRootContainment(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "browser", "runs", "x")
	if err := assertPathInside(root, inside, true); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(filepath.Dir(root), "escape")
	if err := assertPathInside(root, outside, true); err == nil {
		t.Fatal("escape should be rejected")
	}
}

func TestKnownRecipeSecretRedaction(t *testing.T) {
	t.Setenv("QA_TYPED_SECRET", "typed-secret-123")
	t.Setenv("QA_COOKIE_SECRET", "cookie-secret-456")
	r := Recipe{
		Actions: []Action{{Op: "type", Selector: "#secret", ValueEnv: "QA_TYPED_SECRET"}},
		Setup:   SetupConfig{Cookies: []CookieSetup{{Name: "sid", ValueEnv: "QA_COOKIE_SECRET"}}},
	}
	secrets := knownRecipeSecrets(r)
	got := redactKnownSecrets("value=typed-secret-123 cookie-secret-456", secrets)
	if strings.Contains(got, "typed-secret-123") || strings.Contains(got, "cookie-secret-456") {
		t.Fatalf("known recipe secret leaked: %s", got)
	}
	obj := redactArtifactValue(map[string]any{"nested": []any{"typed-secret-123"}}, secrets)
	b, err := json.Marshal(obj)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "typed-secret-123") || !strings.Contains(string(b), "[REDACTED]") {
		t.Fatalf("structured redaction failed: %s", b)
	}
}

func TestAssertionEvidenceFallback(t *testing.T) {
	arts := []Artifact{{ID: "browser-page-proof", Kind: "page-metadata"}}
	if got := evidenceForAssertion("visual_changed_ratio_max", arts); got != "browser-page-proof" {
		t.Fatalf("expected page evidence fallback, got %q", got)
	}
}

func TestNetworkDiagnosticsClassification(t *testing.T) {
	c := &cdpClient{requests: map[string]*networkEntry{
		"slow": {URL: "https://example.test/a", DurationMS: 2500},
		"cors": {URL: "https://example.test/b", Failed: true, CORSError: "InsecurePrivateNetwork"},
	}}
	entries := networkSlice(c, 2000)
	if countSlowResources(entries) != 1 {
		t.Fatalf("expected one slow resource: %+v", entries)
	}
	if countCORSErrors(entries) != 1 || countNetworkFailures(entries) != 1 {
		t.Fatalf("expected one CORS/network failure: %+v", entries)
	}
}
