package main

import "time"

func (w *JobWorker) finish(j *Job, msg string, ok bool) error {
	now := time.Now()
	if ok {
		j.Status = JobCompleted
	} else {
		j.Status = JobFailed
		j.LastError = msg
	}
	j.CompletedAt = &now
	j.UpdatedAt = now
	if err := w.e.store.Save(j); err != nil { return err }
	typ := "job.completed"
	if !ok { typ = "job.failed" }
	return w.e.store.AppendEvent(Event{JobID:j.ID, Type:typ, Message:msg, CreatedAt:now})
}
