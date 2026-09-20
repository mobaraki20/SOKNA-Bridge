package main

import (
	"os"
	"path/filepath"
	"sync"
)

type JobStore struct {
	root string
	mu sync.RWMutex
}

func NewJobStore(root string) (*JobStore, error) {
	if err := os.MkdirAll(root, 0755); err != nil { return nil, err }
	return &JobStore{root: root}, nil
}

func (s *JobStore) jobPath(id string) string {
	return filepath.Join(s.root, id, "job.json")
}
