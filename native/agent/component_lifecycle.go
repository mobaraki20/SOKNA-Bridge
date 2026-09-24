package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const ComponentRegistrySchema = "sokna-component-registry-v1"
const AutomationRegistrySchema = "sokna-automation-registry-v1"

type ComponentType string

const (
	ComponentProcess ComponentType = "process"
	ComponentService ComponentType = "service"
	ComponentPlugin  ComponentType = "plugin"
)

type ComponentDependency struct {
	ComponentID string `json:"component_id,omitempty"`
	ArtifactID  string `json:"artifact_id,omitempty"`
	Version     string `json:"version,omitempty"`
	Required    bool   `json:"required"`
}

type ComponentRelease struct {
	Version      string `json:"version"`
	ArtifactPath string `json:"artifact_path"`
	SHA256       string `json:"sha256"`
	InstalledAt  string `json:"installed_at,omitempty"`
	Health       string `json:"health,omitempty"`
}

type ProcessOwnership struct {
	PID             int    `json:"pid"`
	StartUnixMillis int64  `json:"start_unix_ms"`
	Executable      string `json:"executable"`
	OwnerToken      string `json:"owner_token"`
}

type ComponentDefinition struct {
	ID             string                      `json:"id"`
	DisplayName    string                      `json:"display_name"`
	Type           ComponentType               `json:"type"`
	InstallOwner   string                      `json:"install_owner"`
	InstallRoot    string                      `json:"install_root,omitempty"`
	ServiceName    string                      `json:"service_name,omitempty"`
	ReleaseChannel string                      `json:"release_channel"`
	ActiveVersion  string                      `json:"active_version,omitempty"`
	LKGVersion     string                      `json:"lkg_version,omitempty"`
	State          string                      `json:"state"`
	Health         string                      `json:"health"`
	Dependencies   []ComponentDependency       `json:"dependencies,omitempty"`
	Releases       map[string]ComponentRelease `json:"releases,omitempty"`
	Process        *ProcessOwnership           `json:"process,omitempty"`
}

func validateComponentID(s string) error {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 80 {
		return errors.New("component id required and must be <=80 chars")
	}
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-", r)) {
			return fmt.Errorf("invalid component id: %s", s)
		}
	}
	return nil
}

func validateComponent(c ComponentDefinition) error {
	if err := validateComponentID(c.ID); err != nil {
		return err
	}
	switch c.Type {
	case ComponentProcess, ComponentService, ComponentPlugin:
	default:
		return fmt.Errorf("unsupported component type: %s", c.Type)
	}
	if strings.TrimSpace(c.InstallOwner) == "" {
		return errors.New("install owner required")
	}
	if c.Type == ComponentService && strings.TrimSpace(c.ServiceName) == "" {
		return errors.New("service component requires service name")
	}
	if strings.TrimSpace(c.ReleaseChannel) == "" {
		return errors.New("release channel required")
	}
	if c.ActiveVersion != "" {
		if _, ok := c.Releases[c.ActiveVersion]; !ok {
			return errors.New("active version missing from releases")
		}
	}
	if c.LKGVersion != "" {
		if _, ok := c.Releases[c.LKGVersion]; !ok {
			return errors.New("lkg version missing from releases")
		}
	}
	return nil
}

func CanStopOwnedProcess(expected ProcessOwnership, observed ProcessOwnership) error {
	if expected.PID <= 0 || observed.PID <= 0 || expected.PID != observed.PID {
		return errors.New("process pid ownership mismatch")
	}
	if expected.StartUnixMillis <= 0 || observed.StartUnixMillis <= 0 || expected.StartUnixMillis != observed.StartUnixMillis {
		return errors.New("process start-time ownership mismatch")
	}
	if strings.TrimSpace(expected.OwnerToken) == "" || expected.OwnerToken != observed.OwnerToken {
		return errors.New("process owner token mismatch")
	}
	if strings.TrimSpace(expected.Executable) == "" || !strings.EqualFold(strings.TrimSpace(expected.Executable), strings.TrimSpace(observed.Executable)) {
		return errors.New("process executable ownership mismatch")
	}
	return nil
}

type ComponentTransaction struct {
	ID          string   `json:"id"`
	ComponentID string   `json:"component_id"`
	FromVersion string   `json:"from_version,omitempty"`
	ToVersion   string   `json:"to_version"`
	State       string   `json:"state"`
	Events      []string `json:"events"`
}

