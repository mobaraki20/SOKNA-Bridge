package main

import (
	"encoding/json"
	"net/http"
)

func statusHandler(store *StatusStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(store.Snapshot())
	}
}
