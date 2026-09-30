package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type credentialHostRequest struct {
	ID       string `json:"id"`
	Username string `json:"username,omitempty"`
	Secret   string `json:"secret,omitempty"`
	Field    string `json:"field,omitempty"`
}

func browserCredentialExecutable() (string, error) {
	root, err := installRoot()
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, "browser", "sokna-browser-qa.exe")
	if st, err := os.Stat(path); err != nil || st.IsDir() {
		return "", errors.New("browser credential helper unavailable")
	}
	return path, nil
}

func runBrowserCredential(args []string, secret string) (json.RawMessage, error) {
	exe, err := browserCredentialExecutable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(exe, args...)
	if secret != "" {
		cmd.Stdin = strings.NewReader(secret)
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, errors.New("browser credential operation failed")
	}
	out = []byte(strings.TrimSpace(string(out)))
	if len(out) == 0 || !json.Valid(out) {
		return nil, errors.New("browser credential operation returned invalid result")
	}
	return json.RawMessage(out), nil
}

func handleCredentialMessage(m InMsg) (OutMsg, bool) {
	switch m.Type {
	case "credential.list":
		r, err := runBrowserCredential([]string{"credential", "list"}, "")
		if err != nil {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: err.Error()}, true
		}
		return OutMsg{OK: true, Type: "credential.result", RequestID: m.RequestID, Version: version, Result: r}, true
	case "credential.store":
		var q credentialHostRequest
		if len(m.Command) == 0 || json.Unmarshal(m.Command, &q) != nil {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: "invalid credential request"}, true
		}
		q.ID = strings.TrimSpace(q.ID)
		if !safeID.MatchString(q.ID) || len(q.Username) > 512 || q.Secret == "" || len(q.Secret) > 16384 {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: "invalid credential fields"}, true
		}
		r, err := runBrowserCredential([]string{"credential", "set", "--id", q.ID, "--username", q.Username}, q.Secret)
		q.Secret = ""
		if err != nil {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: err.Error()}, true
		}
		return OutMsg{OK: true, Type: "credential.result", RequestID: m.RequestID, Version: version, Result: r}, true
	case "credential.resolve":
		var q credentialHostRequest
		if len(m.Command) == 0 || json.Unmarshal(m.Command, &q) != nil {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: "invalid credential request"}, true
		}
		q.ID = strings.TrimSpace(q.ID)
		q.Field = strings.ToLower(strings.TrimSpace(q.Field))
		if !safeID.MatchString(q.ID) || (q.Field != "username" && q.Field != "secret" && q.Field != "password") {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: "invalid credential resolve fields"}, true
		}
		r, err := runBrowserCredential([]string{"credential", "resolve", "--id", q.ID, "--field", q.Field}, "")
		if err != nil {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: err.Error()}, true
		}
		return OutMsg{OK: true, Type: "credential.result", RequestID: m.RequestID, Version: version, Result: r}, true
	case "credential.delete":
		var q credentialHostRequest
		if len(m.Command) == 0 || json.Unmarshal(m.Command, &q) != nil {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: "invalid credential request"}, true
		}
		q.ID = strings.TrimSpace(q.ID)
		if !safeID.MatchString(q.ID) {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: "invalid credential id"}, true
		}
		r, err := runBrowserCredential([]string{"credential", "delete", "--id", q.ID}, "")
		if err != nil {
			return OutMsg{OK: false, Type: "credential.result", RequestID: m.RequestID, Error: err.Error()}, true
		}
		return OutMsg{OK: true, Type: "credential.result", RequestID: m.RequestID, Version: version, Result: r}, true
	default:
		return OutMsg{}, false
	}
}
