package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func shaBytes(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func testReq(root, provider, id string) ProviderRequest {
	return ProviderRequest{Schema: requestSchema, Operation: "acquire", Provider: provider, ArtifactRoot: root, ArtifactID: id, MaxBytes: 1 << 20, Retries: 3, BackoffMS: 1, TimeoutSeconds: 5}
}
func testEngine() *engine { return &engine{allowHTTP: true, sleep: func(time.Duration) {}} }

func TestDecodeProviderRequestAcceptsUTF8BOM(t *testing.T) {
	raw := "\xEF\xBB\xBF{\"schema\":\"sokna-artifact-provider-request-v1\",\"operation\":\"probe\",\"provider\":\"local_file\",\"artifact_root\":\"C:/tmp\",\"artifact_id\":\"bom-1\",\"source\":{\"path\":\"C:/tmp/x\"}}"
	req, err := decodeProviderRequest(bufio.NewReader(strings.NewReader(raw)))
	if err != nil {
		t.Fatalf("BOM-prefixed request rejected: %v", err)
	}
	if req.ArtifactID != "bom-1" || req.Provider != "local_file" {
		t.Fatalf("unexpected request: %+v", req)
	}
}

func TestProviderResultZeroOptionalFieldsAreOmitted(t *testing.T) {
	b, err := json.Marshal(ProviderResult{OK: true, Schema: resultSchema, Operation: "probe", Provider: "local_file"})
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	for _, field := range []string{"resumed_bytes", "attempts", "signature", "signature_ok", "content_type", "managed_path"} {
		if strings.Contains(text, `"`+field+`"`) {
			t.Fatalf("zero optional field %s unexpectedly serialized: %s", field, text)
		}
	}
}

func TestDecodeProviderRequestStillRejectsUnknownFields(t *testing.T) {
	raw := "{\"schema\":\"sokna-artifact-provider-request-v1\",\"operation\":\"probe\",\"provider\":\"local_file\",\"artifact_root\":\"C:/tmp\",\"artifact_id\":\"bad-1\",\"source\":{},\"unexpected\":true}"
	_, err := decodeProviderRequest(bufio.NewReader(strings.NewReader(raw)))
	if err == nil {
		t.Fatal("unknown field was accepted")
	}
}

func TestLocalProviderAcquireAndVerify(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(t.TempDir(), "payload.zip")
	data := []byte("local-payload")
	if err := os.WriteFile(src, data, 0644); err != nil {
		t.Fatal(err)
	}
	r := testReq(root, "local_file", "local-1")
	r.Source.Path = src
	r.ExpectedSHA256 = shaBytes(data)
	out, err := run(context.Background(), r, testEngine())
	if err != nil {
		t.Fatal(err)
	}
	if out.SHA256 != r.ExpectedSHA256 || out.Size != int64(len(data)) || !strings.HasPrefix(out.ManagedPath, "staging/") {
		t.Fatalf("unexpected result: %+v", out)
	}
	if _, err := os.Stat(out.StagingPath); err != nil {
		t.Fatal(err)
	}
}

func TestOrdinaryTempPathsAreNotRejectedAsReparse(t *testing.T) {
	d := t.TempDir()
	f := filepath.Join(d, "ordinary.bin")
	if err := os.WriteFile(f, []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := assertExistingPathNoSymlink(d); err != nil {
		t.Fatalf("ordinary temp directory rejected: %v", err)
	}
	if err := assertExistingPathNoSymlink(f); err != nil {
		t.Fatalf("ordinary temp file rejected: %v", err)
	}
}

func TestSymlinkParentBlocked(t *testing.T) {
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "x.bin"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	linkDir := filepath.Join(base, "linked")
	if err := os.Symlink(outside, linkDir); err != nil {
		t.Skipf("symlink unavailable on this platform: %v", err)
	}
	if err := assertExistingPathNoSymlink(filepath.Join(linkDir, "x.bin")); err == nil {
		t.Fatal("expected symlink parent rejection")
	}
}

func TestManagedFolderTraversalAndSymlinkBlocked(t *testing.T) {
	managed := t.TempDir()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(managed, "ok.bin"), []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	r := testReq(root, "managed_folder", "m1")
	r.Source.ManagedRoot = managed
	r.Source.RelativePath = "../escape.bin"
	if _, err := run(context.Background(), r, testEngine()); err == nil {
		t.Fatal("expected traversal rejection")
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "x.bin"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(managed, "link.bin")
	if err := os.Symlink(filepath.Join(outside, "x.bin"), link); err == nil {
		r.Source.RelativePath = "link.bin"
		if _, err := run(context.Background(), r, testEngine()); err == nil {
			t.Fatal("expected symlink rejection")
		}
	}
}

func TestRemoteRequiresExpectedHash(t *testing.T) {
	r := testReq(t.TempDir(), "https", "h1")
	r.Source.URL = "https://example.com/file.bin"
	if _, err := run(context.Background(), r, testEngine()); err == nil || !strings.Contains(err.Error(), "expected_sha256") {
		t.Fatalf("unexpected err %v", err)
	}
}

func TestHTTPRetryThenSuccess(t *testing.T) {
	data := []byte(strings.Repeat("retry-data-", 40))
	var gets int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
			return
		}
		n := atomic.AddInt32(&gets, 1)
		if n == 1 {
			http.Error(w, "try again", http.StatusServiceUnavailable)
			return
		}
		w.Write(data)
	}))
	defer s.Close()
	r := testReq(t.TempDir(), "https", "retry-1")
	r.Source.URL = s.URL + "/file.bin"
	r.ExpectedSHA256 = shaBytes(data)
	out, err := run(context.Background(), r, testEngine())
	if err != nil {
		t.Fatal(err)
	}
	if out.Attempts != 2 || gets != 2 {
		t.Fatalf("retry not observed: %+v gets=%d", out, gets)
	}
}

