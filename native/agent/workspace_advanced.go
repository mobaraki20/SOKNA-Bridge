package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const WorkspaceGrantSchema = "sokna-workspace-grants-v1"

type RemoteWorkspaceSpec struct {
	Adapter       string `json:"adapter"`
	EndpointRef   string `json:"endpoint_ref"`
	RootRef       string `json:"root_ref"`
	CredentialRef string `json:"credential_ref,omitempty"`
}

type WorkspaceGrant struct {
	ID          string           `json:"id"`
	WorkspaceID string           `json:"workspace_id"`
	JobID       string           `json:"job_id"`
	Issuer      string           `json:"issuer"`
	Context     string           `json:"context,omitempty"`
	Scopes      []WorkspaceScope `json:"scopes"`
	Tools       []string         `json:"tools"`
	CreatedAt   string           `json:"created_at"`
	ExpiresAt   string           `json:"expires_at"`
	RevokedAt   string           `json:"revoked_at,omitempty"`
}

type WorkspaceGrantRegistry struct {
	Schema    string                    `json:"schema"`
	Grants    map[string]WorkspaceGrant `json:"grants"`
	UpdatedAt string                    `json:"updated_at"`
}

type WorkspacePolicyStatus struct {
	WorkspaceID string           `json:"workspace_id"`
	Kind        string           `json:"kind"`
	BaseScopes  []WorkspaceScope `json:"base_scopes"`
	BaseTools   []string         `json:"base_tools"`
	Grant       *WorkspaceGrant  `json:"grant,omitempty"`
	Effective   string           `json:"effective"`
}

func validOpaqueID(s string, max int) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > max {
		return false
	}
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-:/", r)) {
			return false
		}
	}
	return true
}

func normalizeRemoteRel(raw string) (string, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if raw == "" || raw == "." {
		return ".", nil
	}
	if strings.HasPrefix(raw, "/") {
		return "", errors.New("remote scope/path must be workspace-relative")
	}
	parts := strings.Split(raw, "/")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p == "" || p == "." {
			continue
		}
		if p == ".." {
			return "", errors.New("remote path escapes workspace root")
		}
		if strings.ContainsAny(p, "\x00\r\n") {
			return "", errors.New("invalid remote path")
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		return ".", nil
	}
	return strings.Join(out, "/"), nil
}

func normalizeRemoteScopes(scopes []WorkspaceScope) ([]WorkspaceScope, error) {
	if len(scopes) == 0 {
		return nil, errors.New("at least one explicit workspace scope is required")
	}
	seen := map[string]bool{}
	nonDeny := map[string]WorkspaceAccess{}
	out := make([]WorkspaceScope, 0, len(scopes))
	for _, s := range scopes {
		if s.Access != WorkspaceRead && s.Access != WorkspaceWrite && s.Access != WorkspaceDeny {
			return nil, fmt.Errorf("invalid scope access: %s", s.Access)
		}
		p, err := normalizeRemoteRel(s.Path)
		if err != nil {
			return nil, err
		}
		k := strings.ToLower(p)
		if s.Access != WorkspaceDeny {
			if prior, ok := nonDeny[k]; ok && prior != s.Access {
				return nil, fmt.Errorf("conflicting read/write scopes for path: %s", p)
			}
			nonDeny[k] = s.Access
		}
		key := string(s.Access) + "\x00" + k
		if !seen[key] {
			seen[key] = true
			out = append(out, WorkspaceScope{Path: p, Access: s.Access})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Path == out[j].Path {
			return out[i].Access < out[j].Access
		}
		return out[i].Path < out[j].Path
	})
	return out, nil
}

