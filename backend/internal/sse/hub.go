package sse

import (
	"encoding/json"
	"log"
	"sync"
)

// Hub 모든 SSE 연결을 관리하는 허브
type Hub struct {
	// 클라이언트 관리 (userID -> sessionID -> []Client)
	clients     map[string]map[string][]*Client
	register    chan *Client
	unregister  chan *Client
	broadcast   chan broadcastMessage
	forceLogout chan *Client
	mu          sync.RWMutex
}

type broadcastMessage struct {
	userID    string
	sessionID string
	message   []byte // 이미 SSE 포맷(event/data)으로 변환된 바이트
}

func NewHub() *Hub {
	return &Hub{
		clients:     make(map[string]map[string][]*Client),
		register:    make(chan *Client, 256),
		unregister:  make(chan *Client, 256),
		broadcast:   make(chan broadcastMessage, 256),
		forceLogout: make(chan *Client, 256),
	}
}

func (h *Hub) Register(c *Client) {
	h.register <- c
}

// Unregister disconnects a client
func (h *Hub) Unregister(c *Client) {
	h.unregister <- c
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if _, ok := h.clients[client.UserID]; !ok {
				h.clients[client.UserID] = make(map[string][]*Client)
			}

			// MAX 5 Connections limit per session (to avoid browser 6-connection stalls)
			sessionClients := h.clients[client.UserID][client.SessionID]
			if len(sessionClients) >= 5 {
				// 가장 오래된 첫 번째 연결 끊기 (FIFO)
				oldestClient := sessionClients[0]
				
				// unregister 채널로 보내서 안전하게 해제 및 채널 닫기 수행
				select {
				case h.unregister <- oldestClient:
				default:
				}
				
				log.Printf("[SSE HUB] Connection Limit Exceeded: dropping oldest for session=%s", client.SessionID)
			}

			h.clients[client.UserID][client.SessionID] = append(h.clients[client.UserID][client.SessionID], client)
			h.mu.Unlock()
			log.Printf("[SSE HUB] Registered: user=%s, session=%s, device=%s", client.UserID, client.SessionID, client.DeviceID)

			h.broadcastUserCount()

		case client := <-h.unregister:
			h.mu.Lock()
			removed := false
			if sessions, ok := h.clients[client.UserID]; ok {
				if clients, ok := sessions[client.SessionID]; ok {
					for i, c := range clients {
						if c == client {
							h.clients[client.UserID][client.SessionID] = append(clients[:i], clients[i+1:]...)
							removed = true
							break
						}
					}
					if len(h.clients[client.UserID][client.SessionID]) == 0 {
						delete(h.clients[client.UserID], client.SessionID)
					}
				}
				if len(h.clients[client.UserID]) == 0 {
					delete(h.clients, client.UserID)
				}
			}
			h.mu.Unlock()

			if removed {
				close(client.Message)
				log.Printf("[SSE HUB] Unregistered: user=%s, session=%s", client.UserID, client.SessionID)
			}

			h.broadcastUserCount()

		case msg := <-h.broadcast:
			h.mu.RLock()
			count := 0
			if sessions, ok := h.clients[msg.userID]; ok {
				if clients, ok := sessions[msg.sessionID]; ok {
					for _, client := range clients {
						select {
						case client.Message <- msg.message:
							count++
						default:
							// 메시지 큐가 가득차면 (클라이언트가 너무 느릴 때)
							select {
							case h.unregister <- client:
							default:
							}
						}
					}
				}
			}
			h.mu.RUnlock()
			if count > 0 {
				log.Printf("[SSE HUB] Broadcast to user=%s, session=%s, clients=%d", msg.userID, msg.sessionID, count)
			}

		case triggerClient := <-h.forceLogout:
			h.mu.RLock()
			if sessions, ok := h.clients[triggerClient.UserID]; ok {
				msgBytes, err := FormatSSEMessage("FORCE_LOGOUT", json.RawMessage(`{"reason": "DUPLICATE_LOGIN"}`))
				
				if err == nil {
					log.Printf("[SSE HUB] ForceLogout triggered by: user=%s, session=%s", triggerClient.UserID, triggerClient.SessionID)

					for sessionID, clients := range sessions {
						// 같은 로그인 세션(기기/모던 브라우저 탭)은 강제 종료 대상에서 제외
						if sessionID == triggerClient.SessionID {
							continue
						}

						for _, client := range clients {
							if client.Source == "viewer" {
								log.Printf("[SSE HUB] Sending targeted FORCE_LOGOUT to session=%s, source=%s, client=%p", sessionID, client.Source, client)

								select {
								case client.Message <- msgBytes:
								default:
									select {
									case h.unregister <- client:
									default:
									}
								}
							}
						}
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// SendToSession 특정 세션에 메시지 전송
func (h *Hub) SendToSession(userID, sessionID string, msgType string, payload interface{}) {
	data, err := FormatSSEMessage(msgType, payload)
	if err != nil {
		log.Printf("[SSE HUB] Failed to format msg: %v", err)
		return
	}
	
	h.broadcast <- broadcastMessage{
		userID:    userID,
		sessionID: sessionID,
		message:   data,
	}
}

// ForceLogoutOtherViewerSessions 현재 세션을 제외한 다른 뷰어 세션 강제 종료 알림
func (h *Hub) ForceLogoutOtherViewerSessions(currentClient *Client) {
	if currentClient.Source != "viewer" {
		return
	}
	select {
	case h.forceLogout <- currentClient:
	default:
		log.Printf("[SSE HUB] forceLogout channel full, skipping for user=%s", currentClient.UserID)
	}
}

// broadcastUserCount 현재 접속 중인 고유 사용자 수 전달
func (h *Hub) broadcastUserCount() {
	h.mu.RLock()
	uniqueUserCount := len(h.clients)
	h.mu.RUnlock()

	payload := struct {
		Count int `json:"count"`
	}{Count: uniqueUserCount}

	data, err := FormatSSEMessage("USER_COUNT", payload)
	if err != nil {
		log.Printf("[SSE HUB] Failed to msg: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, sessions := range h.clients {
		for _, clients := range sessions {
			for _, client := range clients {
				select {
				case client.Message <- data:
				default:
				}
			}
		}
	}
}
