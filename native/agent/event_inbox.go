package main

type EventEnvelope struct {
	ID        string        `json:"event_id"`
	JobID     string        `json:"job_id,omitempty"`
	CommandID string        `json:"command_id,omitempty"`
	Type      string        `json:"type"`
	Priority  EventPriority `json:"priority"`
	Message   string        `json:"message,omitempty"`
}

func CanDeliverToChat(state ChatState, p EventPriority) bool {
	if state != ChatIdle {
		return false
	}
	return p != PriorityTelemetry
}

func ShouldNotifyHuman(p EventPriority) bool {
	return p == PriorityBlocking || p == PriorityHuman
}
