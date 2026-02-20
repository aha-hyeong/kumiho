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
	forceLogout chan ForceLogoutReq
	mu          sync.RWMutex
}

type ForceLogoutReq struct {
	UserID    string
	SessionID string
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
		forceLogout: make(chan ForceLogoutReq, 256),
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
				// 가급적 viewer를 우선적으로 끊도록 찾음 (없으면 0번째)
				dropIdx := 0
				for i, sc := range sessionClients {
					if sc.Source == "viewer" {
						dropIdx = i
						break
					}
				}
				
				dropClient := sessionClients[dropIdx]
				
				// 락 안에서 슬라이스에서 즉시 제거
				h.clients[client.UserID][client.SessionID] = append(sessionClients[:dropIdx], sessionClients[dropIdx+1:]...)
				
				// 별도 고루틴에서 FORCE_LOGOUT 알림 후 채널 정리
				// (이미 슬라이스에서 제거되었으므로 unregister 불필요, 직접 채널 닫기)
				go func(c *Client) {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[SSE HUB] Recovered from panic in connection limit drop: %v", r)
						}
					}()
					msgBytes, _ := FormatSSEMessage("FORCE_LOGOUT", json.RawMessage(`{"reason": "CONNECTION_LIMIT"}`))
					select {
					case c.Message <- msgBytes:
					default:
					}
					close(c.Message)
				}(dropClient)
				
				log.Printf("[SSE HUB] Connection Limit Exceeded: dropping for session=%s, source=%s", client.SessionID, dropClient.Source)
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
				// 중복 unregister 호출 시 이미 닫힌 채널에 대한 패닉 방어
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[SSE HUB] Recovered from panic closing channel: %v", r)
						}
					}()
					close(client.Message)
				}()
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

		case req := <-h.forceLogout:
			h.mu.RLock()
			if sessions, ok := h.clients[req.UserID]; ok {
				msgBytes, err := FormatSSEMessage("FORCE_LOGOUT", json.RawMessage(`{"reason": "DUPLICATE_LOGIN"}`))
				
				if err == nil {
					log.Printf("[SSE HUB] ForceLogout triggered by: user=%s, session=%s", req.UserID, req.SessionID)

					for sessionID, clients := range sessions {
						// 같은 로그인 세션(기기/모던 브라우저 탭)은 강제 종료 대상에서 제외
						if sessionID == req.SessionID {
							continue
						}

						for _, client := range clients {
							// Source 구분 없이 모두 전송 (프론트엔드에서 useViewerSync 구독 여부로 처리)
							log.Printf("[SSE HUB] Sending targeted FORCE_LOGOUT to session=%s, client=%p", sessionID, client)

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

// ForceLogoutOtherSessions 현재 세션을 제외한 다른 세션 강제 종료 알림 (REST API가 트리거)
func (h *Hub) ForceLogoutOtherSessions(userID, sessionID string) {
	select {
	case h.forceLogout <- ForceLogoutReq{UserID: userID, SessionID: sessionID}:
	default:
		log.Printf("[SSE HUB] forceLogout channel full, skipping for user=%s", userID)
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

// DisconnectSession forcibly unregisters and closes a specific session's SSE connection
func (h *Hub) DisconnectSession(userID, sessionID string) {
	h.mu.RLock()
	var targets []*Client
	if sessions, ok := h.clients[userID]; ok {
		if clients, ok := sessions[sessionID]; ok {
			targets = append(targets, clients...)
		}
	}
	h.mu.RUnlock()

	for _, client := range targets {
		// Non-blocking but fallback to block if necessary. For force disconnects, we should ideally block or run in goroutine.
		// Doing it in a goroutine prevents blocking the caller.
		go func(c *Client) {
			h.unregister <- c
		}(client)
	}
}

// DisconnectOtherSessions forcibly unregisters all sessions for a user except the given one
func (h *Hub) DisconnectOtherSessions(userID, keepSessionID string) {
	h.mu.RLock()
	var targets []*Client
	if sessions, ok := h.clients[userID]; ok {
		for sessionID, clients := range sessions {
			if sessionID != keepSessionID {
				targets = append(targets, clients...)
			}
		}
	}
	h.mu.RUnlock()

	for _, client := range targets {
		go func(c *Client) {
			h.unregister <- c
		}(client)
	}
}

// TriggerUserCount 명시적으로 현재 접속 정보를 바탕으로 전체 브로드캐스트합니다. (새 연결시 즉시 전송용)
func (h *Hub) TriggerUserCount() {
	h.broadcastUserCount()
}
