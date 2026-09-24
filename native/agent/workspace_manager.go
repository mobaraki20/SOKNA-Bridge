package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

type WorkspaceAccess string

const (
	WorkspaceRead  WorkspaceAccess = "read"
	WorkspaceWrite WorkspaceAccess = "write"
	WorkspaceDeny  WorkspaceAccess = "deny"
)

const WorkspaceRegistrySchema = "sokna-workspace-registry-v1"

type WorkspaceScope struct {
	Path   string          `json:"path"`
	Access WorkspaceAccess `json:"access"`
}

type WorkspaceDefinition struct {
	ID                 string               `json:"id"`
	DisplayName        string               `json:"display_name"`
	Kind               string               `json:"kind"`
	Root               string               `json:"root,omitempty"`
	Scopes             []WorkspaceScope     `json:"scopes"`
	Tools              []string             `json:"tools"`
	LegacyExpectedRepo string               `json:"legacy_expected_repo,omitempty"`
	OwnerJobID         string               `json:"owner_job_id,omitempty"`
	ExpiresAt          string               `json:"expires_at,omitempty"`
	Remote             *RemoteWorkspaceSpec `json:"remote,omitempty"`
	CreatedAt          string               `json:"created_at"`
	UpdatedAt          string               `json:"updated_at"`
}

type WorkspaceRegistry struct {
	Schema           string                         `json:"schema"`
	DefaultWorkspace string                         `json:"default_workspace,omitempty"`
	Workspaces       map[string]WorkspaceDefinition `json:"workspaces"`
	UpdatedAt        string                         `json:"updated_at"`
}

type LegacyWorkspace struct {
	Path         string
	ExpectedRepo string
	WriteEnabled bool
}

type WorkspaceAssessment struct {
	Root            string `json:"root"`
	Exists          bool   `json:"exists"`
	IsDirectory     bool   `json:"is_directory"`
	IsGitRepository bool   `json:"is_git_repository"`
	FileCount       int64  `json:"file_count"`
	TotalBytes      int64  `json:"total_bytes"`
	ReparseBlocked  bool   `json:"reparse_blocked"`
}

type ManagedCopyPlan struct {
	Schema             string   `json:"schema"`
	Source             string   `json:"source"`
	Destination        string   `json:"destination"`
	Stages             []string `json:"stages"`
	SourceDeletion     string   `json:"source_deletion"`
	AutomaticExecution bool     `json:"automatic_execution"`
}

type WorkspaceManager struct {
	RegistryPath string
	AuditPath    string
	mu           sync.Mutex
}

