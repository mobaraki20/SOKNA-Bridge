package main

import "time"

func (w *JobWorker) RunOne(id string) error {
	j, err := w.e.store.Load(id)
	if err != nil { return err }
	h, ok := w.h[j.Kind]
	if !ok { return w.finish(j, "no handler", false) }
	now := time.Now()
	j.Status = JobRunning
	j.StartedAt = &now
	j.UpdatedAt = now
	if err = w.e.store.Save(j); err != nil { return err }
	_ = w.e.store.AppendEvent(Event{JobID:j.ID, Type:"job.started", CreatedAt:now})
	err = h(j)
	if err != nil { return w.finish(j, err.Error(), false) }
	return w.finish(j, "", true)
}
