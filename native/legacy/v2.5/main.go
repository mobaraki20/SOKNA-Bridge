package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

//go:embed payload/* payload/extension/*
var payload embed.FS

type Workspace struct {
	Path         string `json:"path"`
	ExpectedRepo string `json:"expected_repo"`
	WriteEnabled bool   `json:"write_enabled"`
}
type Config struct {
	Port                int                  `json:"port"`
	Token               string               `json:"token"`
	WorkspaceRoot       string               `json:"workspace_root"`
	DefaultWorkspace    string               `json:"default_workspace"`
	DefaultGithubOwner  string               `json:"default_github_owner"`
	AllowedGithubOwners []string             `json:"allowed_github_owners"`
	Workspaces          map[string]Workspace `json:"workspaces"`
}
type OldConfig struct {
	RepoRoot string `json:"repo_root"`
	Port     int    `json:"port"`
	Token    string `json:"token"`
}
type Report struct {
	Version       string   `json:"version"`
	InstallDir    string   `json:"install_dir"`
	WorkspaceRoot string   `json:"workspace_root"`
	CafePath      string   `json:"cafe_path"`
	BridgePath    string   `json:"bridge_path"`
	CafeHead      string   `json:"cafe_head"`
	BridgeHead    string   `json:"bridge_head"`
	Git           string   `json:"git"`
	GH            string   `json:"gh"`
	Auth          bool     `json:"github_authenticated"`
	Agent         bool     `json:"agent_health"`
	Time          string   `json:"time"`
	Notes         []string `json:"notes"`
}

const owner = "mobaraki20"
const cafeRepo = "mobaraki20/SoknaCafe"
const bridgeRepo = "mobaraki20/SOKNA-Bridge"

