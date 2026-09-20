package main

import (
    "encoding/json"
    "errors"
    "os"
    "path/filepath"
)

func (s *JobStore) Save(job *Job) error {
    if job == nil || !safeID(job.ID) { return errors.New("invalid job") }
    b, err := json.MarshalIndent(job, "", "  ")
    if err != nil { return err }
    dir := filepath.Join(s.root, job.ID)
    if err = os.MkdirAll(dir, 0755); err != nil { return err }
    tmp := filepath.Join(dir, "job.json.tmp")
    if err = os.WriteFile(tmp, b, 0644); err != nil { return err }
    return os.Rename(tmp, filepath.Join(dir, "job.json"))
}
