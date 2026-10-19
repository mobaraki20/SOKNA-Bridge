package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const commandLedgerSchema = "sokna-command-ledger-v1"
const systemConversationKey = "bridge:system"

// Serialize in-process ledger decisions; immutable files arbitrate across processes.
var ledgerMu sync.Mutex
var ledgerIncarnation = newLedgerIncarnation()

func newLedgerIncarnation() string {
    b := make([]byte,16)
    if _,err:=rand.Read(b);err!=nil {panic("secure ledger identity unavailable: "+err.Error())}
    return hex.EncodeToString(b)
}
func externalTokenHash(token string) string {
    if token=="" {return ""}
    s:=sha256.Sum256([]byte(token))
    return hex.EncodeToString(s[:])
}

type commandLedgerRecord struct {
	Schema          string          `json:"schema"`
	ConversationKey string          `json:"conversation_key"`
	ID              string          `json:"id"`
	Action          string          `json:"action"`
	ParamsSHA256    string          `json:"params_sha256"`
	State           string          `json:"state"`
	Sequence        int64           `json:"sequence"`
    HostIncarnation string          `json:"host_incarnation,omitempty"`
    ExternalTokenSHA256 string      `json:"external_token_sha256,omitempty"`
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
    if err != nil { return err }
    if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil { return err }
    b, err := json.MarshalIndent(rec, "", "  ")
    if err != nil { return err }
    // Rename can overwrite an existing record. Hard-link the fully-synced
    // temp file to atomically claim an immutable phase on local NTFS/ext4.
    tmp, err := os.CreateTemp(filepath.Dir(p), ".phase-*")
    if err != nil { return err }
    name := tmp.Name()
    defer os.Remove(name)
    if err := tmp.Chmod(0o600); err != nil { tmp.Close(); return err }
    _, writeErr := tmp.Write(b)
    if writeErr == nil { writeErr = tmp.Sync() }
    closeErr := tmp.Close()
    if writeErr != nil { return writeErr }
    if closeErr != nil { return closeErr }
    if err := os.Link(name, p); err != nil {
        if _, statErr := os.Stat(p); statErr == nil { return os.ErrExist }
        return fmt.Errorf("immutable ledger creation requires local hard-link capable storage: %w", err)
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
    return beginCommandRecordWithToken(c,"")
}
func beginCommandRecordWithToken(c CommandEnvelope, token string) (commandLedgerRecord, bool, error) {
    ledgerMu.Lock()
    defer ledgerMu.Unlock()
    scope := commandScope(c)
    existing, err := readCommandRecord(scope, c.ID)
    if err == nil {
        if existing.Action != c.Action || existing.ParamsSHA256 != commandParamsHash(c) {
            return existing, true, errors.New("COMMAND_ID_CONFLICT: existing command id has different action or params")
        }
        // A second Native Host can receive the same command while the first
        // is still running. Do not convert it to outcome_unknown or execute twice.
        return existing, true, nil
    }
    if !errors.Is(err, os.ErrNotExist) { return commandLedgerRecord{}, false, err }
    now := time.Now().UTC()
    rec := commandLedgerRecord{Schema: commandLedgerSchema,
        ConversationKey: scope, ID: c.ID, Action: c.Action,
        ParamsSHA256: commandParamsHash(c), State: "accepted",
        Sequence: now.UnixNano(), AcceptedAt: now.UnixMilli(),
        HostIncarnation:ledgerIncarnation,ExternalTokenSHA256:externalTokenHash(token)}
    if err := writeImmutableCommandPhase(rec, "accepted"); err != nil {
        if errors.Is(err, os.ErrExist) {
            existing, readErr := readCommandRecord(scope, c.ID)
            if readErr != nil { return commandLedgerRecord{}, true, readErr }
            if existing.Action != c.Action || existing.ParamsSHA256 != rec.ParamsSHA256 {
                return existing, true, errors.New("COMMAND_ID_CONFLICT: competing command used different payload")
            }
            return existing, true, nil
        }
        return commandLedgerRecord{}, false, err
    }
    return rec, false, nil
}

func markCommandRunning(c CommandEnvelope) error {
	ledgerMu.Lock()
	defer ledgerMu.Unlock()
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
    return completeCommandRecordAuthorized(c,result,"")
}
func completeCommandRecordAuthorized(c CommandEnvelope, result json.RawMessage, token string) error {
    ledgerMu.Lock()
	defer ledgerMu.Unlock()
	if !json.Valid(result) { return errors.New("COMMAND_INVALID_RESULT_JSON") }
	if len(result)>8*1024*1024 { return errors.New("COMMAND_RESULT_TOO_LARGE") }
	scope := commandScope(c)
	rec, err := readCommandRecord(scope, c.ID)
	if err != nil {
		return err
	}
	if err:=ensureLedgerOwnerAndCommand(c,rec,token);err!=nil {return err}
	if rec.State == "succeeded" {
		if bytes.Equal(rec.Result,result) { return nil }
		return errors.New("COMMAND_TERMINAL_RESULT_CONFLICT")
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
    return failCommandRecordAuthorized(c,cause,"")
}
func failCommandRecordAuthorized(c CommandEnvelope, cause error, token string) error {
    ledgerMu.Lock()
	defer ledgerMu.Unlock()
	scope := commandScope(c)
	rec, err := readCommandRecord(scope, c.ID)
	if err != nil {
		return err
	}
	if err:=ensureLedgerOwnerAndCommand(c,rec,token);err!=nil {return err}
	if rec.State == "failed" {
		if rec.Error == trimError(cause) { return nil }
		return errors.New("COMMAND_TERMINAL_RESULT_CONFLICT")
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

func ensureLedgerOwnerAndCommand(c CommandEnvelope, rec commandLedgerRecord, token string) error {
    if rec.Action!=c.Action || rec.ParamsSHA256!=commandParamsHash(c) {
        return errors.New("COMMAND_ID_CONFLICT: ledger command payload differs")
    }
    if rec.ExternalTokenSHA256!="" {
        h:=externalTokenHash(token)
        if len(h)!=64 || subtle.ConstantTimeCompare([]byte(h),[]byte(rec.ExternalTokenSHA256))!=1 {
            return errors.New("COMMAND_EXTERNAL_COMPLETION_TOKEN_INVALID")
        }
        return nil
    }
    if token!="" {return errors.New("COMMAND_UNEXPECTED_EXTERNAL_TOKEN")}
    if rec.HostIncarnation!=ledgerIncarnation {
        return errors.New("COMMAND_OUTCOME_UNKNOWN: a different host incarnation owns this command")
    }
    return nil
}

func replayCommandRecord(rec commandLedgerRecord, requestID string) OutMsg {
	switch rec.State {
	case "succeeded":
		return OutMsg{OK: true, Type: "agent.result", RequestID: requestID, Version: version, Result: rec.Result}
	case "failed":
		return OutMsg{OK: false, RequestID: requestID, Version: version, Error: "COMMAND_REPLAY_FAILED: " + rec.Error}
	case "running", "accepted":
		if rec.AcceptedAt>0 && time.Now().UTC().UnixMilli()-rec.AcceptedAt>int64((30*time.Minute)/time.Millisecond) { return OutMsg{OK:false,RequestID:requestID,Version:version,Error:"COMMAND_REQUIRES_RECONCILIATION: no terminal evidence; never replay automatically"} }
		return OutMsg{OK:false,RequestID:requestID,Version:version,Error:"COMMAND_STILL_PENDING: original invocation may still be running; do not retry automatically"}
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

func externalLedgerPayload(rec commandLedgerRecord, duplicate bool) json.RawMessage {
    return externalLedgerPayloadWithToken(rec,duplicate,"")
}
func externalLedgerPayloadWithToken(rec commandLedgerRecord, duplicate bool, token string) json.RawMessage {
    payload := map[string]any{
		"ok": true, "schema": commandLedgerSchema, "duplicate": duplicate,
		"id": rec.ID, "conversation_key": rec.ConversationKey, "state": rec.State,
	}
    if token!="" {payload["completion_token"]=token}
	if len(rec.Result) > 0 {
		payload["result"] = rec.Result
	}
	if rec.Error != "" {
		payload["error"] = rec.Error
	}
	b, _ := json.Marshal(payload)
	return b
}

func markCommandRunningExternal(c CommandEnvelope, token string) error {
    ledgerMu.Lock();defer ledgerMu.Unlock()
    rec,err:=readCommandRecord(commandScope(c),c.ID)
    if err!=nil {return err}
    if err:=ensureLedgerOwnerAndCommand(c,rec,token);err!=nil{return err}
    if rec.State!="accepted"&&rec.State!="running" {return errors.New("COMMAND_ALREADY_TERMINAL")}
    rec.State="running"
    err=writeImmutableCommandPhase(rec,"running")
    if errors.Is(err,os.ErrExist) {return nil}
    return err
}
func handleExternalLedgerBegin(m InMsg) OutMsg {
	c, err := parseCommand(m.Command)
	if err != nil {
		return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}
	}
	completionToken:=newLedgerIncarnation()
    rec, duplicate, err := beginCommandRecordWithToken(c,completionToken)
	if err != nil {
		return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}
	}
	if !duplicate {
		if err := markCommandRunningExternal(c,completionToken); err != nil {
            return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:"COMMAND_LEDGER_RUNNING_FAILED: "+err.Error()}
        }
		rec, _ = readCommandRecord(commandScope(c), c.ID)
	}
	return OutMsg{OK:true,Type:"ledger.external",RequestID:m.RequestID,Version:version,Result:externalLedgerPayloadWithToken(rec,duplicate,func() string {if duplicate {return ""};return completionToken}())}
}

func handleExternalLedgerComplete(m InMsg) OutMsg {
	c, err := parseCommand(m.Command)
	if err != nil {
		return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}
	}
	if len(m.Result)==0 {
        return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:"COMMAND_EXTERNAL_RESULT_REQUIRED: no automatic success"}
    }
    if err := completeCommandRecordAuthorized(c,m.Result,m.CompletionToken); err != nil {
		return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}
	}
	rec, err := readCommandRecord(commandScope(c),c.ID)
	if err != nil {
		return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}
	}
	return OutMsg{OK:true,Type:"ledger.external",RequestID:m.RequestID,Version:version,Result:externalLedgerPayload(rec,false)}
}

func handleExternalLedgerFail(m InMsg) OutMsg {
	c, err := parseCommand(m.Command)
	if err != nil {
		return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}
	}
	cause := errors.New(strings.TrimSpace(m.Error))
	if strings.TrimSpace(m.Error)=="" {
		cause = errors.New("extension action failed")
	}
	if err := failCommandRecordAuthorized(c,cause,m.CompletionToken); err != nil {
		return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}
	}
	rec, err := readCommandRecord(commandScope(c),c.ID)
	if err != nil {
		return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}
	}
	return OutMsg{OK:true,Type:"ledger.external",RequestID:m.RequestID,Version:version,Result:externalLedgerPayload(rec,false)}
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
