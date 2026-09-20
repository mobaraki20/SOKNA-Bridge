package main

import "context"

func (w *JobWorker) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-w.e.queue.Next():
			_ = w.RunOne(id)
		}
	}
}
