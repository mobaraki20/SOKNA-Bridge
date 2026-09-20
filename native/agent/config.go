package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type WorkspaceConfig struct {
	Path         string `json:"path"`
	ExpectedRepo string `json:"expected_repo"`
	WriteEnabled bool   `json:"write_enabled"`
]
n
type Config struct {
	Port                int                        `json:"port"`
	Token               string                      `json:"token"`
	WorkspaceRoot       string                     `json:"workspace_root"`
	DefaultWorkspace    string                      `json:"default_workspace"`
	DefaultGitHubOwner  string                     `json:"default_github_owner"`
	AllowedGitHubOwners []string                   `json:"allowed_github_owners"`
	Workspaces          map[string]WorkspaceConfig `json:"workspaces"`
]

func defaultConfigPath() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if strings.TrimSpace(local) == "" {
		return "", fmt.Errorf("LOCALAPPDATA is not available")
	}
	return filepath.Join(local, "SOKNA-Bridge-V2", "config.json"), nil
}

func LoadConfig(path string) (*Config, error) {
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = defaultConfigPath()
		if err != nil {
			return nil, err
		}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	if cfg.Port <= 0 {
		return nil, fmt.Errorf("invalid port")
	}
	if strings.TrimSpace(cfg.Token) == "" {
		return nil, fmt.Errorf("token missing")
	}
	if strings.TrimSpace(cfg.WorkspaceRoot) == "" {
		return nil, fmt.Errorf("workspace_root missing")
	}
	if strings.TrimSpace(cfg.DefaultWorkspace) == "" {
		return nil, fmt.Errorf("default_workspace missing")
	}
	if len(cfg.Workspaces) == 0 {
		return nil, fmt.Errorf("workspaces missing")
	}
	return &cfg, nil
}

func (c *Config) ResolveWorkspace(name string) (string, WorkspaceConfig, error) {
	if strings.TrimSpace(name) == "" {
		name = c.DefaultWorkspace
	}
	w, ok := c.Workspaces[name]
	if !ok {
		return "", WorkspaceConfig{}, fmt.Errorf("unknown workspace: %s", name)
	}
	p, err := filepath.Abs(w.Path)
	if err != nil {
		return "", WorkspaceConfig{}, fmt.Errorf("workspace path: %w", err)
	}
	info, err := os.Stat(p)
	if err != nil || !info.IsDir() {
		return "", WorkspaceConfig{}, fmt.Errorf("workspace path not found: %s", p)
	}
	w.Path = p
	return name, w, nil
}