func NewWorkspaceManager(registryPath, auditPath string) (*WorkspaceManager, error) {
	if strings.TrimSpace(registryPath) == "" {
		return nil, errors.New("workspace registry path required")
	}
	registryPath, err := filepath.Abs(registryPath)
	if err != nil {
		return nil, fmt.Errorf("workspace registry path: %w", err)
	}
	if strings.TrimSpace(auditPath) == "" {
		auditPath = filepath.Join(filepath.Dir(registryPath), "workspace-audit.jsonl")
	}
	auditPath, err = filepath.Abs(auditPath)
	if err != nil {
		return nil, fmt.Errorf("workspace audit path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(registryPath), 0755); err != nil {
		return nil, err
	}
	m := &WorkspaceManager{RegistryPath: registryPath, AuditPath: auditPath}
	if _, err := m.Load(); err != nil {
		return nil, err
	}
	return m, nil
}

func emptyWorkspaceRegistry() WorkspaceRegistry {
	return WorkspaceRegistry{Schema: WorkspaceRegistrySchema, Workspaces: map[string]WorkspaceDefinition{}}
}

func (m *WorkspaceManager) Load() (WorkspaceRegistry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.loadUnlocked()
}

func (m *WorkspaceManager) loadUnlocked() (WorkspaceRegistry, error) {
	b, err := os.ReadFile(m.RegistryPath)
	if os.IsNotExist(err) {
		r := emptyWorkspaceRegistry()
		if err := m.saveUnlocked(&r); err != nil {
			return WorkspaceRegistry{}, err
		}
		return r, nil
	}
	if err != nil {
		return WorkspaceRegistry{}, fmt.Errorf("read workspace registry: %w", err)
	}
	var r WorkspaceRegistry
	if err := json.Unmarshal(b, &r); err != nil {
		return WorkspaceRegistry{}, fmt.Errorf("parse workspace registry: %w", err)
	}
	if r.Schema != WorkspaceRegistrySchema {
		return WorkspaceRegistry{}, fmt.Errorf("unsupported workspace registry schema: %s", r.Schema)
	}
	if r.Workspaces == nil {
		r.Workspaces = map[string]WorkspaceDefinition{}
	}
	return r, nil
}

func (m *WorkspaceManager) saveUnlocked(r *WorkspaceRegistry) error {
	r.Schema = WorkspaceRegistrySchema
	r.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if r.Workspaces == nil {
		r.Workspaces = map[string]WorkspaceDefinition{}
	}
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.RegistryPath + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, m.RegistryPath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func validateWorkspaceID(id string) error {
	if id == "" || len(id) > 80 {
		return errors.New("workspace id must be 1..80 chars")
	}
	for _, r := range id {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.') {
			return fmt.Errorf("invalid workspace id: %s", id)
		}
	}
	return nil
}

func normalizeTool(t string) string {
	t = strings.TrimSpace(strings.ToLower(filepath.Base(t)))
	for _, suffix := range []string{".exe", ".cmd", ".bat"} {
		t = strings.TrimSuffix(t, suffix)
	}
	return t
}

func normalizeTools(tools []string) ([]string, error) {
	seen := map[string]bool{}
	out := make([]string, 0, len(tools))
	for _, raw := range tools {
		t := normalizeTool(raw)
		if t == "" || strings.ContainsAny(t, "/\\\x00\r\n\t ") {
			return nil, fmt.Errorf("invalid tool: %q", raw)
		}
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	sort.Strings(out)
	return out, nil
}

func ensureAbsoluteExistingDirectory(root string) (string, error) {
	if strings.TrimSpace(root) == "" {
		return "", errors.New("workspace root required")
	}
	if !filepath.IsAbs(root) {
		return "", errors.New("workspace root must be absolute")
	}
	abs := filepath.Clean(root)
	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("workspace root: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("workspace root is not a directory")
	}
	if err := rejectSymlinkComponents(abs, false); err != nil {
		return "", err
	}
	return abs, nil
}

func pathEqual(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func pathWithin(root, candidate string) bool {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel))
}

func rejectSymlinkComponents(path string, allowMissingLeaf bool) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	vol := filepath.VolumeName(abs)
	rest := strings.TrimPrefix(abs, vol)
	rest = strings.TrimLeft(rest, `/\\`)
	current := vol + string(filepath.Separator)
	if vol == "" {
		current = string(filepath.Separator)
	}
	parts := strings.FieldsFunc(rest, func(r rune) bool { return r == '/' || r == '\\' })
	for i, p := range parts {
		current = filepath.Join(current, p)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) && allowMissingLeaf && i == len(parts)-1 {
			return nil
		}
		if os.IsNotExist(err) && allowMissingLeaf {
			continue
		}
		if err != nil {
			return fmt.Errorf("inspect workspace path: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("workspace symlink/reparse path rejected: %s", current)
		}
	}
	return nil
}

func normalizeScope(root string, s WorkspaceScope) (WorkspaceScope, error) {
	if s.Access != WorkspaceRead && s.Access != WorkspaceWrite && s.Access != WorkspaceDeny {
		return WorkspaceScope{}, fmt.Errorf("invalid scope access: %s", s.Access)
	}
	raw := strings.TrimSpace(s.Path)
	if raw == "" || raw == "." {
		raw = "."
	}
	if filepath.IsAbs(raw) {
		return WorkspaceScope{}, errors.New("scope path must be workspace-relative")
	}
	full := filepath.Clean(filepath.Join(root, raw))
	if !pathWithin(root, full) {
		return WorkspaceScope{}, errors.New("scope escapes workspace root")
	}
	if err := rejectSymlinkComponents(full, true); err != nil {
		return WorkspaceScope{}, err
	}
	rel, err := filepath.Rel(root, full)
	if err != nil {
		return WorkspaceScope{}, err
	}
	if rel == "" {
		rel = "."
	}
	return WorkspaceScope{Path: filepath.ToSlash(rel), Access: s.Access}, nil
}

