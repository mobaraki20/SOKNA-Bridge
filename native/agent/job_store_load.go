package main

import (
	"encoding/json"
	"errors"
	"os"
)

func (s *JobStore) Load(id string) (*Job, error) {
	if !safeID(id) { return nil, errors.New("invalid job id") }
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, err := os.ReadFile(s.jobPath(id))
	if err != nil { return nil, err }
	var job Job
	if err := json.Unmarshal(b, &job); err != nil { return nil, err }
	return &job, nil
}