func scopeAuthorize(scopes []WorkspaceScope, rel string, access WorkspaceAccess) error {
	rel = filepath.Clean(filepath.FromSlash(rel))
	matched := make([]WorkspaceScope, 0)
	for _, s := range scopes {
		if scopeMatches(s.Path, rel) {
			matched = append(matched, s)
		}
	}
	for _, s := range matched {
		if s.Access == WorkspaceDeny {
			return fmt.Errorf("workspace path denied by scope: %s", s.Path)
		}
	}
	best := ""
	var bestAccess WorkspaceAccess
	for _, s := range matched {
		if s.Access == WorkspaceDeny {
			continue
		}
		p := filepath.Clean(filepath.FromSlash(s.Path))
		if len(p) > len(best) {
			best = p
			bestAccess = s.Access
		}
	}
	if bestAccess == WorkspaceWrite || (access == WorkspaceRead && bestAccess == WorkspaceRead) {
		return nil
	}
	return fmt.Errorf("workspace %s access not granted for %s", access, rel)
}

func (m *WorkspaceManager) advancedPaths() (string, string) {
	base := filepath.Dir(m.RegistryPath)
	return filepath.Join(base, "workspace-grants.json"), filepath.Join(base, "ephemeral")
}

func (m *WorkspaceManager) loadGrantsUnlocked() (WorkspaceGrantRegistry, error) {
	grantsPath, _ := m.advancedPaths()
	b, err := os.ReadFile(grantsPath)
	if os.IsNotExist(err) {
		return WorkspaceGrantRegistry{Schema: WorkspaceGrantSchema, Grants: map[string]WorkspaceGrant{}}, nil
	}
	if err != nil {
		return WorkspaceGrantRegistry{}, err
	}
	var r WorkspaceGrantRegistry
	if err := json.Unmarshal(b, &r); err != nil {
		return WorkspaceGrantRegistry{}, fmt.Errorf("parse grant registry: %w", err)
	}
	if r.Schema != WorkspaceGrantSchema {
		return WorkspaceGrantRegistry{}, fmt.Errorf("unsupported grant registry schema: %s", r.Schema)
	}
	if r.Grants == nil {
		r.Grants = map[string]WorkspaceGrant{}
	}
	return r, nil
}

