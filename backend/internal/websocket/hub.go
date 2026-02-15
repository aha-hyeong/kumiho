package websocket

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

// Message 웹소켓 메시지 구조체
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Hub 모든 웹소켓 연결을 관리하는 허브
type Hub struct {
	// 클라이언트 관리 (userID -> sessionID -> []Client)
	// 한 세션에서도 여러 탭을 열 수 있으므로 슬라이스로 관리
	clients    map[string]map[string][]*Client
	register   chan *Client
	unregister chan *Client
	broadcast  chan broadcastMessage
	mu         sync.RWMutex

	// 레포지토리
	progressRepo *repository.ReadingProgressRepository
}

type broadcastMessage struct {
	userID    string
	sessionID string
	message   []byte
}

func NewHub(progressRepo *repository.ReadingProgressRepository) *Hub {
	return &Hub{
		clients:      make(map[string]map[string][]*Client),
		register:     make(chan *Client, 256),
		unregister:   make(chan *Client, 256),
		broadcast:    make(chan broadcastMessage, 256),
		progressRepo: progressRepo,
	}
}

func (h *Hub) Register(c *Client) {
	h.register <- c
}

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
			h.clients[client.UserID][client.SessionID] = append(h.clients[client.UserID][client.SessionID], client)
			h.mu.Unlock()
			log.Printf("[WS HUB] Registered: user=%s, session=%s, device=%s", client.UserID, client.SessionID, client.DeviceID)

			// 사용자 수 업데이트 브로드캐스트
			h.broadcastUserCount()

		case client := <-h.unregister:
			h.mu.Lock()
			if sessions, ok := h.clients[client.UserID]; ok {
				if clients, ok := sessions[client.SessionID]; ok {
					for i, c := range clients {
						if c == client {
							h.clients[client.UserID][client.SessionID] = append(clients[:i], clients[i+1:]...)
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
			close(client.send)
			h.mu.Unlock()
			log.Printf("[WS HUB] Unregistered: user=%s, session=%s", client.UserID, client.SessionID)

			// 사용자 수 업데이트 브로드캐스트
			h.broadcastUserCount()

		case msg := <-h.broadcast:
			h.mu.RLock()
			count := 0
			if sessions, ok := h.clients[msg.userID]; ok {
				if clients, ok := sessions[msg.sessionID]; ok {
					for _, client := range clients {
						select {
						case client.send <- msg.message:
							count++
						default:
							// 버퍼가 가득 찬 경우 연결 해제
							// 데드락 방지를 위해 비차단 전송 사용
							select {
							case h.unregister <- client:
							default:
								// unregister 채널도 가득 찼다면 무시 (나중에 ReadPump가 에러나서 unregister될 것)
							}
						}
					}
				}
			}
			h.mu.RUnlock()
			if count > 0 {
				log.Printf("[WS HUB] Broadcast to user=%s, session=%s, clients=%d", msg.userID, msg.sessionID, count)
			}
		}
	}
}

// SendToSession 특정 세션에 메시지 전송
func (h *Hub) SendToSession(userID, sessionID string, msgType string, payload interface{}) {
	data, _ := json.Marshal(Message{Type: msgType, Payload: mustMarshal(payload)})
	h.broadcast <- broadcastMessage{
		userID:    userID,
		sessionID: sessionID,
		message:   data,
	}
}

// HandleProgressUpdate 실시간 진행도 업데이트 처리
func (h *Hub) HandleProgressUpdate(userID string, payload json.RawMessage, deviceID, deviceName string) {
	var req struct {
		SeriesID    string `json:"series_id"`
		ChapterID   string `json:"chapter_id"`
		CurrentPage int    `json:"current_page"`
	}

	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("[WS HUB] Failed to unmarshal progress update: %v", err)
		return
	}


	// Payload 유효성 검증
	if req.SeriesID == "" || req.ChapterID == "" {
		log.Printf("[WS HUB] Invalid progress update payload: series_id or chapter_id is empty")
		return
	}
	if req.CurrentPage < 0 {
		log.Printf("[WS HUB] Invalid progress update payload: current_page is negative")
		return
	}

	progress := &model.ReadingProgress{
		UserID:      userID,
		SeriesID:    req.SeriesID,
		ChapterID:   &req.ChapterID,
		CurrentPage: req.CurrentPage,
		DeviceID:    &deviceID,
		DeviceName:  &deviceName,
	}

	// DB 업데이트
	if err := h.progressRepo.Upsert(nil, progress); err != nil {
		log.Printf("[WS HUB] Failed to upsert progress via WebSocket: %v", err)

		// 클라이언트에게 에러 메시지 전송
		h.notifyProgressUpdateError(userID, req.SeriesID, req.ChapterID, req.CurrentPage, err.Error())
	}
}

