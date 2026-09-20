package main

import (
    "fmt"
    "os"
    "path/filepath"
)

type BlobStore struct{ root string }

func NewBlobStore(root string) (*BlobStore, error) {
    if err := os.MkdirAll(root, 0755); err != nil { return nil, err }
    return &BlobStore{root: root}, nil
}

func (s *BlobStore) PutChunk(blobID, chunkID string, data []byte) error {
    if !safeID(blobID) || !safeID(chunkID) { return fmt.Errorf("invalid blob or chunk id") }
    dir := filepath.Join(s.root, blobID)
    if err := os.MkdirAll(dir, 0755); err != nil { return err }
    return os.WriteFile(filepath.Join(dir, chunkID+".part"), data, 0644)
}
