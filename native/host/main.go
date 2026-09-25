package main

import (
	"bufio"
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
	"sort"
	"strconv"
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

type CommandEnvelope struct {
	ID            string          `json:"id"`
	Action        string          `json:"action"`
	Params        json.RawMessage `json:"params"`
	MessageID     string          `json:"messageId"`
	CorrelationID string          `json:"correlationId"`
	ParentID      string          `json:"parentId"`
}

type JobRecord struct {
	ID         string          `json:"id"`
	Status     string          `json:"status"`
	Workspace  string          `json:"workspace,omitempty"`
	Path       string          `json:"path,omitempty"`
	WorkerPID  int             `json:"worker_pid,omitempty"`
	CreatedAt  int64           `json:"created_at,omitempty"`
	StartedAt  int64           `json:"started_at,omitempty"`
	FinishedAt int64           `json:"finished_at,omitempty"`
	Recovered  int64           `json:"recovered_at,omitempty"`
	Result     json.RawMessage `json:"result,omitempty"`
	Error      any             `json:"error,omitempty"`
}

type ActivityEvent struct {
	EventID       string `json:"event_id"`
	Kind          string `json:"kind"`
	Timestamp     int64  `json:"timestamp"`
	CommandID     string `json:"command_id,omitempty"`
	CorrelationID string `json:"correlation_id,omitempty"`
	ParentID      string `json:"parent_id,omitempty"`
	JobID         string `json:"job_id,omitempty"`
	Action        string `json:"action,omitempty"`
	State         string `json:"state,omitempty"`
	WorkerPID     int    `json:"worker_pid,omitempty"`
	Error         string `json:"error,omitempty"`
	Source        string `json:"source"`
}

const version = "3.1.0-r2b"
const maxIn = 64 * 1024 * 1024
const maxOut = 900 * 1024
const maxActivityBytes = 5 * 1024 * 1024

var safeID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,96}$`)

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

func installRoot() (string, error) {
	p, err := resolveConfigPath()
	if err != nil {
		return "", err
	}
	return filepath.Dir(p), nil
}

func jobsDir() (string, error) {
	root, err := installRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "runtime", "jobs"), nil
}

func activityDir() (string, error) {
	local := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if local == "" {
		return "", errors.New("LOCALAPPDATA not found")
	}
	return filepath.Join(local, "SOKNA", "Bridge", "activity"), nil
}

func activityPath() (string, error) {
	d, err := activityDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "events.jsonl"), nil
}

func activityStatePath() (string, error) {
	d, err := activityDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "job-state.json"), nil
}

func trimError(v any) string {
	if v == nil {
		return ""
	}
	s := strings.TrimSpace(fmt.Sprint(v))
	if len(s) > 500 {
		s = s[:500] + "..."
	}
	return s
}

func newEvent(kind string) ActivityEvent {
	return ActivityEvent{EventID: fmt.Sprintf("evt-%d-%d", time.Now().UTC().UnixMilli(), time.Now().UnixNano()%1_000_000), Kind: kind, Timestamp: time.Now().UTC().UnixMilli(), Source: "agent-job-store"}
}

func appendActivity(ev ActivityEvent) error {
	p, err := activityPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	if st, err := os.Stat(p); err == nil && st.Size() > maxActivityBytes {
		_ = os.Rename(p, p+".1")
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	b, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	_, err = f.Write(append(b, '\n'))
	return err
}

func parseCommand(raw json.RawMessage) (CommandEnvelope, error) {
	var c CommandEnvelope
	if len(raw) == 0 || !json.Valid(raw) {
		return c, errors.New("command JSON required")
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	if !safeID.MatchString(c.ID) || strings.TrimSpace(c.Action) == "" {
		return c, errors.New("command requires valid id and action")
	}
	return c, nil
}

func readJobs() ([]JobRecord, error) {
	d, err := jobsDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(d)
	if errors.Is(err, os.ErrNotExist) {
		return []JobRecord{}, nil
	}
	if err != nil {
		return nil, err
	}
	jobs := make([]JobRecord, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(d, e.Name()))
		if err != nil {
			continue
		}
		var j JobRecord
		if json.Unmarshal(b, &j) != nil || !safeID.MatchString(j.ID) {
			continue
		}
		jobs = append(jobs, j)
	}
	sort.Slice(jobs, func(i, k int) bool {
		a := jobs[i].FinishedAt
		if a == 0 { a = jobs[i].StartedAt }
		if a == 0 { a = jobs[i].CreatedAt }
		b := jobs[k].FinishedAt
		if b == 0 { b = jobs[k].StartedAt }
		if b == 0 { b = jobs[k].CreatedAt }
		return a > b
	})
	return jobs, nil
}

func loadObservedStates() map[string]string {
	p, err := activityStatePath()
	if err != nil { return map[string]string{} }
	b, err := os.ReadFile(p)
	if err != nil { return map[string]string{} }
	m := map[string]string{}
	_ = json.Unmarshal(b, &m)
	return m
}

func saveObservedStates(m map[string]string) {
	p, err := activityStatePath()
	if err != nil { return }
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	b, _ := json.Marshal(m)
	tmp := p + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil { _ = os.Rename(tmp, p) }
}

func eventKindForStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "queued": return "job.created"
	case "accepted": return "command.accepted"
	case "running": return "job.running"
	case "waiting": return "job.waiting"
	case "completed": return "job.completed"
	case "failed": return "job.failed"
	case "cancelled", "canceled": return "job.cancelled"
	default: return "job.state"
	}
}

func observeJobStates(jobs []JobRecord) {
	states := loadObservedStates()
	changed := false
	for _, j := range jobs {
		state := strings.ToLower(strings.TrimSpace(j.Status))
		if state == "" || states[j.ID] == state { continue }
		ev := newEvent(eventKindForStatus(state))
		ev.JobID = j.ID; ev.State = state; ev.WorkerPID = j.WorkerPID; ev.Error = trimError(j.Error)
		_ = appendActivity(ev)
		states[j.ID] = state; changed = true
	}
	if changed { saveObservedStates(states) }
}

func readEvents(jobID string, limit int) ([]ActivityEvent, error) {
	if limit <= 0 { limit = 100 }
	if limit > 500 { limit = 500 }
	p, err := activityPath()
	if err != nil { return nil, err }
	f, err := os.Open(p)
	if errors.Is(err, os.ErrNotExist) { return []ActivityEvent{}, nil }
	if err != nil { return nil, err }
	defer f.Close()
	all := make([]ActivityEvent, 0, limit)
	s := bufio.NewScanner(f)
	buf := make([]byte, 0, 64*1024); s.Buffer(buf, 1024*1024)
	for s.Scan() {
		var ev ActivityEvent
		if json.Unmarshal(s.Bytes(), &ev) != nil { continue }
		if jobID != "" && ev.JobID != jobID { continue }
		all = append(all, ev)
		if len(all) > limit { all = all[len(all)-limit:] }
	}
	return all, s.Err()
}

func parseParams(raw json.RawMessage) map[string]any {
	m := map[string]any{}
	if len(raw) > 0 { _ = json.Unmarshal(raw, &m) }
	return m
}

func intParam(m map[string]any, key string, def int) int {
	v, ok := m[key]; if !ok { return def }
	s := fmt.Sprint(v); n, err := strconv.Atoi(strings.Split(s, ".")[0]); if err != nil { return def }
	return n
}

func localObservability(c CommandEnvelope) (json.RawMessage, bool, error) {
	if c.Action != "job.list" && c.Action != "job.events" && c.Action != "bridge.activity" { return nil, false, nil }
	jobs, err := readJobs(); if err != nil { return nil, true, err }
	observeJobStates(jobs)
	p := parseParams(c.Params)
	limit := intParam(p, "limit", 100); if limit < 1 { limit = 1 }; if limit > 500 { limit = 500 }
	if len(jobs) > limit { jobs = jobs[:limit] }
	owned := make([]map[string]any, 0)
	for _, j := range jobs {
		if j.WorkerPID > 0 && (j.Status == "queued" || j.Status == "running" || j.Status == "waiting") {
			owned = append(owned, map[string]any{"job_id":j.ID,"pid":j.WorkerPID,"state":j.Status,"owned":true})
		}
	}
	var result any
	switch c.Action {
	case "job.list":
		result = map[string]any{"ok":true,"source":"agent-job-store","jobs":jobs,"owned_processes":owned}
	case "job.events":
		jobID := strings.TrimSpace(fmt.Sprint(p["id"]))
		if jobID != "" && !safeID.MatchString(jobID) { return nil, true, errors.New("invalid job id") }
		events, err := readEvents(jobID, limit); if err != nil { return nil, true, err }
		result = map[string]any{"ok":true,"source":"agent-job-store","job_id":jobID,"events":events}
	case "bridge.activity":
		events, err := readEvents("", limit); if err != nil { return nil, true, err }
		result = map[string]any{"ok":true,"source":"agent-job-store","jobs":jobs,"events":events,"owned_processes":owned}
	}
	b, err := json.Marshal(result); return b, true, err
}

func proxy(command json.RawMessage) (json.RawMessage, error) {
	ep, tok, err := loadEndpoint()
	if err != nil { return nil, err }
	cli := &http.Client{Timeout: 30 * time.Minute}
	req, err := http.NewRequest("POST", ep, bytes.NewReader(command))
	if err != nil { return nil, err }
	req.Header.Set("Content-Type", "application/json")
	if tok != "" { req.Header.Set("X-Sokna-Token", tok) }
	resp, err := cli.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxOut))
	if err != nil { return nil, err }
	if resp.StatusCode >= 300 { return nil, fmt.Errorf("agent HTTP %d: %s", resp.StatusCode, string(b)) }
	if !json.Valid(b) { return nil, fmt.Errorf("agent returned invalid JSON") }
	return json.RawMessage(b), nil
}

func recordCommandEvent(c CommandEnvelope, kind, errText string) {
	ev := newEvent(kind)
	ev.CommandID = c.ID; ev.CorrelationID = c.CorrelationID; ev.ParentID = c.ParentID; ev.Action = c.Action; ev.Error = trimError(errText)
	if kind == "command.accepted" { ev.State = "accepted" }
	if kind == "command.completed" { ev.State = "completed" }
	if kind == "command.failed" { ev.State = "failed" }
	_ = appendActivity(ev)
}

func handle(m InMsg) OutMsg {
	switch m.Type {
	case "host.ping":
		return OutMsg{OK: true, Type: "host.pong", RequestID: m.RequestID, Version: version}
	case "agent.exec":
		c, err := parseCommand(m.Command)
		if err != nil { return OutMsg{OK: false, RequestID: m.RequestID, Error: err.Error()} }
		recordCommandEvent(c, "command.accepted", "")
		if r, handled, err := localObservability(c); handled {
			if err != nil { recordCommandEvent(c, "command.failed", err.Error()); return OutMsg{OK:false,RequestID:m.RequestID,Error:err.Error()} }
			recordCommandEvent(c, "command.completed", "")
			return OutMsg{OK:true,Type:"agent.result",RequestID:m.RequestID,Version:version,Result:r}
		}
		r, err := proxy(m.Command)
		if err != nil { recordCommandEvent(c, "command.failed", err.Error()); return OutMsg{OK:false,RequestID:m.RequestID,Error:err.Error()} }
		recordCommandEvent(c, "command.completed", "")
		if c.Action == "job.get" || c.Action == "job.submit" || c.Action == "job.batch" {
			if jobs, e := readJobs(); e == nil { observeJobStates(jobs) }
		}
		return OutMsg{OK: true, Type: "agent.result", RequestID: m.RequestID, Version: version, Result: r}
	default:
		return OutMsg{OK: false, RequestID: m.RequestID, Error: "unknown native message type"}
	}
}

func main() {
	_ = runtime.GOOS
	for {
		b, err := readMessage(os.Stdin)
		if err != nil {
			if errors.Is(err, io.EOF) { return }
			fmt.Fprintln(os.Stderr, "read:", err); return
		}
		var m InMsg
		if err := json.Unmarshal(b, &m); err != nil {
			_ = writeMessage(os.Stdout, OutMsg{OK: false, Error: "invalid JSON"}); continue
		}
		if err := writeMessage(os.Stdout, handle(m)); err != nil { fmt.Fprintln(os.Stderr, "write:", err); return }
	}
}

var _ = regexp.MustCompile
