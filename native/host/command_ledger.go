package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const commandLedgerSchema = "sokna-command-ledger-v1"
const systemConversationKey = "bridge:system"

type commandLedgerRecord struct {
	Schema          string          `json:"schema"`
	ConversationKey string          `json:"conversation_key"`
	ID              string          `json:"id"`
	Action          string          `json:"action"`
	ParamsSHA256    string          `json:"params_sha256"`
	State           string          `json:"state"`
	Sequence        int64           `json:"sequence"`
	AcceptedAt      int64           `json:"accepted_at"`
	CompletedAt     int64           `json:"completed_at,omitempty"`
	Result          json.RawMessage `json:"result,omitempty"`
	Error           string          `json:"error,omitempty"`
}

func commandScope(c CommandEnvelope) string {
	if v := strings.TrimSpace(c.ConversationKey); v != "" {
		return v
	}
	return systemConversationKey
}

func commandLedgerDir() (string, error) {
	base := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if base == "" {
		var err error
		base, err = os.UserConfigDir()
		if err != nil || strings.TrimSpace(base) == "" {
			return "", errors.New("user config directory unavailable")
		}
	}
	return filepath.Join(base, "SOKNA", "Bridge", "commands"), nil
}

func scopeHash(scope string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(scope)))
	return hex.EncodeToString(sum[:16])
}

