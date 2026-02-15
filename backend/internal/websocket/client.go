package websocket

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gofiber/websocket/v2"
)

const (
	// 허용되는 쓰기 대기 시간
	writeWait = 10 * time.Second
	// 허용되는 퐁(Pong) 대기 시간
	pongWait = 60 * time.Second
	// 핑(Ping) 전송 주기 (pongWait보다 작아야 함)
	pingPeriod = (pongWait * 9) / 10
	// 메시지 최대 크기 (512바이트면 진행도 업데이트에 충분함)
	maxMessageSize = 512
)

type Client struct {
	Hub       *Hub
	Conn      *websocket.Conn
	UserID    string
	SessionID string
	DeviceID   string
	DeviceName string
	Role       string // model.Role is effectively string
	Source     string // "viewer", "system", etc.
	send       chan []byte
}

func NewClient(hub *Hub, conn *websocket.Conn, userID, sessionID, deviceID, deviceName string, role string, source string) *Client {
	return &Client{
		Hub:        hub,
		Conn:       conn,
		UserID:     userID,
		SessionID:  sessionID,
		DeviceID:   deviceID,
		DeviceName: deviceName,
		Role:       role,
		Source:     source,
		send:       make(chan []byte, 256),
	}
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}
		
		// 메시지 수신 시 처리
		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Failed to unmarshal websocket message: %v", err)
			continue
		}

		switch msg.Type {
		case "UPDATE_PROGRESS":
			c.Hub.HandleProgressUpdate(c.UserID, msg.Payload, c.DeviceID, c.DeviceName)
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// 허브가 채널을 닫은 경우
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
