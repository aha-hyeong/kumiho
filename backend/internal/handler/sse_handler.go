package handler

import (
	"bufio"
	"fmt"
	"log"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/sse"
	"github.com/gofiber/fiber/v2"
)

type SSEHandler struct {
	hub *sse.Hub
}

func NewSSEHandler(hub *sse.Hub) *SSEHandler {
	return &SSEHandler{hub: hub}
}

// Handle HTTP 연결을 SSE 스트림으로 유지
func (h *SSEHandler) Handle(c *fiber.Ctx) error {
	userID, _ := c.Locals("userID").(string)
	sessionID, _ := c.Locals("sessionID").(string)

	if userID == "" {
		return c.SendStatus(fiber.StatusUnauthorized)
	}

	deviceID, _ := c.Locals("deviceID").(string)
	deviceName, _ := c.Locals("deviceName").(string)

	// deviceID가 없으면 Unknown으로 처리
	if deviceID == "" {
		deviceID = "unknown"
	}
	if deviceName == "" {
		deviceName = "Unknown Device"
	}

	role, _ := c.Locals("role").(string)
	source := c.Query("source")

	client := sse.NewClient(h.hub, userID, sessionID, deviceID, deviceName, role, source)
	h.hub.Register(client)

	log.Printf("[SSE HANDLER] New connection: user=%s, session=%s, device=%s, source=%s", userID, sessionID, deviceID, source)

	// 뷰어 진입 시 다른 기기의 SSE 접속 세션 강제 종료 트리거
	h.hub.ForceLogoutOtherViewerSessions(client)

	// Context 설정
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		// 연결 해제 시 hub에서 unregister
		defer h.hub.Unregister(client)

		// 초기 연결 완료 메시지 전송
		initMsg, _ := sse.FormatSSEMessage("CONNECTED", map[string]string{"message": "SSE connection established"})
		fmt.Fprintf(w, "%s", initMsg)
		err := w.Flush()
		if err != nil {
			return
		}

		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case msg, ok := <-client.Message:
				if !ok {
					return
				}
				fmt.Fprintf(w, "%s", msg)
				if err := w.Flush(); err != nil {
					// 클라이언트 연결 끊김 (브라우저 종료 등)
					log.Printf("[SSE HANDLER] Connection closed. err: %v", err)
					return
				}
			case <-ticker.C:
				// 프록시 타임아웃 방지용 Ping(주석 형식) 전송
				fmt.Fprintf(w, ": keepalive\n\n")
				if err := w.Flush(); err != nil {
					log.Printf("[SSE HANDLER] Connection closed during keepalive. err: %v", err)
					return
				}
			}
		}
	})

	return nil
}
