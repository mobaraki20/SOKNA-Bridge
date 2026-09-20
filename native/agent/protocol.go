package main

type EventPriority string
const (
	PriorityTelemetry EventPriority = "telemetry"
	PriorityNormal EventPriority = "normal"
	PriorityActionable EventPriority = "actionable"
	PriorityBlocking EventPriority = "blocking"
	PriorityHuman EventPriority = "human_required"
)

type ChatState string
const (
	ChatIdle ChatState = "idle"
	ChatGenerating ChatState = "assistant_generating"
	ChatCommandPending ChatState = "command_pending"
	ChatFlushing ChatState = "event_flushing"
)
