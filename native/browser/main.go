package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		fatal("usage: sokna-browser-qa <run|validate|credential|version> ...")
	}
	switch os.Args[1] {
	case "version":
		fmt.Printf("sokna-browser-qa %s\n", toolVersion)
	case "validate":
		validateCmd(os.Args[2:])
	case "run":
		runCmd(os.Args[2:])
	case "credential":
		credentialCmd(os.Args[2:])
	default:
		fatal("unknown command: " + os.Args[1])
	}
}
func fatal(s string) { fmt.Fprintln(os.Stderr, s); os.Exit(2) }

func credentialCmd(args []string) {
	if len(args) < 1 {
		fatal("usage: sokna-browser-qa credential <set|list|delete> ...")
	}
	switch args[0] {
	case "set":
		fs := flag.NewFlagSet("credential set", flag.ExitOnError)
		id := fs.String("id", "", "credential id")
		username := fs.String("username", "", "username")
		_ = fs.Parse(args[1:])
		if *id == "" {
			fatal("--id required")
		}
		b, err := io.ReadAll(io.LimitReader(os.Stdin, 16385))
		if err != nil {
			fatal("credential secret read failed")
		}
		if len(b) > 16384 {
			fatal("credential secret exceeds 16384 bytes")
		}
		secret := string(b)
		secret = strings.TrimSuffix(secret, "\r\n")
		secret = strings.TrimSuffix(secret, "\n")
		if err := storeCredential(*id, *username, secret); err != nil {
			fatal(err.Error())
		}
		out := map[string]any{"ok": true, "id": *id, "username": *username, "store": "windows-dpapi"}
		enc, _ := json.Marshal(out)
		fmt.Println(string(enc))
	case "list":
		items, err := listCredentials()
		if err != nil {
			fatal(err.Error())
		}
		out := map[string]any{"ok": true, "credentials": items, "store": "windows-dpapi"}
		enc, _ := json.Marshal(out)
		fmt.Println(string(enc))
	case "delete":
		fs := flag.NewFlagSet("credential delete", flag.ExitOnError)
		id := fs.String("id", "", "credential id")
		_ = fs.Parse(args[1:])
		if *id == "" {
			fatal("--id required")
		}
		if err := deleteCredential(*id); err != nil {
			fatal(err.Error())
		}
		out := map[string]any{"ok": true, "id": *id, "deleted": true}
		enc, _ := json.Marshal(out)
		fmt.Println(string(enc))
	default:
		fatal("unknown credential command: " + args[0])
	}
}

func validateCmd(args []string) {
	fs := flag.NewFlagSet("validate", flag.ExitOnError)
	recipe := fs.String("recipe", "", "recipe path")
	_ = fs.Parse(args)
	if *recipe == "" {
		fatal("--recipe required")
	}
	r, raw, err := loadRecipe(*recipe)
	if err != nil {
		fatal(err.Error())
	}
	out := map[string]any{"ok": true, "schema": r.Schema, "scenario_id": r.ScenarioID, "recipe_sha256": recipeHash(raw), "viewports": len(r.Viewports), "allowed_origins": r.AllowedOrigins}
	b, _ := json.Marshal(out)
	fmt.Println(string(b))
}

