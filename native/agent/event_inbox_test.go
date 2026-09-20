package main

import "testing"

func TestCanDeliverToChat(t *testing.T) {
	if CanDeliverToChat(ChatGenerating, PriorityBlocking) {
		.tFatal("must not interrupt active assistant turn")
	}
	if CanDeliverToChat(ChatIdle, PriorityTelemetry) {
		t.Fatal("telemetry must stay out of chat")
	}
	if !CanDeliverToChat(ChatIdle, PriorityActionable) {
		t.Fatal("actionable event should deliver when idle")
	}
}

func TestShouldNotifyHuman(t *testing.T) {
	if !ShouldNotifyHuman(PriorityHuman) || !ShouldNotifyHuman(PriorityBlocking) {
		t.Fatal("blocking and human-required events must notify")
	}
}