func TestHTTPResumeExistingPartial(t *testing.T) {
	data := []byte(strings.Repeat("resume-data-", 100))
	var ranged int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
			return
		}
		if rg := r.Header.Get("Range"); rg != "" {
			var n int
			fmt.Sscanf(rg, "bytes=%d-", &n)
			atomic.AddInt32(&ranged, 1)
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", n, len(data)-1, len(data)))
			w.WriteHeader(http.StatusPartialContent)
			w.Write(data[n:])
			return
		}
		w.Write(data)
	}))
	defer s.Close()
	root := t.TempDir()
	r := testReq(root, "https", "resume-1")
	r.Source.URL = s.URL + "/file.bin"
	r.ExpectedSHA256 = shaBytes(data)
	u, ref, err := sanitizeURL(r.Source.URL, false, true)
	_ = u
	if err != nil {
		t.Fatal(err)
	}
	partial, sidecar, err := prepareStaging(r)
	if err != nil {
		t.Fatal(err)
	}
	if err = ensurePartialState(partial, sidecar, r, ref); err != nil {
		t.Fatal(err)
	}
	prefix := data[:137]
	if err = os.WriteFile(partial, prefix, 0644); err != nil {
		t.Fatal(err)
	}
	out, err := run(context.Background(), r, testEngine())
	if err != nil {
		t.Fatal(err)
	}
	if out.ResumedBytes != int64(len(prefix)) || ranged < 1 {
		t.Fatalf("resume not used: %+v ranged=%d", out, ranged)
	}
}

func TestHashMismatchRemovesPoisonedPartial(t *testing.T) {
	data := []byte("bad-hash-body")
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
			return
		}
		w.Write(data)
	}))
	defer s.Close()
	root := t.TempDir()
	r := testReq(root, "https", "badsha-1")
	r.Source.URL = s.URL + "/f.bin"
	r.ExpectedSHA256 = strings.Repeat("0", 64)
	_, err := run(context.Background(), r, testEngine())
	if err == nil || !strings.Contains(err.Error(), "sha256 mismatch") {
		t.Fatalf("unexpected err %v", err)
	}
	partial, sidecar, _ := prepareStaging(r)
	if _, e := os.Stat(partial); !os.IsNotExist(e) {
		t.Fatalf("partial should be removed, stat=%v", e)
	}
	if _, e := os.Stat(sidecar); !os.IsNotExist(e) {
		t.Fatalf("sidecar should be removed, stat=%v", e)
	}
}

func TestCredentialBearingRawURLRejectedButEnvURLRedacted(t *testing.T) {
	if _, _, err := sanitizeURL("https://example.com/a?token=secret", false, false); err == nil {
		t.Fatal("raw credential URL should fail")
	}
	data := []byte("secret-url")
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
			return
		}
		w.Write(data)
	}))
	defer s.Close()
	t.Setenv("SOKNA_TEST_URL", s.URL+"/a?token=secret")
	r := testReq(t.TempDir(), "object_storage", "envurl-1")
	r.Source.URLEnv = "SOKNA_TEST_URL"
	r.ExpectedSHA256 = shaBytes(data)
	out, err := run(context.Background(), r, testEngine())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.SourceRef, "token=") || strings.Contains(out.ResolvedRef, "token=") {
		t.Fatalf("secret query leaked: %+v", out)
	}
}