// notifyProgressUpdateError 진행도 업데이트 실패를 해당 사용자 세션에 알림
func (h *Hub) notifyProgressUpdateError(userID, seriesID, chapterID string, currentPage int, reason string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	sessions, ok := h.clients[userID]
	if !ok {
		return
	}

	payload := struct {
		SeriesID    string `json:"series_id"`
		ChapterID   string `json:"chapter_id"`
		CurrentPage int    `json:"current_page"`
		Reason      string `json:"reason"`
	}{
		SeriesID:    seriesID,
		ChapterID:   chapterID,
		CurrentPage: currentPage,
		Reason:      reason,
	}

	data, err := json.Marshal(Message{
		Type:    "PROGRESS_UPDATE_ERROR",
		Payload: mustMarshal(payload),
	})
	if err != nil {
		log.Printf("[WS HUB] Failed to marshal progress update error message: %v", err)
		return
	}

	// 모든 세션에 알림 (어떤 탭에서든지 실패를 알 수 있게 함)
	for sessionID := range sessions {
		h.broadcast <- broadcastMessage{
			userID:    userID,
			sessionID: sessionID,
			message:   data,
		}
	}
}

// ForceLogoutOtherViewerSessions 현재 세션을 제외한 다른 뷰어 세션 강제 종료 알림
func (h *Hub) ForceLogoutOtherViewerSessions(currentClient *Client) {
	// 뷰어 연결이 아니면 다른 세션을 종료하지 않음 (예: 대시보드 접근 시 뷰어 종료 방지)
	if currentClient.Source != "viewer" {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	sessions, ok := h.clients[currentClient.UserID]
	if !ok {
		return
	}

	data, _ := json.Marshal(Message{
		Type:    "FORCE_LOGOUT",
		Payload: json.RawMessage(`{"reason": "DUPLICATE_LOGIN"}`),
	})

	log.Printf("[WS HUB] ForceLogout trigger: user=%s, source=%s, currentSession=%s", 
		currentClient.UserID, currentClient.Source, currentClient.SessionID)

	// 사용자의 모든 세션(탭/기기)을 순회하며 다른 뷰어 연결 종료
	for sessionID, clients := range sessions {
		for _, client := range clients {
			// 현재 이 연결(탭)이 아니면서, 소스가 "viewer"이거나 비어있는 경우(Legacy) 종료
			// h.broadcast 대신 client.send에 직접 전송하여 해당 세션의 다른 탭들만 정확히 타겟팅
			if client != currentClient && (client.Source == "viewer" || client.Source == "") {
				log.Printf("[WS HUB] Sending targeted FORCE_LOGOUT to session=%s, source=%s, client=%p", 
					sessionID, client.Source, client)
				
				select {
				case client.send <- data:
					// 성공적으로 전송됨
				default:
					// 채널이 가득 찬 경우 unregister 시도 (WritePump에서 처리되겠지만 명시적으로 처리)
					log.Printf("[WS HUB] client.send full, unregistering client=%p", client)
					select {
					case h.unregister <- client:
					default:
					}
				}
			}
		}
	}
}

func mustMarshal(v interface{}) json.RawMessage {
	if v == nil {
		return nil
	}
	data, _ := json.Marshal(v)
	return data
}

// broadcastUserCount 현재 접속 중인 "고유" 사용자 수(userID 기준)를 모든 클라이언트에게 전송
func (h *Hub) broadcastUserCount() {
	h.mu.RLock()
	// h.clients의 최상위 키는 userID이므로, len(h.clients)는 고유 사용자 수만을 의미합니다(세션/탭 수는 포함되지 않음).
	uniqueUserCount := len(h.clients)
	h.mu.RUnlock()

	payload := struct {
		Count int `json:"count"`
	}{
		Count: uniqueUserCount,
	}

	data, err := json.Marshal(Message{
		Type:    "USER_COUNT",
		Payload: mustMarshal(payload),
	})
	if err != nil {
		log.Printf("[WS HUB] Failed to marshal user count message: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, sessions := range h.clients {
		for _, clients := range sessions {
			for _, client := range clients {
				select {
				case client.send <- data:
				default:
					// 채널이 가득 찬 경우 무시 (중요도가 낮은 메시지이므로)
				}
			}
		}
	}
}
