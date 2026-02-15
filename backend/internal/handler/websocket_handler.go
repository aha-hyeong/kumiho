package handler

import (
	"log"

	ws "github.com/aha-hyeong/kumiho/backend/internal/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
)

type WebSocketHandler struct {
	hub *ws.Hub
}

func NewWebSocketHandler(hub *ws.Hub) *WebSocketHandler {
	return &WebSocketHandler{hub: hub}
}

// Upgrade HTTP 연결을 웹소켓으로 업그레이드
func (h *WebSocketHandler) Upgrade(c *fiber.Ctx) error {
	// IsWebSocketUpgrade 미들웨어에서 이미 확인됨
	if websocket.IsWebSocketUpgrade(c) {
		return c.Next()
	}
	return fiber.ErrUpgradeRequired
}

// Handle 웹소켓 연결 처리
func (h *WebSocketHandler) Handle(c *fiber.Ctx) error {
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

	return websocket.New(func(conn *websocket.Conn) {
		role, _ := c.Locals("role").(string)
		client := ws.NewClient(h.hub, conn, userID, sessionID, deviceID, deviceName, role)
		
		client.Hub.Register(client)

		log.Printf("[WS HANDLER] New connection: user=%s, session=%s, device=%s", userID, sessionID, deviceID)

		// 뷰어 진입 시 다른 기기의 웹소켓 세션 강제 종료 트리거 전송
		h.hub.ForceLogoutOtherViewerSessions(userID, sessionID)

		// 고루틴으로 읽기/쓰기 루프 시작
		go client.WritePump()
		client.ReadPump()
	})(c)
}