func TestEd25519SignatureRequired(t *testing.T) {
	data := []byte("signed-artifact")
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	sig := ed25519.Sign(priv, digest[:])
	src := filepath.Join(t.TempDir(), "signed.bin")
	os.WriteFile(src, data, 0644)
	r := testReq(t.TempDir(), "local_file", "sig-1")
	r.Source.Path = src
	r.ExpectedSHA256 = shaBytes(data)
	r.Signature = SignaturePolicy{Required: true, Algorithm: "ed25519-sha256", PublicKeyB64: base64.StdEncoding.EncodeToString(pub), SignatureB64: base64.StdEncoding.EncodeToString(sig)}
	out, err := run(context.Background(), r, testEngine())
	if err != nil {
		t.Fatal(err)
	}
	if !out.SignatureOK || out.Signature != "ed25519-sha256" {
		t.Fatalf("signature not verified: %+v", out)
	}
	r.ArtifactID = "sig-2"
	r.Signature.SignatureB64 = base64.StdEncoding.EncodeToString(make([]byte, ed25519.SignatureSize))
	if _, err := run(context.Background(), r, testEngine()); err == nil {
		t.Fatal("invalid required signature accepted")
	}
}

func TestCloudBoundaryRequiresURLEnv(t *testing.T) {
	r := testReq(t.TempDir(), "google_drive", "g1")
	r.ExpectedSHA256 = strings.Repeat("a", 64)
	r.Source.URL = "https://example.com/file"
	if _, err := run(context.Background(), r, testEngine()); err == nil || !strings.Contains(err.Error(), "url_env") {
		t.Fatalf("unexpected err %v", err)
	}
}

func TestCredentialEnvBearerUsedButNotPersisted(t *testing.T) {
	data := []byte("auth-body")
	const secret = "SOKNA_BEARER_SUPER_SECRET"
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
			return
		}
		_, _ = w.Write(data)
	}))
	defer s.Close()
	t.Setenv("SOKNA_TEST_BEARER", secret)
	r := testReq(t.TempDir(), "https", "auth-1")
	r.Source.URL = s.URL + "/file.bin"
	r.Source.CredentialEnv = "SOKNA_TEST_BEARER"
	r.ExpectedSHA256 = shaBytes(data)
	out, err := run(context.Background(), r, testEngine())
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(out)
	if strings.Contains(string(b), secret) {
		t.Fatalf("credential leaked in result: %s", b)
	}
}

func TestCrossOriginRedirectRejected(t *testing.T) {
	data := []byte("redirect-body")
	dst := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(data) }))
	defer dst.Close()
	src := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, dst.URL+"/file.bin", http.StatusFound)
	}))
	defer src.Close()
	r := testReq(t.TempDir(), "https", "redir-1")
	r.Source.URL = src.URL + "/start"
	r.ExpectedSHA256 = shaBytes(data)
	if _, err := run(context.Background(), r, testEngine()); err == nil || !strings.Contains(err.Error(), "redirect origin not allowed") {
		t.Fatalf("unexpected redirect result: %v", err)
	}
}

func TestGitHubProviderDirectURLUsesCommonRemotePath(t *testing.T) {
	data := []byte("github-direct-asset")
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
			return
		}
		_, _ = w.Write(data)
	}))
	defer s.Close()
	r := testReq(t.TempDir(), "github_release_asset", "gh-direct-1")
	r.Source.URL = s.URL + "/release.zip"
	r.ExpectedSHA256 = shaBytes(data)
	out, err := run(context.Background(), r, testEngine())
	if err != nil {
		t.Fatal(err)
	}
	if out.Provider != "github_release_asset" || out.ProviderBoundary != "github-release-https" {
		t.Fatalf("unexpected github result: %+v", out)
	}
}

func TestErrorMessageRedactsURLQueryAndBearer(t *testing.T) {
	in := "Get https://example.com/a?token=VERYSECRET&x=1 failed Authorization: Bearer ABCDEFGHIJKLMNOP"
	out := redactErrorMessage(in)
	if strings.Contains(out, "VERYSECRET") || strings.Contains(out, "ABCDEFGHIJKLMNOP") || strings.Contains(out, "?token=") {
		t.Fatalf("secret leaked: %s", out)
	}
}