func (m *WorkspaceManager) saveGrantsUnlocked(r *WorkspaceGrantRegistry) error {
	grantsPath, _ := m.advancedPaths()
	r.Schema = WorkspaceGrantSchema
	r.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	tmp := grantsPath + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, grantsPath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (m *WorkspaceManager) RegisterEphemeral(id, displayName, root, jobID string, expiresAt time.Time, scopes []WorkspaceScope, tools []string) (WorkspaceDefinition, error) {
	if !validOpaqueID(jobID, 80) {
		return WorkspaceDefinition{}, errors.New("valid owner job id required")
	}
	if expiresAt.IsZero() || !expiresAt.After(time.Now().UTC()) {
		return WorkspaceDefinition{}, errors.New("ephemeral expiry must be in the future")
	}
	if err := validateWorkspaceID(id); err != nil {
		return WorkspaceDefinition{}, err
	}
	root, err := ensureAbsoluteExistingDirectory(root)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	_, epRoot := m.advancedPaths()
	epAbs, _ := filepath.Abs(epRoot)
	if !pathWithin(epAbs, root) || pathEqual(epAbs, root) {
		return WorkspaceDefinition{}, errors.New("ephemeral root must be managed under workspace state")
	}
	scopes, err = normalizeScopes(root, scopes)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	tools, err = normalizeTools(tools)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = id
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadUnlocked()
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	if _, ok := r.Workspaces[id]; ok {
		return WorkspaceDefinition{}, fmt.Errorf("workspace already exists: %s", id)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	w := WorkspaceDefinition{ID: id, DisplayName: displayName, Kind: "ephemeral_checkout", Root: root, Scopes: scopes, Tools: tools, OwnerJobID: jobID, ExpiresAt: expiresAt.UTC().Format(time.RFC3339Nano), CreatedAt: now, UpdatedAt: now}
	r.Workspaces[id] = w
	if err := m.saveUnlocked(&r); err != nil {
		return WorkspaceDefinition{}, err
	}
	_ = m.auditUnlocked("workspace.ephemeral.register", id, map[string]any{"job_id": jobID, "expires_at": w.ExpiresAt, "managed_root": true})
	return w, nil
}

func (m *WorkspaceManager) RegisterRemote(id, displayName string, spec RemoteWorkspaceSpec, scopes []WorkspaceScope, tools []string) (WorkspaceDefinition, error) {
	if err := validateWorkspaceID(id); err != nil {
		return WorkspaceDefinition{}, err
	}
	if !validOpaqueID(spec.Adapter, 80) {
		return WorkspaceDefinition{}, errors.New("invalid remote adapter id")
	}
	if !validOpaqueID(spec.EndpointRef, 200) {
		return WorkspaceDefinition{}, errors.New("invalid remote endpoint reference")
	}
	if strings.Contains(spec.EndpointRef, "@") || strings.Contains(spec.EndpointRef, "?") {
		return WorkspaceDefinition{}, errors.New("credential-bearing remote endpoint reference rejected")
	}
	rootRef, err := normalizeRemoteRel(strings.TrimPrefix(spec.RootRef, "/"))
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	if rootRef == "." {
		rootRef = ""
	}
	spec.RootRef = rootRef
	if spec.CredentialRef != "" && !validOpaqueID(spec.CredentialRef, 160) {
		return WorkspaceDefinition{}, errors.New("invalid credential reference")
	}
	scopes, err = normalizeRemoteScopes(scopes)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	tools, err = normalizeTools(tools)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = id
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadUnlocked()
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	if _, ok := r.Workspaces[id]; ok {
		return WorkspaceDefinition{}, fmt.Errorf("workspace already exists: %s", id)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	w := WorkspaceDefinition{ID: id, DisplayName: displayName, Kind: "remote", Scopes: scopes, Tools: tools, Remote: &spec, CreatedAt: now, UpdatedAt: now}
	r.Workspaces[id] = w
	if err := m.saveUnlocked(&r); err != nil {
		return WorkspaceDefinition{}, err
	}
	_ = m.auditUnlocked("workspace.remote.register", id, map[string]any{"adapter": spec.Adapter, "endpoint_ref": spec.EndpointRef, "credential_ref_present": spec.CredentialRef != ""})
	return w, nil
}

func (m *WorkspaceManager) CreateGrant(id, workspaceID, jobID, issuer, context string, scopes []WorkspaceScope, tools []string, expiresAt time.Time) (WorkspaceGrant, error) {
	if !validOpaqueID(id, 80) || !validOpaqueID(jobID, 80) {
		return WorkspaceGrant{}, errors.New("valid grant id and job id required")
	}
	issuer = strings.TrimSpace(issuer)
	if issuer == "" || len(issuer) > 120 {
		return WorkspaceGrant{}, errors.New("valid issuer required")
	}
	if expiresAt.IsZero() || !expiresAt.After(time.Now().UTC()) {
		return WorkspaceGrant{}, errors.New("grant expiry must be in the future")
	}
	w, err := m.Inspect(workspaceID)
	if err != nil {
		return WorkspaceGrant{}, err
	}
	if w.Kind == "remote" {
		scopes, err = normalizeRemoteScopes(scopes)
	} else {
		scopes, err = normalizeScopes(w.Root, scopes)
	}
	if err != nil {
		return WorkspaceGrant{}, err
	}
	tools, err = normalizeTools(tools)
	if err != nil {
		return WorkspaceGrant{}, err
	}
	for _, s := range scopes {
		if s.Access == WorkspaceDeny {
			continue
		}
		if err := scopeAuthorize(w.Scopes, s.Path, s.Access); err != nil {
			return WorkspaceGrant{}, fmt.Errorf("grant exceeds workspace policy: %w", err)
		}
	}
	baseTools := map[string]bool{}
	for _, t := range w.Tools {
		baseTools[normalizeTool(t)] = true
	}
	for _, t := range tools {
		if !baseTools[normalizeTool(t)] {
			return WorkspaceGrant{}, fmt.Errorf("grant tool exceeds workspace policy: %s", t)
		}
	}
	g := WorkspaceGrant{ID: id, WorkspaceID: workspaceID, JobID: jobID, Issuer: issuer, Context: strings.TrimSpace(context), Scopes: scopes, Tools: tools, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), ExpiresAt: expiresAt.UTC().Format(time.RFC3339Nano)}
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadGrantsUnlocked()
	if err != nil {
		return WorkspaceGrant{}, err
	}
	if _, ok := r.Grants[id]; ok {
		return WorkspaceGrant{}, fmt.Errorf("grant already exists: %s", id)
	}
	r.Grants[id] = g
	if err := m.saveGrantsUnlocked(&r); err != nil {
		return WorkspaceGrant{}, err
	}
	_ = m.auditUnlocked("workspace.grant.create", workspaceID, map[string]any{"grant_id": id, "job_id": jobID, "issuer": issuer, "expires_at": g.ExpiresAt})
	return g, nil
}

func (m *WorkspaceManager) InspectGrant(id, workspaceID, jobID string, now time.Time) (WorkspaceGrant, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadGrantsUnlocked()
	if err != nil {
		return WorkspaceGrant{}, err
	}
	g, ok := r.Grants[id]
	if !ok {
		return WorkspaceGrant{}, fmt.Errorf("unknown grant: %s", id)
	}
	if g.WorkspaceID != workspaceID || g.JobID != jobID {
		return WorkspaceGrant{}, errors.New("grant workspace/job binding mismatch")
	}
	if g.RevokedAt != "" {
		return WorkspaceGrant{}, errors.New("grant revoked")
	}
	ex, err := time.Parse(time.RFC3339Nano, g.ExpiresAt)
	if err != nil {
		return WorkspaceGrant{}, errors.New("invalid grant expiry")
	}
	if !now.UTC().Before(ex) {
		return WorkspaceGrant{}, errors.New("grant expired")
	}
	return g, nil
}

func (m *WorkspaceManager) RevokeGrant(id, issuer string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadGrantsUnlocked()
	if err != nil {
		return err
	}
	g, ok := r.Grants[id]
	if !ok {
		return fmt.Errorf("unknown grant: %s", id)
	}
	if g.RevokedAt != "" {
		return nil
	}
	g.RevokedAt = time.Now().UTC().Format(time.RFC3339Nano)
	r.Grants[id] = g
	if err := m.saveGrantsUnlocked(&r); err != nil {
		return err
	}
	return m.auditUnlocked("workspace.grant.revoke", g.WorkspaceID, map[string]any{"grant_id": id, "job_id": g.JobID, "issuer": strings.TrimSpace(issuer)})
}

func (m *WorkspaceManager) EffectiveAuthorizePath(workspaceID, grantID, jobID, rel string, access WorkspaceAccess) (string, error) {
	w, err := m.Inspect(workspaceID)
	if err != nil {
		return "", err
	}
	var full string
	if w.Kind == "remote" {
		r, err := normalizeRemoteRel(rel)
		if err != nil {
			return "", err
		}
		if err := scopeAuthorize(w.Scopes, r, access); err != nil {
			return "", err
		}
		full = r
	} else {
		full, err = m.AuthorizePath(workspaceID, rel, access)
		if err != nil {
			return "", err
		}
	}
	if grantID == "" {
		if jobID != "" {
			return "", errors.New("job-scoped access requires grant")
		}
		return full, nil
	}
	if jobID == "" {
		return "", errors.New("grant requires job id")
	}
	g, err := m.InspectGrant(grantID, workspaceID, jobID, time.Now())
	if err != nil {
		return "", err
	}
	r := rel
	if w.Kind == "remote" {
		r, _ = normalizeRemoteRel(rel)
	} else {
		r, _ = filepath.Rel(w.Root, full)
	}
	if err := scopeAuthorize(g.Scopes, r, access); err != nil {
		return "", fmt.Errorf("grant restriction: %w", err)
	}
	return full, nil
}

func (m *WorkspaceManager) EffectiveToolAllowed(workspaceID, grantID, jobID, tool string) (bool, error) {
	ok, err := m.ToolAllowed(workspaceID, tool)
	if err != nil || !ok {
		return ok, err
	}
	if grantID == "" {
		if jobID != "" {
			return false, errors.New("job-scoped tool access requires grant")
		}
		return true, nil
	}
	if jobID == "" {
		return false, errors.New("grant requires job id")
	}
	g, err := m.InspectGrant(grantID, workspaceID, jobID, time.Now())
	if err != nil {
		return false, err
	}
	n := normalizeTool(tool)
	for _, t := range g.Tools {
		if normalizeTool(t) == n {
			return true, nil
		}
	}
	return false, nil
}

func (m *WorkspaceManager) PolicyStatus(workspaceID, grantID, jobID string) (WorkspacePolicyStatus, error) {
	w, err := m.Inspect(workspaceID)
	if err != nil {
		return WorkspacePolicyStatus{}, err
	}
	s := WorkspacePolicyStatus{WorkspaceID: w.ID, Kind: w.Kind, BaseScopes: w.Scopes, BaseTools: w.Tools, Effective: "workspace_policy"}
	if grantID != "" {
		g, err := m.InspectGrant(grantID, workspaceID, jobID, time.Now())
		if err != nil {
			return WorkspacePolicyStatus{}, err
		}
		s.Grant = &g
		s.Effective = "intersection(workspace_policy,job_grant)"
	}
	return s, nil
}

func (m *WorkspaceManager) CleanupAdvanced(now time.Time, activeJobs map[string]bool) (map[string]int, error) {
	result := map[string]int{"grants_expired": 0, "ephemeral_removed": 0}
	m.mu.Lock()
	defer m.mu.Unlock()
	gr, err := m.loadGrantsUnlocked()
	if err != nil {
		return nil, err
	}
	changed := false
	for id, g := range gr.Grants {
		ex, e := time.Parse(time.RFC3339Nano, g.ExpiresAt)
		if g.RevokedAt != "" || (e == nil && !now.UTC().Before(ex)) {
			delete(gr.Grants, id)
			result["grants_expired"]++
			changed = true
		}
	}
	if changed {
		if err := m.saveGrantsUnlocked(&gr); err != nil {
			return nil, err
		}
	}
	reg, err := m.loadUnlocked()
	if err != nil {
		return nil, err
	}
	_, epRoot := m.advancedPaths()
	epAbs, _ := filepath.Abs(epRoot)
	for id, w := range reg.Workspaces {
		if w.Kind != "ephemeral_checkout" {
			continue
		}
		ex, e := time.Parse(time.RFC3339Nano, w.ExpiresAt)
		expired := e != nil || !now.UTC().Before(ex)
		orphan := !activeJobs[w.OwnerJobID]
		if !expired && !orphan {
			continue
		}
		root, _ := filepath.Abs(w.Root)
		if !pathWithin(epAbs, root) || pathEqual(epAbs, root) {
			return nil, fmt.Errorf("ephemeral cleanup root escape: %s", root)
		}
		if err := rejectSymlinkComponents(root, true); err != nil {
			return nil, err
		}
		if err := os.RemoveAll(root); err != nil {
			return nil, err
		}
		delete(reg.Workspaces, id)
		result["ephemeral_removed"]++
	}
	if result["ephemeral_removed"] > 0 {
		if err := m.saveUnlocked(&reg); err != nil {
			return nil, err
		}
	}
	return result, nil
}