func commandParamsHash(c CommandEnvelope) string {
	h := sha256.New()
	_, _ = h.Write([]byte(strings.TrimSpace(c.Action)))
	_, _ = h.Write([]byte{0})
	if len(c.Params) > 0 {
		var compact bytes.Buffer
		if json.Compact(&compact, c.Params) == nil {
			_, _ = h.Write(compact.Bytes())
		} else {
			_, _ = h.Write(c.Params)
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

func commandDir(scope, id string) (string, error) {
	if !safeID.MatchString(id) {
		return "", errors.New("invalid command id")
	}
	root, err := commandLedgerDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, scopeHash(scope), id), nil
}

func phasePath(scope, id, phase string) (string, error) {
	dir, err := commandDir(scope, id)
	if err != nil {
		return "", err
	}
	switch phase {
	case "accepted", "running", "terminal":
	default:
		return "", errors.New("invalid command ledger phase")
	}
	return filepath.Join(dir, phase+".json"), nil
}

func writeImmutableCommandPhase(rec commandLedgerRecord, phase string) error {
	p, err := phasePath(rec.ConversationKey, rec.ID, phase)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	if _, err := os.Stat(p); err == nil {
		return os.ErrExist
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	b, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + fmt.Sprintf(".tmp-%d", time.Now().UnixNano())
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func readCommandPhase(scope, id, phase string) (commandLedgerRecord, error) {
	var rec commandLedgerRecord
	p, err := phasePath(scope, id, phase)
	if err != nil {
		return rec, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return rec, err
	}
	if err := json.Unmarshal(b, &rec); err != nil {
		return rec, err
	}
	if rec.Schema != commandLedgerSchema || rec.ID != id || rec.ConversationKey != scope {
		return rec, errors.New("command ledger record integrity mismatch")
	}
	return rec, nil
}

func readCommandRecord(scope, id string) (commandLedgerRecord, error) {
	for _, phase := range []string{"terminal", "running", "accepted"} {
		rec, err := readCommandPhase(scope, id, phase)
		if err == nil {
			return rec, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return rec, err
		}
	}
	return commandLedgerRecord{}, os.ErrNotExist
}

func shouldLedgerCommand(c CommandEnvelope) bool {
	if strings.TrimSpace(c.ParentID) != "" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(c.Action)) {
	case "bridge.command.get", "bridge.command.list":
		return false
	default:
		return true
	}
}

func beginCommandRecord(c CommandEnvelope) (commandLedgerRecord, bool, error) {
	scope := commandScope(c)
	existing, err := readCommandRecord(scope, c.ID)
	if err == nil {
		if existing.Action != c.Action || existing.ParamsSHA256 != commandParamsHash(c) {
			return existing, true, errors.New("COMMAND_ID_CONFLICT: existing command id has different action or params")
		}
		if existing.State == "accepted" || existing.State == "running" {
			unknown := existing
			unknown.State = "outcome_unknown"
			unknown.CompletedAt = time.Now().UTC().UnixMilli()
			unknown.Error = "COMMAND_OUTCOME_UNKNOWN: command was previously accepted without a durable terminal result"
			if werr := writeImmutableCommandPhase(unknown, "terminal"); werr != nil && !errors.Is(werr, os.ErrExist) {
				return existing, true, werr
			}
			return readCommandRecord(scope, c.ID)
		}
		return existing, true, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return commandLedgerRecord{}, false, err
	}
	now := time.Now().UTC()
	rec := commandLedgerRecord{
		Schema: commandLedgerSchema, ConversationKey: scope, ID: c.ID, Action: c.Action, ParamsSHA256: commandParamsHash(c),
		State: "accepted", Sequence: now.UnixNano(), AcceptedAt: now.UnixMilli(),
	}
	if err := writeImmutableCommandPhase(rec, "accepted"); err != nil {
		return commandLedgerRecord{}, false, err
	}
	return rec, false, nil
}

func markCommandRunning(c CommandEnvelope) error {
	scope := commandScope(c)
	rec, err := readCommandRecord(scope, c.ID)
	if err != nil {
		return err
	}
	if rec.State == "succeeded" || rec.State == "failed" || rec.State == "outcome_unknown" {
		return errors.New("COMMAND_ALREADY_TERMINAL")
	}
	rec.State = "running"
	err = writeImmutableCommandPhase(rec, "running")
	if errors.Is(err, os.ErrExist) {
		return nil
	}
	return err
}

func completeCommandRecord(c CommandEnvelope, result json.RawMessage) error {
	scope := commandScope(c)
	rec, err := readCommandRecord(scope, c.ID)
	if err != nil {
		return err
	}
	if rec.State == "succeeded" {
		return nil
	}
	if rec.State == "failed" || rec.State == "outcome_unknown" {
		return errors.New("COMMAND_ALREADY_TERMINAL")
	}
	rec.State = "succeeded"
	rec.CompletedAt = time.Now().UTC().UnixMilli()
	rec.Error = ""
	rec.Result = append(json.RawMessage(nil), result...)
	return writeImmutableCommandPhase(rec, "terminal")
}

func failCommandRecord(c CommandEnvelope, cause error) error {
	scope := commandScope(c)
	rec, err := readCommandRecord(scope, c.ID)
	if err != nil {
		return err
	}
	if rec.State == "failed" {
		return nil
	}
	if rec.State == "succeeded" || rec.State == "outcome_unknown" {
		return errors.New("COMMAND_ALREADY_TERMINAL")
	}
	rec.State = "failed"
	rec.CompletedAt = time.Now().UTC().UnixMilli()
	rec.Result = nil
	rec.Error = trimError(cause)
	return writeImmutableCommandPhase(rec, "terminal")
}

func replayCommandRecord(rec commandLedgerRecord, requestID string) OutMsg {
	switch rec.State {
	case "succeeded":
		return OutMsg{OK: true, Type: "agent.result", RequestID: requestID, Version: version, Result: rec.Result}
	case "failed":
		return OutMsg{OK: false, RequestID: requestID, Version: version, Error: "COMMAND_REPLAY_FAILED: " + rec.Error}
	default:
		errText := rec.Error
		if errText == "" {
			errText = "COMMAND_OUTCOME_UNKNOWN: durable terminal result is unavailable"
		}
		return OutMsg{OK: false, RequestID: requestID, Version: version, Error: errText}
	}
}

func listCommandRecords(scope string, since int64, limit int) ([]commandLedgerRecord, int64, bool, error) {
	root, err := commandLedgerDir()
	if err != nil {
		return nil, since, false, err
	}
	dir := filepath.Join(root, scopeHash(scope))
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []commandLedgerRecord{}, since, false, nil
	}
	if err != nil {
		return nil, since, false, err
	}
	items := make([]commandLedgerRecord, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() || !safeID.MatchString(e.Name()) {
			continue
		}
		rec, er := readCommandRecord(scope, e.Name())
		if er == nil && rec.Sequence > since {
			items = append(items, rec)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Sequence == items[j].Sequence {
			return items[i].ID < items[j].ID
		}
		return items[i].Sequence < items[j].Sequence
	})
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	next := since
	if len(items) > 0 {
		next = items[len(items)-1].Sequence
	}
	return items, next, hasMore, nil
}

func localCommandLedger(c CommandEnvelope) (json.RawMessage, bool, error) {
	if c.Action != "bridge.command.get" && c.Action != "bridge.command.list" {
		return nil, false, nil
	}
	scope := commandScope(c)
	p := parseParams(c.Params)
	var result any
	switch c.Action {
	case "bridge.command.get":
		id := strings.TrimSpace(fmt.Sprint(p["id"]))
		if !safeID.MatchString(id) {
			return nil, true, errors.New("bridge.command.get requires valid id")
		}
		rec, err := readCommandRecord(scope, id)
		if err != nil {
			return nil, true, err
		}
		result = map[string]any{"ok": true, "schema": commandLedgerSchema, "command": rec}
	case "bridge.command.list":
		since := int64(0)
		if raw, ok := p["since_sequence"]; ok {
			n, err := strconv.ParseInt(strings.Split(fmt.Sprint(raw), ".")[0], 10, 64)
			if err != nil || n < 0 {
				return nil, true, errors.New("since_sequence must be a non-negative integer")
			}
			since = n
		}
		limit := intParam(p, "limit", 50)
		items, next, more, err := listCommandRecords(scope, since, limit)
		if err != nil {
			return nil, true, err
		}
		result = map[string]any{"ok": true, "schema": commandLedgerSchema, "conversation_key": scope, "commands": items, "since_sequence": since, "next_sequence": next, "has_more": more}
	}
	b, err := json.Marshal(result)
	return b, true, err
}
