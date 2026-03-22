package httpx

import (
	"encoding/json"
	"io"
	"net/http"
)

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	raw, _ := json.Marshal(payload)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func ReadBody(r *http.Request, limit int64) ([]byte, error) {
	if limit <= 0 {
		return io.ReadAll(r.Body)
	}
	reader := io.LimitReader(r.Body, limit)
	return io.ReadAll(reader)
}

func ReadJSON[T any](r *http.Request, limit int64, target *T) error {
	body, err := ReadBody(r, limit)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, target)
}

func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]any{"error": message})
}