func normalizeScopes(root string, scopes []WorkspaceScope) ([]WorkspaceScope, error) {
	if len(scopes) == 0 {
		return nil, errors.New("at least one explicit workspace scope is required")
	}
	out := make([]WorkspaceScope, 0, len(scopes))
	seen := map[string]bool{}
	nonDenyByPath := map[string]WorkspaceAccess{}
	for _, s := range scopes {
		n, err := normalizeScope(root, s)
		if err != nil {
			return nil, err
		}
		pathKey := strings.ToLower(n.Path)
		if n.Access != WorkspaceDeny {
			if prior, ok := nonDenyByPath[pathKey]; ok && prior != n.Access {
				return nil, fmt.Errorf("conflicting read/write scopes for path: %s", n.Path)
			}
			nonDenyByPath[pathKey] = n.Access
		}
		key := string(n.Access) + "\x00" + pathKey
		if !seen[key] {
			seen[key] = true
			out = append(out, n)
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

func (m *WorkspaceManager) RegisterPersistentLocal(id, displayName, root string, scopes []WorkspaceScope, tools []string) (WorkspaceDefinition, error) {
	if err := validateWorkspaceID(id); err != nil {
		return WorkspaceDefinition{}, err
	}
	root, err := ensureAbsoluteExistingDirectory(root)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	scopes, err = normalizeScopes(root, scopes)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	tools, err = normalizeTools(tools)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		displayName = id
	}
	if len(displayName) > 200 || strings.ContainsAny(displayName, "\x00\r\n") {
		return WorkspaceDefinition{}, errors.New("invalid workspace display name")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadUnlocked()
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	if _, exists := r.Workspaces[id]; exists {
		return WorkspaceDefinition{}, fmt.Errorf("workspace already exists: %s", id)
	}
	for existingID, existing := range r.Workspaces {
		if pathEqual(existing.Root, root) {
			return WorkspaceDefinition{}, fmt.Errorf("workspace root already registered as %s", existingID)
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	w := WorkspaceDefinition{ID: id, DisplayName: displayName, Kind: "persistent_local", Root: root, Scopes: scopes, Tools: tools, CreatedAt: now, UpdatedAt: now}
	r.Workspaces[id] = w
	if r.DefaultWorkspace == "" {
		r.DefaultWorkspace = id
	}
	if err := m.saveUnlocked(&r); err != nil {
		return WorkspaceDefinition{}, err
	}
	if err := m.auditUnlocked("workspace.register", id, map[string]any{"root": root, "kind": w.Kind, "source_preserved": true}); err != nil {
		return WorkspaceDefinition{}, err
	}
	return w, nil
}

func (m *WorkspaceManager) List() ([]WorkspaceDefinition, string, error) {
	r, err := m.Load()
	if err != nil {
		return nil, "", err
	}
	ids := make([]string, 0, len(r.Workspaces))
	for id := range r.Workspaces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]WorkspaceDefinition, 0, len(ids))
	for _, id := range ids {
		out = append(out, r.Workspaces[id])
	}
	return out, r.DefaultWorkspace, nil
}

func (m *WorkspaceManager) Inspect(id string) (WorkspaceDefinition, error) {
	r, err := m.Load()
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	if id == "" {
		id = r.DefaultWorkspace
	}
	w, ok := r.Workspaces[id]
	if !ok {
		return WorkspaceDefinition{}, fmt.Errorf("unknown workspace: %s", id)
	}
	if w.ID != id {
		return WorkspaceDefinition{}, fmt.Errorf("workspace registry id mismatch: key=%s id=%s", id, w.ID)
	}
	var root string
	var scopes []WorkspaceScope
	switch w.Kind {
	case "persistent_local", "ephemeral_checkout":
		root, err = ensureAbsoluteExistingDirectory(w.Root)
		if err != nil {
			return WorkspaceDefinition{}, err
		}
		scopes, err = normalizeScopes(root, w.Scopes)
	case "remote":
		if w.Remote == nil {
			return WorkspaceDefinition{}, errors.New("remote workspace spec missing")
		}
		scopes, err = normalizeRemoteScopes(w.Scopes)
	default:
		return WorkspaceDefinition{}, fmt.Errorf("unsupported workspace kind: %s", w.Kind)
	}
	if err != nil {
		return WorkspaceDefinition{}, fmt.Errorf("invalid persisted workspace scopes: %w", err)
	}
	tools, err := normalizeTools(w.Tools)
	if err != nil {
		return WorkspaceDefinition{}, fmt.Errorf("invalid persisted workspace tools: %w", err)
	}
	if w.Kind != "remote" {
		w.Root = root
	}
	w.Scopes, w.Tools = scopes, tools
	return w, nil
}

func (m *WorkspaceManager) UpdatePermissions(id string, scopes []WorkspaceScope, tools []string) (WorkspaceDefinition, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadUnlocked()
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	w, ok := r.Workspaces[id]
	if !ok {
		return WorkspaceDefinition{}, fmt.Errorf("unknown workspace: %s", id)
	}
	var normalizedScopes []WorkspaceScope
	if w.Kind == "remote" {
		normalizedScopes, err = normalizeRemoteScopes(scopes)
	} else {
		root, rootErr := ensureAbsoluteExistingDirectory(w.Root)
		if rootErr != nil {
			return WorkspaceDefinition{}, rootErr
		}
		normalizedScopes, err = normalizeScopes(root, scopes)
	}
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	tools, err = normalizeTools(tools)
	if err != nil {
		return WorkspaceDefinition{}, err
	}
	w.Scopes = normalizedScopes
	w.Tools = tools
	w.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	r.Workspaces[id] = w
	if err := m.saveUnlocked(&r); err != nil {
		return WorkspaceDefinition{}, err
	}
	if err := m.auditUnlocked("workspace.permissions.update", id, map[string]any{"scope_count": len(scopes), "tool_count": len(tools)}); err != nil {
		return WorkspaceDefinition{}, err
	}
	return w, nil
}

func (m *WorkspaceManager) Unregister(id string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadUnlocked()
	if err != nil {
		return "", err
	}
	w, ok := r.Workspaces[id]
	if !ok {
		return "", fmt.Errorf("unknown workspace: %s", id)
	}
	delete(r.Workspaces, id)
	if r.DefaultWorkspace == id {
		r.DefaultWorkspace = ""
		ids := make([]string, 0, len(r.Workspaces))
		for k := range r.Workspaces {
			ids = append(ids, k)
		}
		sort.Strings(ids)
		if len(ids) > 0 {
			r.DefaultWorkspace = ids[0]
		}
	}
	if err := m.saveUnlocked(&r); err != nil {
		return "", err
	}
	if err := m.auditUnlocked("workspace.unregister", id, map[string]any{"root": w.Root, "source_preserved": true, "source_deleted": false}); err != nil {
		return "", err
	}
	return w.Root, nil
}

func scopeMatches(scopePath, rel string) bool {
	s := filepath.Clean(filepath.FromSlash(scopePath))
	r := filepath.Clean(rel)
	if s == "." {
		return true
	}
	return pathWithin(s, r)
}

func (m *WorkspaceManager) AuthorizePath(id, rel string, access WorkspaceAccess) (string, error) {
	if access != WorkspaceRead && access != WorkspaceWrite {
		return "", errors.New("authorize access must be read or write")
	}
	w, err := m.Inspect(id)
	if err != nil {
		return "", err
	}
	if filepath.IsAbs(rel) {
		return "", errors.New("workspace path must be relative")
	}
	if strings.TrimSpace(rel) == "" {
		rel = "."
	}
	full := filepath.Clean(filepath.Join(w.Root, rel))
	if !pathWithin(w.Root, full) {
		return "", errors.New("path escapes workspace root")
	}
	if err := rejectSymlinkComponents(full, true); err != nil {
		return "", err
	}
	normalizedRel, err := filepath.Rel(w.Root, full)
	if err != nil {
		return "", err
	}
	if normalizedRel == "" {
		normalizedRel = "."
	}
	matched := make([]WorkspaceScope, 0)
	for _, s := range w.Scopes {
		if scopeMatches(s.Path, normalizedRel) {
			matched = append(matched, s)
		}
	}
	for _, s := range matched {
		if s.Access == WorkspaceDeny {
			return "", fmt.Errorf("workspace path denied by scope: %s", s.Path)
		}
	}
	best := ""
	var bestAccess WorkspaceAccess
	for _, s := range matched {
		if s.Access == WorkspaceDeny {
			continue
		}
		n := filepath.Clean(filepath.FromSlash(s.Path))
		if len(n) > len(best) {
			best = n
			bestAccess = s.Access
		}
	}
	allowed := bestAccess == WorkspaceWrite || (access == WorkspaceRead && bestAccess == WorkspaceRead)
	if !allowed {
		return "", fmt.Errorf("workspace %s access not granted for %s", access, normalizedRel)
	}
	return full, nil
}

func (m *WorkspaceManager) FullAccess(id string, access WorkspaceAccess) error {
	w, err := m.Inspect(id)
	if err != nil {
		return err
	}
	rootGrant := WorkspaceAccess("")
	for _, s := range w.Scopes {
		if s.Access == WorkspaceDeny {
			return fmt.Errorf("workspace has deny scope: %s", s.Path)
		}
		if access == WorkspaceWrite && s.Access == WorkspaceRead {
			return fmt.Errorf("workspace broad write blocked by read scope: %s", s.Path)
		}
		if filepath.Clean(filepath.FromSlash(s.Path)) == "." {
			rootGrant = s.Access
		}
	}
	if access == WorkspaceWrite && rootGrant != WorkspaceWrite {
		return errors.New("workspace does not grant full write access")
	}
	if access == WorkspaceRead && rootGrant != WorkspaceRead && rootGrant != WorkspaceWrite {
		return errors.New("workspace does not grant full read access")
	}
	return nil
}

func (m *WorkspaceManager) ToolAllowed(id, tool string) (bool, error) {
	w, err := m.Inspect(id)
	if err != nil {
		return false, err
	}
	tool = normalizeTool(tool)
	for _, t := range w.Tools {
		if normalizeTool(t) == tool {
			return true, nil
		}
	}
	return false, nil
}

func (m *WorkspaceManager) AssessFolder(root string) (WorkspaceAssessment, error) {
	a := WorkspaceAssessment{Root: root}
	abs, err := filepath.Abs(root)
	if err != nil {
		return a, err
	}
	a.Root = abs
	info, err := os.Stat(abs)
	if os.IsNotExist(err) {
		return a, nil
	}
	if err != nil {
		return a, err
	}
	a.Exists = true
	a.IsDirectory = info.IsDir()
	if !info.IsDir() {
		return a, nil
	}
	if err := rejectSymlinkComponents(abs, false); err != nil {
		a.ReparseBlocked = true
		return a, err
	}
	a.IsGitRepository = isDirectory(filepath.Join(abs, ".git"))
	err = filepath.WalkDir(abs, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("workspace symlink/reparse path rejected: %s", path)
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		a.FileCount++
		a.TotalBytes += info.Size()
		return nil
	})
	if err != nil {
		a.ReparseBlocked = true
		return a, err
	}
	return a, nil
}

func isDirectory(p string) bool { i, e := os.Stat(p); return e == nil && i.IsDir() }

func (m *WorkspaceManager) PlanManagedCopy(source, destination string) (ManagedCopyPlan, error) {
	source, err := ensureAbsoluteExistingDirectory(source)
	if err != nil {
		return ManagedCopyPlan{}, err
	}
	if !filepath.IsAbs(destination) {
		return ManagedCopyPlan{}, errors.New("managed copy destination must be absolute")
	}
	destination = filepath.Clean(destination)
	if err := rejectSymlinkComponents(destination, true); err != nil {
		return ManagedCopyPlan{}, err
	}
	if pathWithin(source, destination) || pathWithin(destination, source) {
		return ManagedCopyPlan{}, errors.New("managed copy source and destination cannot contain one another")
	}
	p := ManagedCopyPlan{Schema: "sokna-managed-copy-plan-v1", Source: source, Destination: destination, Stages: []string{"copy", "verify", "test", "switch"}, SourceDeletion: "separate_explicit_action_outside_mvp", AutomaticExecution: false}
	m.mu.Lock()
	defer m.mu.Unlock()
	_ = m.auditUnlocked("workspace.managed_copy.plan", "", map[string]any{"source": source, "destination": destination, "source_preserved": true})
	return p, nil
}

func (m *WorkspaceManager) MigrateLegacy(legacy map[string]LegacyWorkspace, defaultWorkspace, sourceConfig string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.loadUnlocked()
	if err != nil {
		return 0, err
	}
	if len(r.Workspaces) > 0 {
		return 0, nil
	}
	ids := make([]string, 0, len(legacy))
	for id := range legacy {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	count := 0
	legacyIDMap := map[string]string{}
	for _, legacyName := range ids {
		id := deterministicLegacyID(legacyName)
		legacyIDMap[legacyName] = id
		if _, collision := r.Workspaces[id]; collision {
			continue
		}
		old := legacy[legacyName]
		root, err := ensureAbsoluteExistingDirectory(old.Path)
		if err != nil {
			continue
		}
		access := WorkspaceRead
		if old.WriteEnabled {
			access = WorkspaceWrite
		}
		scopes, _ := normalizeScopes(root, []WorkspaceScope{{Path: ".", Access: access}})
		now := time.Now().UTC().Format(time.RFC3339Nano)
		r.Workspaces[id] = WorkspaceDefinition{ID: id, DisplayName: legacyName, Kind: "persistent_local", Root: root, Scopes: scopes, Tools: []string{}, LegacyExpectedRepo: old.ExpectedRepo, CreatedAt: now, UpdatedAt: now}
		count++
	}
	defaultID := legacyIDMap[defaultWorkspace]
	if _, ok := r.Workspaces[defaultID]; ok {
		r.DefaultWorkspace = defaultID
	} else if count > 0 {
		for _, legacyName := range ids {
			id := legacyIDMap[legacyName]
			if _, ok := r.Workspaces[id]; ok {
				r.DefaultWorkspace = id
				break
			}
		}
	}
	if err := m.saveUnlocked(&r); err != nil {
		return 0, err
	}
	if count > 0 {
		if err := m.auditUnlocked("workspace.legacy.migrate", "", map[string]any{"source_config": sourceConfig, "source_preserved": true, "migrated_count": count, "tool_permissions_require_review": true}); err != nil {
			return 0, err
		}
	}
	return count, nil
}

func (m *WorkspaceManager) auditUnlocked(action, id string, data map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(m.AuditPath), 0755); err != nil {
		return err
	}
	e := map[string]any{"schema": "sokna-workspace-audit-v1", "timestamp": time.Now().UTC().Format(time.RFC3339Nano), "action": action}
	if id != "" {
		e["workspace_id"] = id
	}
	for k, v := range data {
		e[k] = v
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(m.AuditPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(b, '\n'))
	return err
}

func (m *WorkspaceManager) AuditEvents() ([]map[string]any, error) {
	f, err := os.Open(m.AuditPath)
	if os.IsNotExist(err) {
		return []map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := []map[string]any{}
	s := bufio.NewScanner(f)
	for s.Scan() {
		var e map[string]any
		if json.Unmarshal(s.Bytes(), &e) == nil {
			out = append(out, e)
		}
	}
	return out, s.Err()
}

func deterministicLegacyID(name string) string {
	if validateWorkspaceID(name) == nil {
		return name
	}
	h := sha256.Sum256([]byte(name))
	return "legacy-" + hex.EncodeToString(h[:4])
}
