package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

type cdpMessage struct {
	ID     int             `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    string `json:"data,omitempty"`
	} `json:"error,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
}

type consoleEntry struct {
	Level     string  `json:"level"`
	Text      string  `json:"text"`
	URL       string  `json:"url,omitempty"`
	Timestamp float64 `json:"timestamp,omitempty"`
}
type networkEntry struct {
	URL               string  `json:"url"`
	Method            string  `json:"method,omitempty"`
	Status            int     `json:"status,omitempty"`
	Type              string  `json:"type,omitempty"`
	Failed            bool    `json:"failed,omitempty"`
	ErrorText         string  `json:"error_text,omitempty"`
	BlockedReason     string  `json:"blocked_reason,omitempty"`
	CORSError         string  `json:"cors_error,omitempty"`
	EncodedDataLength float64 `json:"encoded_data_length,omitempty"`
	DurationMS        float64 `json:"duration_ms,omitempty"`
	Slow              bool    `json:"slow,omitempty"`
	startTimestamp    float64
}

type cdpClient struct {
	ws                 *wsConn
	mu                 sync.Mutex
	nextID             int
	sessionID          string
	events             []cdpMessage
	console            []consoleEntry
	requests           map[string]*networkEntry
	loadFired          bool
	lastDocumentStatus int
}

func newCDP(raw string) (*cdpClient, error) {
	w, err := dialWebSocket(raw, 10*time.Second)
	if err != nil {
		return nil, err
	}
	return &cdpClient{ws: w, nextID: 1, requests: map[string]*networkEntry{}}, nil
}
func (c *cdpClient) Close() {
	if c != nil && c.ws != nil {
		_ = c.ws.Close()
	}
}

func (c *cdpClient) send(method string, params any, session bool, timeout time.Duration) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := c.nextID
	c.nextID++
	m := map[string]any{"id": id, "method": method}
	if params != nil {
		m["params"] = params
	}
	if session && c.sessionID != "" {
		m["sessionId"] = c.sessionID
	}
	b, _ := json.Marshal(m)
	c.ws.setDeadline(timeout)
	if err := c.ws.writeText(b); err != nil {
		return nil, err
	}
	for {
		op, p, err := c.ws.readMessage()
		if err != nil {
			return nil, err
		}
		if op != 1 {
			continue
		}
		var msg cdpMessage
		if err := json.Unmarshal(p, &msg); err != nil {
			return nil, err
		}
		if msg.ID == id {
			if msg.Error != nil {
				return nil, fmt.Errorf("CDP %s failed (%d): %s", method, msg.Error.Code, msg.Error.Message)
			}
			return msg.Result, nil
		}
		if msg.Method != "" {
			c.handleEvent(msg)
		}
	}
}

func (c *cdpClient) readUntil(predicate func(cdpMessage) bool, timeout time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		c.ws.setDeadline(time.Until(deadline))
		op, p, err := c.ws.readMessage()
		if err != nil {
			return err
		}
		if op != 1 {
			continue
		}
		var msg cdpMessage
		if err := json.Unmarshal(p, &msg); err != nil {
			return err
		}
		if msg.Method != "" {
			c.handleEvent(msg)
			if predicate(msg) {
				return nil
			}
		}
	}
	return errors.New("CDP event wait timeout")
}

