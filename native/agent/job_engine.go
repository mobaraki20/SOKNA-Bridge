package main

import (
    "errors"
    "time"
)

type JobEngine struct {
    store *JobStore
    queue *JobQueue
}

func NewJobEngine(store *JobStore, queue *JobQueue) *JobEngine {
    return &JobEngine{store: store, queue: queue}
}

func (e *JobEngine) Submit(job *Job) error {
    if job == nil || !safeID(job.ID) {
        return errors.New("invalid job")
    }
    now := time.Now()
    job.Status = JobQueued
    job.CreatedAt = now
    job.UpdatedAt = now
    if err := e.store.Save(job); err != nil {
        return err
    }
    if err := e.store.AppendEvent(Event{
        JobID: job.ID,
        Type: "job.queued",
        Message: "job accepted",
        CreatedAt: now,
    }); err != nil {
        return err
    }
    return e.queue.Enqueue(job.ID)
}
