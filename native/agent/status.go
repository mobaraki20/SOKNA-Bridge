package main

type AgentStatus struct {
	State string `json:"state"`
	CurrentJob string `json:"current_job,omitempty"`
	QueueDepth int `json:"queue_depth"`
	LastEvent string `json:"last_event,omitempty"`
}
