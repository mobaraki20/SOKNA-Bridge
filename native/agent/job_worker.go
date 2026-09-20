package main

type JobHandler func(*Job) error

type JobWorker struct{
 e *JobEngine
 h map[string]JobHandler
}

func NewJobWorker(e *JobEngine) *JobWorker{
 return &JobWorker{e:e,h:make(map[string]JobHandler)}
}

func(w *JobWorker)Register(kind string,h JobHandler){
 w.h[kind]=h
}