func (c *cdpClient) handleEvent(msg cdpMessage) {
	c.events = append(c.events, msg)
	switch msg.Method {
	case "Page.loadEventFired":
		c.loadFired = true
	case "Runtime.consoleAPICalled":
		var p struct {
			Type string `json:"type"`
			Args []struct {
				Type        string `json:"type"`
				Value       any    `json:"value"`
				Description string `json:"description"`
			} `json:"args"`
			Timestamp float64 `json:"timestamp"`
		}
		if json.Unmarshal(msg.Params, &p) == nil {
			parts := []string{}
			for _, a := range p.Args {
				if a.Value != nil {
					parts = append(parts, fmt.Sprint(a.Value))
				} else if a.Description != "" {
					parts = append(parts, a.Description)
				}
			}
			c.console = append(c.console, consoleEntry{Level: p.Type, Text: redactText(strings.Join(parts, " ")), Timestamp: p.Timestamp})
		}
	case "Runtime.exceptionThrown":
		var p struct {
			Timestamp        float64 `json:"timestamp"`
			ExceptionDetails struct {
				Text      string `json:"text"`
				URL       string `json:"url"`
				Exception *struct {
					Description string `json:"description"`
				} `json:"exception"`
			} `json:"exceptionDetails"`
		}
		if json.Unmarshal(msg.Params, &p) == nil {
			text := p.ExceptionDetails.Text
			if p.ExceptionDetails.Exception != nil && p.ExceptionDetails.Exception.Description != "" {
				text = p.ExceptionDetails.Exception.Description
			}
			c.console = append(c.console, consoleEntry{Level: "error", Text: redactText(text), URL: redactURL(p.ExceptionDetails.URL), Timestamp: p.Timestamp})
		}
	case "Log.entryAdded":
		var p struct {
			Entry struct {
				Source    string  `json:"source"`
				Level     string  `json:"level"`
				Text      string  `json:"text"`
				URL       string  `json:"url"`
				Timestamp float64 `json:"timestamp"`
			} `json:"entry"`
		}
		if json.Unmarshal(msg.Params, &p) == nil {
			c.console = append(c.console, consoleEntry{Level: p.Entry.Level, Text: redactText(p.Entry.Text), URL: redactURL(p.Entry.URL), Timestamp: p.Entry.Timestamp})
		}
	case "Network.requestWillBeSent":
		var p struct {
			RequestID string  `json:"requestId"`
			Type      string  `json:"type"`
			Timestamp float64 `json:"timestamp"`
			Request   struct {
				URL    string `json:"url"`
				Method string `json:"method"`
			} `json:"request"`
		}
		if json.Unmarshal(msg.Params, &p) == nil {
			c.requests[p.RequestID] = &networkEntry{URL: redactURL(p.Request.URL), Method: p.Request.Method, Type: p.Type, startTimestamp: p.Timestamp}
		}
	case "Network.responseReceived":
		var p struct {
			RequestID string `json:"requestId"`
			Type      string `json:"type"`
			Response  struct {
				URL    string  `json:"url"`
				Status float64 `json:"status"`
			} `json:"response"`
		}
		if json.Unmarshal(msg.Params, &p) == nil {
			e := c.requests[p.RequestID]
			if e == nil {
				e = &networkEntry{}
				c.requests[p.RequestID] = e
			}
			e.URL = redactURL(p.Response.URL)
			e.Status = int(p.Response.Status)
			e.Type = p.Type
			if p.Type == "Document" {
				c.lastDocumentStatus = int(p.Response.Status)
			}
		}
	case "Network.loadingFailed":
		var p struct {
			RequestID       string  `json:"requestId"`
			ErrorText       string  `json:"errorText"`
			Canceled        bool    `json:"canceled"`
			Timestamp       float64 `json:"timestamp"`
			BlockedReason   string  `json:"blockedReason"`
			CorsErrorStatus *struct {
				CorsError string `json:"corsError"`
			} `json:"corsErrorStatus"`
		}
		if json.Unmarshal(msg.Params, &p) == nil {
			e := c.requests[p.RequestID]
			if e == nil {
				e = &networkEntry{}
				c.requests[p.RequestID] = e
			}
			if !p.Canceled {
				e.Failed = true
				e.ErrorText = redactText(p.ErrorText)
				e.BlockedReason = redactText(p.BlockedReason)
				if p.CorsErrorStatus != nil {
					e.CORSError = redactText(p.CorsErrorStatus.CorsError)
				}
			}
			if e.startTimestamp > 0 && p.Timestamp >= e.startTimestamp {
				e.DurationMS = (p.Timestamp - e.startTimestamp) * 1000
			}
		}
	case "Network.loadingFinished":
		var p struct {
			RequestID         string  `json:"requestId"`
			EncodedDataLength float64 `json:"encodedDataLength"`
			Timestamp         float64 `json:"timestamp"`
		}
		if json.Unmarshal(msg.Params, &p) == nil {
			if e := c.requests[p.RequestID]; e != nil {
				e.EncodedDataLength = p.EncodedDataLength
				if e.startTimestamp > 0 && p.Timestamp >= e.startTimestamp {
					e.DurationMS = (p.Timestamp - e.startTimestamp) * 1000
				}
			}
		}
	}
}

func (c *cdpClient) createPage() error {
	res, err := c.send("Target.createTarget", map[string]any{"url": "about:blank"}, false, 10*time.Second)
	if err != nil {
		return err
	}
	var cr struct {
		TargetID string `json:"targetId"`
	}
	if err := json.Unmarshal(res, &cr); err != nil || cr.TargetID == "" {
		return errors.New("Target.createTarget returned no targetId")
	}
	res, err = c.send("Target.attachToTarget", map[string]any{"targetId": cr.TargetID, "flatten": true}, false, 10*time.Second)
	if err != nil {
		return err
	}
	var ar struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(res, &ar); err != nil || ar.SessionID == "" {
		return errors.New("Target.attachToTarget returned no sessionId")
	}
	c.sessionID = ar.SessionID
	for _, method := range []string{"Page.enable", "Runtime.enable", "Network.enable", "Log.enable", "DOM.enable", "Accessibility.enable"} {
		if _, err := c.send(method, map[string]any{}, true, 10*time.Second); err != nil {
			return err
		}
	}
	return nil
}

func (c *cdpClient) evaluate(expr string) (any, error) {
	res, err := c.send("Runtime.evaluate", map[string]any{"expression": expr, "returnByValue": true, "awaitPromise": true, "userGesture": true}, true, 20*time.Second)
	if err != nil {
		return nil, err
	}
	var er struct {
		Result struct {
			Type        string `json:"type"`
			Value       any    `json:"value"`
			Description string `json:"description"`
		} `json:"result"`
		ExceptionDetails any `json:"exceptionDetails,omitempty"`
	}
	if err := json.Unmarshal(res, &er); err != nil {
		return nil, err
	}
	if er.ExceptionDetails != nil {
		return nil, fmt.Errorf("runtime evaluation exception: %v", er.ExceptionDetails)
	}
	return er.Result.Value, nil
}

func (c *cdpClient) setViewport(v Viewport) error {
	_, err := c.send("Emulation.setDeviceMetricsOverride", map[string]any{"width": v.Width, "height": v.Height, "deviceScaleFactor": v.DPR, "mobile": v.Width < 768, "screenWidth": v.Width, "screenHeight": v.Height}, true, 10*time.Second)
	return err
}

func (c *cdpClient) navigate(raw string, timeout time.Duration) error {
	c.loadFired = false
	c.lastDocumentStatus = 0
	if _, err := c.send("Page.navigate", map[string]any{"url": raw}, true, timeout); err != nil {
		return err
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		v, err := c.evaluate(`({url:location.href,state:document.readyState})`)
		if err == nil {
			if m, ok := v.(map[string]any); ok {
				u := fmt.Sprint(m["url"])
				st := fmt.Sprint(m["state"])
				if u != "" && u != "about:blank" && (st == "interactive" || st == "complete") {
					return nil
				}
			}
		}
		time.Sleep(75 * time.Millisecond)
	}
	return errors.New("navigation ready-state timeout")
}

func redactURL(raw string) string { return redactURLString(raw) }
