package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

type InMsg struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id"`
	Command   json.RawMessage `json:"command"`
}

type OutMsg struct {
	OK        bool            `json:"ok"`
	Type      string          `json:"type,omitempty"`
	RequestID string          `json:"request_id,omitempty"`
	Version   string          `json:"version,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     string          `json:"error,omitempty"`
}

type V2Config struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

type InstallLocator struct {
	ConfigPath string `json:"config_path"`
}

const version = "3.0.0"
const maxIn = 64 * 1024 * 1024
const maxOut = 900 * 1024

func readMessage(r io.Reader) ([]byte, error) {
	var n uint32
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		return nil, err
	}
	if n == 0 || n > maxIn {
		return nil, fmt.Errorf("invalid native message size: %d", n)
	}
	b := make([]byte, n)
	_, err := io.ReadFull(r, b)
	return b, err
}

func writeMessage(w io.Writer, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(b) > maxOut {
		trimmed := OutMsg{OK: false, Type: "error", Error: "Native host response exceeded safe size limit."}
		b, _ = json.Marshal(trimmed)
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(len(b))); err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

func loadEndpoint() (string, string, error) {
	if ep := strings.TrimSpace(os.Getenv("SOKNA_V3_AGENT_ENDPOINT")); ep != "" {
		return ep, os.Getenv("SOKNA_V3_AGENT_TOKEN"), nil
	}
	configPath, err := resolveConfigPath()
	if err != nil {
		return "", "", err
	}
	b, err := os.ReadFile(configPath)
	if err != nil {
		return "", "", fmt.Errorf("agent config not found: %w", err)
	}
	var c V2Config
	if err := json.Unmarshal(b, &c); err != nil {
		return "", "", fmt.Errorf("invalid agent config: %w", err)
	}
	if c.Port < 1 || c.Port > 65535 || strings.TrimSpace(c.Token) == "" {
		return "", "", errors.New("agent config missing valid port/token")
	}
	return fmt.Sprintf("http://127.0.0.1:%d/api", c.Port), c.Token, nil
}

func resolveConfigPath() (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("SOKNA_AGENT_CONFIG_PATH")); explicit != "" {
		if !filepath.IsAbs(explicit) {
			return "", errors.New("SOKNA_AGENT_CONFIG_PATH must be absolute")
		}
		return filepath.Clean(explicit), nil
	}
	local := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if local == "" {
		return "", errors.New("LOCALAPPDATA not found")
	}
	locatorPath := filepath.Join(local, "SOKNA", "Agent", "install-locator.json")
	if b, err := os.ReadFile(locatorPath); err == nil {
		var locator InstallLocator
		if json.Unmarshal(b, &locator) == nil {
			p := strings.TrimSpace(locator.ConfigPath)
			if filepath.IsAbs(p) {
				return filepath.Clean(p), nil
			}
		}
	}
	candidates := []string{
		filepath.Join(local, "SOKNA", "Agent", "config.json"),
		filepath.Join(local, "SOKNA-Bridge-V2", "config.json"),
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
	}
	return "", fmt.Errorf("agent config not found via locator or compatibility paths")
}

func proxy(command json.RawMessage) (json.RawMessage, error) {
	ep, tok, err := loadEndpoint()
	if err != nil {
		return nil, err
	}
	cli := &http.Client{Timeout: 30 * time.Minute}
	req, err := http.NewRequest("POST", ep, bytes.NewReader(command))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if tok != "" {
		req.Header.Set("X-Sokna-Token", tok)
	}
	resp, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxOut))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("agent HTTP %d: %s", resp.StatusCode, string(b))
	}
	if !json.Valid(b) {
		return nil, fmt.Errorf("agent returned invalid JSON")
	}
	return json.RawMessage(b), nil
}

func handle(m InMsg) OutMsg {
	switch m.Type {
	case "host.ping":
		return OutMsg{OK: true, Type: "host.pong", RequestID: m.RequestID, Version: version}
	case "agent.exec":
		if len(m.Command) == 0 || !json.Valid(m.Command) {
			return OutMsg{OK: false, RequestID: m.RequestID, Error: "command JSON required"}
		}
		r, err := proxy(m.Command)
		if err != nil {
			return OutMsg{OK: false, RequestID: m.RequestID, Error: err.Error()}
		}
		return OutMsg{OK: true, Type: "agent.result", RequestID: m.RequestID, Version: version, Result: r}
	default:
		return OutMsg{OK: false, RequestID: m.RequestID, Error: "unknown native message type"}
	}
}

func main() {
	// Go's os.Stdin/os.Stdout use binary byte streams on Windows; never log to stdout.
	_ = runtime.GOOS
	for {
		b, err := readMessage(os.Stdin)
		if err != nil {
			if errors.Is(err, io.EOF) {
				return
			}
			fmt.Fprintln(os.Stderr, "read:", err)
			return
		}
		var m InMsg
		if err := json.Unmarshal(b, &m); err != nil {
			_ = writeMessage(os.Stdout, OutMsg{OK: false, Error: "invalid JSON"})
			continue
		}
		if err := writeMessage(os.Stdout, handle(m)); err != nil {
			fmt.Fprintln(os.Stderr, "write:", err)
			return
		}
	}
}

// Kept to make accidental secret extraction from JavaScript config impossible in this host.
var _ = regexp.MustCompile
