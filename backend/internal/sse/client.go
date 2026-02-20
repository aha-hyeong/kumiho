package sse

import (
	"encoding/json"
	"sync"
)

// Client represents an SSE connection
type Client struct {
	Hub        *Hub
	UserID     string
	SessionID  string
	DeviceID   string
	DeviceName string
	Role       string
	Source     string
	Message    chan []byte // 버퍼가 있는 채널로 SSE 스트림에 데이터를 보냄
	closeOnce  sync.Once  // 채널을 안전하게 1회만 닫기 위한 보호
}

// NewClient creates a new SSE client
func NewClient(hub *Hub, userID, sessionID, deviceID, deviceName string, role string, source string) *Client {
	return &Client{
		Hub:        hub,
		UserID:     userID,
		SessionID:  sessionID,
		DeviceID:   deviceID,
		DeviceName: deviceName,
		Role:       role,
		Source:     source,
		Message:    make(chan []byte, 256), // 메세지 버퍼 256
	}
}

// SafeClose 채널을 안전하게 닫습니다 (중복 호출 시 패닉 방지)
func (c *Client) SafeClose() {
	c.closeOnce.Do(func() {
		close(c.Message)
	})
}

// StartSending starts the loop that sends messages to the HTTP ResponseWriter (managed by Fiber)
// Fiber의 SSE 핸들러에서 루프를 돌기 위해 채널만 제공하므로 클라이언트 내부의 고정 루프는 필요치 않습니다.
// 다만 필요시 이 파일에 기타 클라이언트 관련 로직을 정의합니다.

// FormatSSEMessage formats a standard JSON message into the SSE string format
func FormatSSEMessage(eventType string, payload interface{}) ([]byte, error) {
	msgType := eventType
	var payloadBytes []byte

	if payload != nil {
		if pb, ok := payload.([]byte); ok {
			payloadBytes = pb
		} else {
			b, err := json.Marshal(payload)
			if err != nil {
				return nil, err
			}
			payloadBytes = b
		}
	}

	// SSE format:
	// event: TYPE
	// data: {"payload":"..."}
	// \n\n

	result := []byte("event: message\ndata: ")

	// Kumiho WebSocket 규격(Type, Payload를 포함하는 Message Object)을 모방
	type wsMessage struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload,omitempty"`
	}

	finalPayload, err := json.Marshal(wsMessage{
		Type:    msgType,
		Payload: payloadBytes,
	})
	if err != nil {
		return nil, err
	}

	result = append(result, finalPayload...)
	result = append(result, []byte("\n\n")...)

	return result, nil
}