func exists(p string) bool     { _, e := os.Stat(p); return e == nil }
func isDirEmpty(p string) bool { e, err := os.ReadDir(p); return err == nil && len(e) == 0 }
func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}
func normRemote(s string) string {
	s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(s, "/"), ".git"))
	s = strings.TrimPrefix(s, "https://github.com/")
	s = strings.TrimPrefix(s, "http://github.com/")
	s = strings.TrimPrefix(s, "git@github.com:")
	return strings.ToLower(s)
}
func remoteOK(got, expected string) bool { return normRemote(got) == strings.ToLower(expected) }
func copyPayload(dst string) error {
	return fs.WalkDir(payload, "payload", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == "payload" {
			return nil
		}
		rel := strings.TrimPrefix(p, "payload/")
		out := filepath.Join(dst, filepath.FromSlash(rel))
		if d.IsDir() {
			return os.MkdirAll(out, 0755)
		}
		b, e := payload.ReadFile(p)
		if e != nil {
			return e
		}
		if e = os.MkdirAll(filepath.Dir(out), 0755); e != nil {
			return e
		}
		return os.WriteFile(out, b, 0644)
	})
}
func run(name string, args ...string) (string, error) {
	c := exec.Command(name, args...)
	var b bytes.Buffer
	c.Stdout = &b
	c.Stderr = &b
	err := c.Run()
	return strings.TrimSpace(b.String()), err
}
func runInteractive(name string, args ...string) error {
	c := exec.Command(name, args...)
	c.Stdin = os.Stdin
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	return c.Run()
}
func cmdExists(name string) bool { _, e := exec.LookPath(name); return e == nil }
func refreshPath() {
	out, e := run("powershell.exe", "-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')")
	if e == nil && out != "" {
		_ = os.Setenv("PATH", out)
	}
}
func ensureTool(cmd, id string) error {
	if cmdExists(cmd) {
		return nil
	}
	if !cmdExists("winget.exe") {
		return fmt.Errorf("%s missing and winget unavailable", cmd)
	}
	fmt.Println("Installing", id, "...")
	_, e := run("winget.exe", "install", "--id", id, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements")
	refreshPath()
	if e != nil || !cmdExists(cmd) {
		return fmt.Errorf("could not install %s", id)
	}
	return nil
}
func portFree(p int) bool {
	l, e := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
	if e != nil {
		return false
	}
	_ = l.Close()
	return true
}
func firstFreePort() int {
	for p := 8765; p <= 8775; p++ {
		if portFree(p) {
			return p
		}
	}
	return 8765
}
func stopOldAgents(install string) {
	ps := fmt.Sprintf(`Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*agent.ps1*' -and $_.CommandLine -like '*SOKNA-Bridge*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500`)
	_, _ = run("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps)
}
func cleanupOldStartup() {
	app := os.Getenv("APPDATA")
	if app == "" {
		return
	}
	startup := filepath.Join(app, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
	for _, n := range []string{"SOKNA-Bridge-Agent.vbs", "SOKNA Bridge V2.2.lnk", "SOKNA Bridge V2.3.lnk", "SOKNA Bridge V2.4.lnk"} {
		_ = os.Remove(filepath.Join(startup, n))
	}
}
func psSyntaxOK(path string) error {
	q := strings.ReplaceAll(path, "'", "''")
	code := "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile('" + q + "',[ref]$t,[ref]$e)|Out-Null;if($e.Count -gt 0){$e|ForEach-Object{Write-Output $_.Message};exit 3}"
	out, err := run("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", code)
	if err != nil {
		return fmt.Errorf("PowerShell syntax validation failed: %s", out)
	}
	return nil
}
func manifestOK(path string) error {
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	var v map[string]any
	if e = json.Unmarshal(b, &v); e != nil {
		return e
	}
	if v["manifest_version"] != float64(3) {
		return errors.New("extension manifest_version is not 3")
	}
	return nil
}
func writeStartup(install string) error {
	app := os.Getenv("APPDATA")
	if app == "" {
		return errors.New("APPDATA not found")
	}
	startup := filepath.Join(app, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
	if e := os.MkdirAll(startup, 0755); e != nil {
		return e
	}
	ps := filepath.Join(install, "agent.ps1")
	vbs := fmt.Sprintf("Set s=CreateObject(\"WScript.Shell\")\r\ns.Run \"powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"\"%s\"\"\",0,False\r\n", strings.ReplaceAll(ps, "\"", "\"\""))
	return os.WriteFile(filepath.Join(startup, "SOKNA-Bridge-Agent.vbs"), []byte(vbs), 0644)
}
func startAgent(install string) error {
	ps := filepath.Join(install, "agent.ps1")
	return exec.Command("powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ps).Start()
}
func validateRepo(path, expected string, cloneIfMissing bool) error {
	if exists(filepath.Join(path, ".git")) {
		origin, e := run("git.exe", "-C", path, "remote", "get-url", "origin")
		if e != nil || !remoteOK(origin, expected) {
			return fmt.Errorf("unexpected origin at %s: %s", path, origin)
		}
		return nil // Important: existing repos are not fetched/pulled/switched by setup.
	}
	if !cloneIfMissing {
		return fmt.Errorf("repository missing: %s", path)
	}
	if exists(path) && !isDirEmpty(path) {
		return fmt.Errorf("target exists and is not an empty Git repo: %s", path)
	}
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return e
	}
	fmt.Println("Cloning", expected, "to", path)
	out, e := run("gh.exe", "repo", "clone", expected, path)
	if e != nil {
		return fmt.Errorf("clone failed: %s", out)
	}
	origin, e := run("git.exe", "-C", path, "remote", "get-url", "origin")
	if e != nil || !remoteOK(origin, expected) {
		return fmt.Errorf("post-clone origin mismatch: %s", origin)
	}
	return nil
}
func health(port int, token string) bool {
	cl := &http.Client{Timeout: 2 * time.Second}
	body := []byte(`{"id":"setup-health-v250","action":"ping","params":{}}`)
	for i := 0; i < 16; i++ {
		req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/api", port), bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Sokna-Token", token)
		r, e := cl.Do(req)
		if e == nil {
			var v struct {
				OK      bool   `json:"ok"`
				Version string `json:"version"`
			}
			de := json.NewDecoder(r.Body).Decode(&v)
			r.Body.Close()
			if r.StatusCode < 300 && de == nil && v.OK && v.Version == "2.5.0" {
				return true
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}
func openExtension(install string) {
	ext := filepath.Join(install, "extension")
	_, _ = run("powershell.exe", "-NoProfile", "-Command", "Set-Clipboard -Value '"+strings.ReplaceAll(ext, "'", "''")+"'")
	_ = exec.Command("explorer.exe", ext).Start()
	for _, c := range []string{filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"), filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe")} {
		if exists(c) {
			_ = exec.Command(c, "chrome://extensions").Start()
			return
		}
	}
	edge := filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe")
	if exists(edge) {
		_ = exec.Command(edge, "edge://extensions").Start()
	}
}
func saveReport(install string, r Report) {
	b, _ := json.MarshalIndent(r, "", "  ")
	_ = os.WriteFile(filepath.Join(install, "install-report.json"), b, 0644)
}
func head(path string) string { o, _ := run("git.exe", "-C", path, "rev-parse", "HEAD"); return o }
func wait()                   { fmt.Print("Press Enter to close Setup..."); var s string; fmt.Scanln(&s) }

func main() {
	if runtime.GOOS != "windows" {
		fmt.Println("This setup is for Windows.")
		return
	}
	fmt.Println("SOKNA Bridge V2.5 Multi-Workspace Setup")
	fmt.Println("======================================")
	refreshPath()
	if e := ensureTool("git.exe", "Git.Git"); e != nil {
		fmt.Println("ERROR:", e)
		wait()
		return
	}
	if e := ensureTool("gh.exe", "GitHub.cli"); e != nil {
		fmt.Println("ERROR:", e)
		wait()
		return
	}
	gv, _ := run("git.exe", "--version")
	ghv, _ := run("gh.exe", "--version")
	auth := true
	if _, e := run("gh.exe", "auth", "status", "--hostname", "github.com"); e != nil {
		auth = false
		fmt.Println("GitHub login required once.")
		if e = runInteractive("gh.exe", "auth", "login", "--hostname", "github.com", "--web", "--git-protocol", "https"); e != nil {
			fmt.Println("ERROR: GitHub authentication failed.")
			wait()
			return
		}
		auth = true
	}

	root := `C:\SOKNA`
	if x := strings.TrimSpace(os.Getenv("SOKNA_WORKSPACE_ROOT")); x != "" {
		root = x
	}
	cafe := filepath.Join(root, "SoknaCafe")
	bridge := filepath.Join(root, "SOKNA-Bridge")

	// Preserve the Cafe repo exactly if it already exists. If absent on a new PC, clone it once.
	if e := validateRepo(cafe, cafeRepo, true); e != nil {
		fmt.Println("ERROR validating SoknaCafe:", e)
		wait()
		return
	}
	// Clone/verify independent Bridge development repo.
	if e := validateRepo(bridge, bridgeRepo, true); e != nil {
		fmt.Println("ERROR validating SOKNA-Bridge:", e)
		wait()
		return
	}

	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		fmt.Println("ERROR: LOCALAPPDATA not found.")
		wait()
		return
	}
	install := filepath.Join(local, "SOKNA-Bridge-V2")
	stopOldAgents(install)
	cleanupOldStartup()
	_ = os.MkdirAll(install, 0755)

	old := OldConfig{}
	if b, e := os.ReadFile(filepath.Join(install, "config.json")); e == nil {
		_ = json.Unmarshal(b, &old)
	}
	if e := copyPayload(install); e != nil {
		fmt.Println("ERROR: payload install failed:", e)
		wait()
		return
	}
	if e := psSyntaxOK(filepath.Join(install, "agent.ps1")); e != nil {
		fmt.Println("ERROR:", e)
		wait()
		return
	}
	if e := manifestOK(filepath.Join(install, "extension", "manifest.json")); e != nil {
		fmt.Println("ERROR: manifest:", e)
		wait()
		return
	}

	tok := old.Token
	if tok == "" {
		tok = randomToken()
	}
	port := old.Port
	if port < 8765 || port > 8775 {
		port = 8765
	}
	if !portFree(port) {
		port = firstFreePort()
	}

	cfg := Config{
		Port: port, Token: tok, WorkspaceRoot: root, DefaultWorkspace: "SOKNA-Bridge",
		DefaultGithubOwner: owner, AllowedGithubOwners: []string{owner},
		Workspaces: map[string]Workspace{
			"SoknaCafe":    {Path: cafe, ExpectedRepo: cafeRepo, WriteEnabled: false},
			"SOKNA-Bridge": {Path: bridge, ExpectedRepo: bridgeRepo, WriteEnabled: true},
		},
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	_ = os.WriteFile(filepath.Join(install, "config.json"), b, 0600)
	extCfg := fmt.Sprintf("globalThis.SOKNA_BRIDGE_CONFIG = { endpoint: \"http://127.0.0.1:%d\", token: %q };\r\n", port, tok)
	_ = os.WriteFile(filepath.Join(install, "extension", "config.js"), []byte(extCfg), 0600)
	if e := writeStartup(install); e != nil {
		fmt.Println("ERROR: startup:", e)
		wait()
		return
	}
	if e := startAgent(install); e != nil {
		fmt.Println("ERROR: start agent:", e)
		wait()
		return
	}
	ok := health(port, tok)

	rep := Report{Version: "2.5.0", InstallDir: install, WorkspaceRoot: root, CafePath: cafe, BridgePath: bridge, CafeHead: head(cafe), BridgeHead: head(bridge), Git: gv, GH: ghv, Auth: auth, Agent: ok, Time: time.Now().Format(time.RFC3339)}
	rep.Notes = append(rep.Notes, "SoknaCafe is registered read-only; Setup did not fetch, pull, switch, or modify its working tree when it already existed.")
	if !ok {
		rep.Notes = append(rep.Notes, "Agent health failed; use start-agent-visible.cmd.")
	}
	saveReport(install, rep)

	fmt.Println()
	fmt.Println("Agent health:", map[bool]string{true: "PASS", false: "FAIL"}[ok])
	fmt.Println("Default workspace: SOKNA-Bridge")
	fmt.Println("SOKNA-Bridge:", bridge, "(write enabled)")
	fmt.Println("SoknaCafe:", cafe, "(READ ONLY)")
	fmt.Println("No existing SoknaCafe branch/worktree was changed.")
	openExtension(install)
	fmt.Println()
	fmt.Println("Browser: Reload the existing SOKNA Bridge extension, or Load unpacked from the opened extension folder.")
	fmt.Println("Then on THIS chat tab: Test Windows agent -> Enable on this tab")
	wait()
}
