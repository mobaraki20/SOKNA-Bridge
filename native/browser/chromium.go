package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type browserProcess struct {
	cmd         *exec.Cmd
	userDataDir string
	wsURL       string
	stderrLines []string
	executable  string
}

func findBrowser(explicit string) (string, error) {
	if explicit != "" {
		p, err := exec.LookPath(explicit)
		if err == nil {
			return p, nil
		}
		if st, e := os.Stat(explicit); e == nil && !st.IsDir() {
			return explicit, nil
		}
		return "", fmt.Errorf("browser executable not found: %s", explicit)
	}
	candidates := []string{}
	if runtime.GOOS == "windows" {
		pf := os.Getenv("ProgramFiles")
		pfx := os.Getenv("ProgramFiles(x86)")
		local := os.Getenv("LOCALAPPDATA")
		for _, base := range []string{pf, pfx, local} {
			if base != "" {
				candidates = append(candidates,
					filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"),
					filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
					filepath.Join(base, "Chromium", "Application", "chrome.exe"))
			}
		}
		candidates = append(candidates, "chrome.exe", "msedge.exe", "chromium.exe")
	} else if runtime.GOOS == "darwin" {
		candidates = []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "google-chrome", "chromium"}
	} else {
		candidates = []string{"chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge", "microsoft-edge-stable"}
	}
	for _, c := range candidates {
		if filepath.IsAbs(c) {
			if st, e := os.Stat(c); e == nil && !st.IsDir() {
				return c, nil
			}
		} else if p, e := exec.LookPath(c); e == nil {
			return p, nil
		}
	}
	return "", errors.New("no supported Chromium/Chrome/Edge executable found")
}

func launchBrowser(executable string, width, height int) (*browserProcess, error) {
	var last error
	for attempt := 0; attempt < 2; attempt++ {
		bp, err := launchBrowserOnce(executable, width, height)
		if err == nil { return bp, nil }
		last = err
		if !strings.Contains(err.Error(), "DevTools endpoint timeout") { return nil, err }
		time.Sleep(time.Second)
	}
	return nil, fmt.Errorf("browser launch retry exhausted: %w", last)
}
func launchBrowserOnce(executable string, width, height int) (*browserProcess, error) {
	dir, err := os.MkdirTemp("", "sokna-browserqa-")
	if err != nil {
		return nil, err
	}
	args := []string{
		"--headless=new", "--disable-gpu", "--disable-extensions", "--disable-sync", "--disable-background-networking", "--disable-component-update",
		"--disable-default-apps", "--no-first-run", "--no-default-browser-check", "--metrics-recording-only", "--mute-audio", "--password-store=basic",
		"--use-mock-keychain", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--user-data-dir=" + dir,
		fmt.Sprintf("--window-size=%d,%d", width, height), "about:blank",
	}
	if runtime.GOOS == "linux" && os.Getenv("SOKNA_BROWSER_ALLOW_NO_SANDBOX") == "1" {
		args = append([]string{"--no-sandbox"}, args...)
	}
	cmd := exec.Command(executable, args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	bp := &browserProcess{cmd: cmd, userDataDir: dir, executable: executable}
	lines := make(chan string, 64)
	scan := func(r io.Reader) {
		s := bufio.NewScanner(r)
		for s.Scan() {
			select {
			case lines <- s.Text():
			default:
			}
		}
	}
	go scan(stderr)
	go scan(stdout)
	deadline := time.After(30 * time.Second)
	for bp.wsURL == "" {
		select {
		case line := <-lines:
			if len(bp.stderrLines) < 40 {
				bp.stderrLines = append(bp.stderrLines, line)
			}
			const marker = "DevTools listening on "
			if i := strings.Index(line, marker); i >= 0 {
				bp.wsURL = strings.TrimSpace(line[i+len(marker):])
			}
		case <-deadline:
			bp.Close()
			return nil, fmt.Errorf("browser DevTools endpoint timeout; output=%s", strings.Join(bp.stderrLines, " | "))
		}
		if bp.cmd.ProcessState != nil && bp.cmd.ProcessState.Exited() {
			bp.Close()
			return nil, fmt.Errorf("browser exited before DevTools endpoint: %s", strings.Join(bp.stderrLines, " | "))
		}
	}
	return bp, nil
}

func (b *browserProcess) Close() {
	if b == nil {
		return
	}
	if b.cmd != nil && b.cmd.Process != nil {
		_ = b.cmd.Process.Kill()
		_, _ = b.cmd.Process.Wait()
	}
	if b.userDataDir != "" {
		_ = os.RemoveAll(b.userDataDir)
	}
}