func runCmd(args []string) {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	recipePath := fs.String("recipe", "", "recipe path")
	output := fs.String("output-dir", "", "output directory")
	artifactRoot := fs.String("artifact-root", "", "artifact root")
	baseline := fs.String("baseline-dir", "", "baseline directory")
	browser := fs.String("browser", "", "browser executable/path")
	workspace := fs.String("workspace", "", "authoritative workspace id")
	jobID := fs.String("job-id", "", "authoritative job id")
	maxRun := fs.Int64("max-run-bytes", 268435456, "max output bytes")
	_ = fs.Parse(args)
	if *recipePath == "" || *output == "" || *artifactRoot == "" {
		fatal("--recipe, --output-dir and --artifact-root are required")
	}
	r, raw, err := loadRecipe(*recipePath)
	if err != nil {
		fatal(err.Error())
	}
	r.Workspace = *workspace
	r.JobID = *jobID
	hash := recipeHash(raw)
	root, err := filepath.Abs(*artifactRoot)
	if err != nil {
		fatal(err.Error())
	}
	out, err := filepath.Abs(*output)
	if err != nil {
		fatal(err.Error())
	}
	if err := assertPathInside(root, out, true); err != nil {
		fatal("output-dir: " + err.Error())
	}
	base := ""
	if *baseline != "" {
		base, err = filepath.Abs(*baseline)
		if err != nil {
			fatal(err.Error())
		}
		if err := assertPathInside(root, base, false); err != nil {
			fatal("baseline-dir: " + err.Error())
		}
	}
	if err := os.MkdirAll(out, 0o700); err != nil {
		fatal(err.Error())
	}
	browserPath, err := findBrowser(*browser)
	if err != nil {
		fatal(err.Error())
	}
	started := time.Now().UTC()
	report := Report{Schema: reportSchema, OK: true, Status: "PASS", ToolVersion: toolVersion, ScenarioID: r.ScenarioID, RecipeSHA256: hash, StartedAt: started.Format(time.RFC3339Nano), Browser: filepath.Base(browserPath), BrowserPath: browserPath, Workspace: r.Workspace, JobID: r.JobID, Commit: r.Commit, Build: r.Build}
	for _, v := range r.Viewports {
		vr, e := runViewport(r, hash, out, base, browserPath, v)
		if e != nil {
			vr = ViewportResult{Status: "FAIL", Viewport: v, OK: false, Findings: []Finding{{Severity: "error", Code: "BROWSER_VIEWPORT_RUN_FAILED", Message: redactText(e.Error()), ViewportID: v.ID}}, Metrics: map[string]any{}, Artifacts: []Artifact{}}
		}
		if !vr.OK {
			report.OK = false
			report.Status = "FAIL"
		}
		report.Results = append(report.Results, vr)
		report.Findings = append(report.Findings, vr.Findings...)
		report.Artifacts = append(report.Artifacts, vr.Artifacts...)
		if size, err := treeSize(out); err == nil && size > *maxRun {
			report.OK = false
			report.Status = "FAIL"
			report.Findings = append(report.Findings, Finding{Severity: "error", Code: "BROWSER_RUN_SIZE_LIMIT", Message: fmt.Sprintf("browser run output %d exceeds limit %d", size, *maxRun)})
			break
		}
	}
	report.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	reportPath := filepath.Join(out, "report.json")
	if err := writeJSON(reportPath, report); err != nil {
		fatal(err.Error())
	}
	// Report artifact is added after writing, then report is rewritten once with the self-reference excluded to avoid recursive hash instability.
	if a, err := artifactFrom(reportPath, out, "browser-"+safeName(r.ScenarioID)+"-report", "report", "", "application/json"); err == nil {
		_ = a
	}
	summary := map[string]any{"ok": report.OK, "status": report.Status, "schema": report.Schema, "scenario_id": report.ScenarioID, "recipe_sha256": report.RecipeSHA256, "output_dir": out, "report_path": reportPath, "browser": report.Browser, "browser_path": report.BrowserPath, "findings": report.Findings, "artifacts": report.Artifacts}
	b, _ := json.Marshal(summary)
	fmt.Println(string(b))
	if !report.OK {
		os.Exit(1)
	}
}

func treeSize(root string) (int64, error) {
	var total int64
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("symlink in browser output")
		}
		if !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total, err
}

func assertPathInside(root, candidate string, allowMissing bool) error {
	root = filepath.Clean(root)
	candidate = filepath.Clean(candidate)
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return errors.New("path outside ArtifactRoot")
	}
	rootReal, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("artifact root unavailable: %w", err)
	}
	cur := candidate
	for {
		if _, err := os.Lstat(cur); err == nil {
			real, err := filepath.EvalSymlinks(cur)
			if err != nil {
				return err
			}
			rr, err := filepath.Rel(rootReal, real)
			if err != nil {
				return err
			}
			if rr == ".." || strings.HasPrefix(rr, ".."+string(filepath.Separator)) {
				return errors.New("resolved path escapes ArtifactRoot")
			}
			break
		} else if !os.IsNotExist(err) {
			return err
		}
		p := filepath.Dir(cur)
		if p == cur {
			break
		}
		cur = p
	}
	if !allowMissing {
		if st, err := os.Stat(candidate); err != nil {
			return err
		} else if !st.IsDir() {
			return errors.New("baseline path is not a directory")
		}
	}
	return nil
}

func stableArtifactSort(a []Artifact) {
	sort.Slice(a, func(i, j int) bool { return a[i].Path < a[j].Path })
}
