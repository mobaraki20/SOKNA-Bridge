package main

import "time"

type JobStatus string

const (
	RobQueued    JobStatus = "queued"
	RobRunning   JobStatus = "running"
	JobBlocked   JobStatus = "blocked"
	JobCompleted JobStatus = "completed"
	JobFailed    JobStatus = "failed"
	JobCanceled  JobStatus = "canceled"
)

type StageStatus string

const (
	StagePending   StageStatus = "pending"
	StageRunning   StageStatus = "running"
	StageCompleted StageStatus = "completed"
	StageFailed    StageStatus = "failed"
	StageSkipped   StageStatus = "skipped"
)

type JobStage struct {
	ID        string      `json:"id"`
	Title     string      `json:"title"`
	Status    StageStatus `json:"status"`
	StartedAt *time.Time  `json:"started_at,omitempty"`
	EndedAt   *time.Time  `json:"ended_at,omitempty"`
	Message   string      `json:"message,omitempty"`
}

type Job struct {
	ID             string            `json:"id"`
	Title          string            `json:"title"`
	Kind           string            `json:"kind"`
	Status         JobStatus         `json:"status"`
	CurrentStage   string            `json:"current_stage,omitempty"`
	Stages         []JobStage         `json:"stages"`
	Metadata       map[string]string `json:"metadata,omitempty"`
	CreatedAt      time.Time          `json:"created_at"`
	StartedAt      *time.Time         `json:"started_at,omitempty"`
	UpdatedAt      time.Time          `json:"updated_at"`
	CompletedAt    *time.Time         `json:"completed_at,omitempty"`
	LastError      string            `json:"last_error,omitempty"`
	ActionRequired bool              `json:"action_required"`
}

type Event struct {
	Seq        int64          `json:"seq"`
	JobID      string         `json:"job_id,omitempty"`
	Type       string         `json:"type"`
	StageID    string         `json:"stage_id,omitempty"`
	Message   string         `json:"message,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
	CreatedAt time.Time     `json:"created_at"`
}