func NewComponentTransaction(id, componentID, from, to string) (*ComponentTransaction, error) {
	if !validOpaqueID(id, 100) {
		return nil, errors.New("invalid transaction id")
	}
	if err := validateComponentID(componentID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(to) == "" || to == from {
		return nil, errors.New("new target version required")
	}
	return &ComponentTransaction{ID: id, ComponentID: componentID, FromVersion: from, ToVersion: to, State: "created", Events: []string{"created"}}, nil
}

func (t *ComponentTransaction) Advance(event string) error {
	allowed := map[string]map[string]string{
		"created":   {"stage": "staged", "fail": "failed"},
		"staged":    {"verify": "verified", "fail": "failed"},
		"verified":  {"activate": "activated", "fail": "failed"},
		"activated": {"health_pass": "healthy", "health_fail": "failed", "rollback": "rolled_back"},
		"healthy":   {"commit": "committed", "rollback": "rolled_back"},
		"failed":    {"rollback": "rolled_back"},
	}
	next, ok := allowed[t.State][event]
	if !ok {
		return fmt.Errorf("invalid component transaction transition %s -> %s", t.State, event)
	}
	t.State = next
	t.Events = append(t.Events, event)
	return nil
}

func (t ComponentTransaction) RequiresRollback() bool {
	return t.State == "failed" || t.State == "activated"
}

func CommitComponentRelease(c *ComponentDefinition, tx ComponentTransaction, rel ComponentRelease) error {
	if tx.State != "committed" || tx.ComponentID != c.ID || tx.ToVersion != rel.Version {
		return errors.New("component release cannot commit before healthy committed transaction")
	}
	if c.Releases == nil {
		c.Releases = map[string]ComponentRelease{}
	}
	prior := c.ActiveVersion
	c.Releases[rel.Version] = rel
	c.ActiveVersion = rel.Version
	if prior != "" {
		c.LKGVersion = prior
	} else {
		c.LKGVersion = rel.Version
	}
	c.State = "active"
	c.Health = "healthy"
	return validateComponent(*c)
}

type AutomationSpec struct {
	ID               string `json:"id"`
	WorkspaceID      string `json:"workspace_id"`
	GrantID          string `json:"grant_id,omitempty"`
	PlanPath         string `json:"plan_path"`
	ExpectedSHA256   string `json:"expected_sha256,omitempty"`
	Type             string `json:"type"` // interval|trigger
	IntervalSeconds  int64  `json:"interval_seconds,omitempty"`
	TriggerKey       string `json:"trigger_key,omitempty"`
	MissedRunPolicy  string `json:"missed_run_policy"` // skip|run_once
	ConcurrencyKey   string `json:"concurrency_key"`
	MaxConcurrency   int    `json:"max_concurrency"`
	Enabled          bool   `json:"enabled"`
	NextRunUnixMilli int64  `json:"next_run_unix_ms,omitempty"`
	LastRunKey       string `json:"last_run_key,omitempty"`
}

func validateAutomation(a AutomationSpec) error {
	if !validOpaqueID(a.ID, 80) {
		return errors.New("invalid automation id")
	}
	if strings.TrimSpace(a.WorkspaceID) == "" || strings.TrimSpace(a.PlanPath) == "" {
		return errors.New("automation workspace and plan path required")
	}
	if a.MaxConcurrency < 1 || a.MaxConcurrency > 8 {
		return errors.New("automation max concurrency must be 1..8")
	}
	if a.MissedRunPolicy != "skip" && a.MissedRunPolicy != "run_once" {
		return errors.New("invalid missed run policy")
	}
	switch a.Type {
	case "interval":
		if a.IntervalSeconds < 60 {
			return errors.New("interval automation minimum is 60 seconds")
		}
	case "trigger":
		if !validOpaqueID(a.TriggerKey, 120) {
			return errors.New("trigger automation requires trigger key")
		}
	default:
		return errors.New("unsupported automation type")
	}
	return nil
}

type AutomationDecision struct {
	Due       bool   `json:"due"`
	RunKey    string `json:"run_key,omitempty"`
	Reason    string `json:"reason"`
	NextRunAt int64  `json:"next_run_unix_ms,omitempty"`
}

func EvaluateAutomation(a AutomationSpec, now time.Time, activeForKey int, triggerKey string) (AutomationDecision, error) {
	if err := validateAutomation(a); err != nil {
		return AutomationDecision{}, err
	}
	if !a.Enabled {
		return AutomationDecision{Reason: "disabled", NextRunAt: a.NextRunUnixMilli}, nil
	}
	if activeForKey >= a.MaxConcurrency {
		return AutomationDecision{Reason: "concurrency_limit", NextRunAt: a.NextRunUnixMilli}, nil
	}
	nowms := now.UTC().UnixMilli()
	if a.Type == "trigger" {
		if triggerKey == "" || triggerKey != a.TriggerKey {
			return AutomationDecision{Reason: "trigger_mismatch"}, nil
		}
		runKey := "trigger:" + a.ID + ":" + triggerKey + ":" + fmt.Sprint(now.UTC().Unix()/60)
		if runKey == a.LastRunKey {
			return AutomationDecision{Reason: "duplicate", RunKey: runKey}, nil
		}
		return AutomationDecision{Due: true, Reason: "trigger", RunKey: runKey}, nil
	}
	if a.NextRunUnixMilli <= 0 {
		return AutomationDecision{Reason: "not_scheduled"}, nil
	}
	if nowms < a.NextRunUnixMilli {
		return AutomationDecision{Reason: "not_due", NextRunAt: a.NextRunUnixMilli}, nil
	}
	dueAt := a.NextRunUnixMilli
	intervalms := a.IntervalSeconds * 1000
	missed := (nowms - dueAt) / intervalms
	if missed > 0 && a.MissedRunPolicy == "skip" {
		next := dueAt + (missed+1)*intervalms
		return AutomationDecision{Reason: "missed_skipped", NextRunAt: next}, nil
	}
	runKey := fmt.Sprintf("interval:%s:%d", a.ID, dueAt)
	if runKey == a.LastRunKey {
		return AutomationDecision{Reason: "duplicate", RunKey: runKey, NextRunAt: dueAt + intervalms}, nil
	}
	return AutomationDecision{Due: true, Reason: "due", RunKey: runKey, NextRunAt: dueAt + (missed+1)*intervalms}, nil
}

func SortComponentIDs(m map[string]ComponentDefinition) []string {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
