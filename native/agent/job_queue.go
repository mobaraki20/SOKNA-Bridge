package main

import "errors"

type JobQueue struct {
	ch chan string
}

func NewJobQueue(size int) *JobQueue {
	if size < 1 { size = 32 }
	return &JobQueue{ch: make(chan string, size)}
}

func (q *JobQueue) Enqueue(id string) error {
	if !safeID(id) { return errors.New("invalid job id") }
	select {
	case q.ch <- id:
		return nil
	default:
		return errors.New("job queue full")
	}
}

func (q *JobQueue) Next() <-chan string { return q.ch }
