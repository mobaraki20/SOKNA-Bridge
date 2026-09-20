package main

import "sync"

type StatusStore struct {
	mu sync.RWMutex
	v AgentStatus
}

func (s *StatusStore) Snapshot() AgentStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.v
}

func (s *StatusStore) Update(fn func(*AgentStatus)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.v)
}
