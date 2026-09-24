package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type wsConn struct {
	c net.Conn
	r *bufio.Reader
}

func dialWebSocket(raw string, timeout time.Duration) (*wsConn, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return nil, errors.New("websocket scheme must be ws/wss")
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		if u.Scheme == "wss" {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	d := net.Dialer{Timeout: timeout}
	var c net.Conn
	if u.Scheme == "wss" {
		c, err = tls.DialWithDialer(&d, "tcp", host, &tls.Config{ServerName: u.Hostname(), MinVersion: tls.VersionTLS12})
	} else {
		c, err = d.Dial("tcp", host)
	}
	if err != nil {
		return nil, err
	}
	keyRaw := make([]byte, 16)
	if _, err := rand.Read(keyRaw); err != nil {
		c.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyRaw)
	path := u.RequestURI()
	if path == "" {
		path = "/"
	}
	req := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", path, u.Host, key)
	if _, err := io.WriteString(c, req); err != nil {
		c.Close()
		return nil, err
	}
	br := bufio.NewReader(c)
	resp, err := http.ReadResponse(br, &http.Request{Method: "GET"})
	if err != nil {
		c.Close()
		return nil, err
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		c.Close()
		return nil, fmt.Errorf("websocket upgrade failed: %s", resp.Status)
	}
	accept := resp.Header.Get("Sec-WebSocket-Accept")
	h := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	expected := base64.StdEncoding.EncodeToString(h[:])
	if accept != expected {
		c.Close()
		return nil, errors.New("websocket accept mismatch")
	}
	return &wsConn{c: c, r: br}, nil
}

func (w *wsConn) Close() error {
	if w == nil || w.c == nil {
		return nil
	}
	return w.c.Close()
}
func (w *wsConn) setDeadline(d time.Duration) { _ = w.c.SetDeadline(time.Now().Add(d)) }

func (w *wsConn) writeText(b []byte) error { return w.writeFrame(0x1, b) }
func (w *wsConn) writePong(b []byte) error { return w.writeFrame(0xA, b) }
func (w *wsConn) writeFrame(op byte, payload []byte) error {
	if len(payload) > 64<<20 {
		return errors.New("websocket payload too large")
	}
	head := []byte{0x80 | op}
	n := len(payload)
	switch {
	case n < 126:
		head = append(head, byte(0x80|n))
	case n <= 65535:
		head = append(head, 0x80|126, byte(n>>8), byte(n))
	default:
		head = append(head, 0x80|127)
		tmp := make([]byte, 8)
		binary.BigEndian.PutUint64(tmp, uint64(n))
		head = append(head, tmp...)
	}
	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}
	head = append(head, mask...)
	out := make([]byte, n)
	for i := range payload {
		out[i] = payload[i] ^ mask[i%4]
	}
	if _, err := w.c.Write(head); err != nil {
		return err
	}
	_, err := w.c.Write(out)
	return err
}

func (w *wsConn) readMessage() (byte, []byte, error) {
	var opcode byte
	var all []byte
	for {
		h := make([]byte, 2)
		if _, err := io.ReadFull(w.r, h); err != nil {
			return 0, nil, err
		}
		fin := h[0]&0x80 != 0
		op := h[0] & 0x0f
		masked := h[1]&0x80 != 0
		n := uint64(h[1] & 0x7f)
		if n == 126 {
			b := make([]byte, 2)
			if _, err := io.ReadFull(w.r, b); err != nil {
				return 0, nil, err
			}
			n = uint64(binary.BigEndian.Uint16(b))
		} else if n == 127 {
			b := make([]byte, 8)
			if _, err := io.ReadFull(w.r, b); err != nil {
				return 0, nil, err
			}
			n = binary.BigEndian.Uint64(b)
		}
		if n > 64<<20 {
			return 0, nil, errors.New("websocket frame too large")
		}
		var mask []byte
		if masked {
			mask = make([]byte, 4)
			if _, err := io.ReadFull(w.r, mask); err != nil {
				return 0, nil, err
			}
		}
		p := make([]byte, int(n))
		if _, err := io.ReadFull(w.r, p); err != nil {
			return 0, nil, err
		}
		if masked {
			for i := range p {
				p[i] ^= mask[i%4]
			}
		}
		if op == 0x8 {
			return 0, nil, io.EOF
		}
		if op == 0x9 {
			_ = w.writePong(p)
			continue
		}
		if op == 0xA {
			continue
		}
		if op != 0 {
			opcode = op
		}
		all = append(all, p...)
		if fin {
			return opcode, all, nil
		}
	}
}
