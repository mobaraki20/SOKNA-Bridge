package main

const (
	MaxChatPayloadBytes = 1200
	MaxChunkBytes       = 768
	MaxCommandRetries   = 2
	AckTimeoutSeconds   = 3
	StallTimeoutSeconds = 30
)

type DeliveryState string

const (
	DeliveryNoAck   DeliveryState = "no_ack"
	DeliveryAcked   DeliveryState = "acked"
	DeliveryRunning DeliveryState = "running"
	DeliveryStalled DeliveryState = "stalled"
	DeliveryDone    DeliveryState = "done"
	DeliveryFailed  DeliveryState = "failed"
)
