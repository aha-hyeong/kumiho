package repository

import (
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type SessionRepository struct{}

func NewSessionRepository() *SessionRepository {
	return &SessionRepository{}
}

// HashToken 토큰을 SHA-256으로 해시
func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", h)
}

// Create 세션 생성
func (r *SessionRepository) Create(q database.Queryer, session *model.Session) error {
	db := database.GetQueryer(q)

	if session.ID == "" {
		session.ID = uuid.New().String()
	}

	now := time.Now()
	session.CreatedAt = now
	session.LastActiveAt = now

	_, err := db.Exec(`
		INSERT INTO sessions (id, user_id, refresh_token_hash, device_name, device_type, browser, os, ip_address, last_active_at, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, session.ID, session.UserID, session.RefreshTokenHash,
		session.DeviceName, session.DeviceType, session.Browser, session.OS, session.IPAddress,
		session.LastActiveAt, session.CreatedAt, session.ExpiresAt)
	return err
}

// FindByID 세션 조회
func (r *SessionRepository) FindByID(q database.Queryer, id string) (*model.Session, error) {
	db := database.GetQueryer(q)
	var session model.Session
	err := db.QueryRow(`
		SELECT id, user_id, refresh_token_hash, device_name, device_type, browser, os, ip_address, last_active_at, created_at, expires_at
		FROM sessions WHERE id = ? AND expires_at > datetime('now')
	`, id).Scan(
		&session.ID, &session.UserID, &session.RefreshTokenHash,
		&session.DeviceName, &session.DeviceType, &session.Browser, &session.OS, &session.IPAddress,
		&session.LastActiveAt, &session.CreatedAt, &session.ExpiresAt,
	)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// FindByUserID 유저의 활성 세션 목록 조회
func (r *SessionRepository) FindByUserID(q database.Queryer, userID string) ([]model.Session, error) {
	db := database.GetQueryer(q)
	rows, err := db.Query(`
		SELECT id, user_id, refresh_token_hash, device_name, device_type, browser, os, ip_address, last_active_at, created_at, expires_at
		FROM sessions WHERE user_id = ? AND expires_at > datetime('now')
		ORDER BY last_active_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var sessions []model.Session
	for rows.Next() {
		var s model.Session
		if err := rows.Scan(
			&s.ID, &s.UserID, &s.RefreshTokenHash,
			&s.DeviceName, &s.DeviceType, &s.Browser, &s.OS, &s.IPAddress,
			&s.LastActiveAt, &s.CreatedAt, &s.ExpiresAt,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, nil
}

// FindByTokenHash 토큰 해시로 세션 조회
func (r *SessionRepository) FindByTokenHash(q database.Queryer, hash string) (*model.Session, error) {
	db := database.GetQueryer(q)
	var session model.Session
	err := db.QueryRow(`
		SELECT id, user_id, refresh_token_hash, device_name, device_type, browser, os, ip_address, last_active_at, created_at, expires_at
		FROM sessions WHERE refresh_token_hash = ? AND expires_at > datetime('now')
	`, hash).Scan(
		&session.ID, &session.UserID, &session.RefreshTokenHash,
		&session.DeviceName, &session.DeviceType, &session.Browser, &session.OS, &session.IPAddress,
		&session.LastActiveAt, &session.CreatedAt, &session.ExpiresAt,
	)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// FindAll 모든 활성 세션 조회 (관리자용, 유저 정보 포함)
func (r *SessionRepository) FindAll(q database.Queryer) ([]model.Session, error) {
	db := database.GetQueryer(q)
	rows, err := db.Query(`
		SELECT s.id, s.user_id, s.refresh_token_hash, s.device_name, s.device_type, s.browser, s.os, s.ip_address,
		       s.last_active_at, s.created_at, s.expires_at, u.username, u.nickname
		FROM sessions s
		JOIN users u ON s.user_id = u.id
		WHERE s.expires_at > datetime('now')
		ORDER BY s.last_active_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var sessions []model.Session
	for rows.Next() {
		var s model.Session
		if err := rows.Scan(
			&s.ID, &s.UserID, &s.RefreshTokenHash,
			&s.DeviceName, &s.DeviceType, &s.Browser, &s.OS, &s.IPAddress,
			&s.LastActiveAt, &s.CreatedAt, &s.ExpiresAt,
			&s.Username, &s.Nickname,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, nil
}

// UpdateLastActive 마지막 활동 시간 갱신
func (r *SessionRepository) UpdateLastActive(q database.Queryer, id string) error {
	db := database.GetQueryer(q)
	_, err := db.Exec(`UPDATE sessions SET last_active_at = datetime('now') WHERE id = ?`, id)
	return err
}

// UpdateTokenHash 세션의 토큰 해시 갱신 (토큰 리프레시 시)
func (r *SessionRepository) UpdateTokenHash(q database.Queryer, id, newHash string) error {
	db := database.GetQueryer(q)
	_, err := db.Exec(`UPDATE sessions SET refresh_token_hash = ?, last_active_at = datetime('now') WHERE id = ?`, newHash, id)
	return err
}

// Delete 특정 세션 삭제
func (r *SessionRepository) Delete(q database.Queryer, id string) error {
	db := database.GetQueryer(q)
	_, err := db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

// DeleteByUserID 유저의 모든 세션 삭제
func (r *SessionRepository) DeleteByUserID(q database.Queryer, userID string) error {
	db := database.GetQueryer(q)
	_, err := db.Exec(`DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

// DeleteByUserIDExcept 유저의 특정 세션을 제외한 모든 세션 삭제
func (r *SessionRepository) DeleteByUserIDExcept(q database.Queryer, userID, exceptSessionID string) error {
	db := database.GetQueryer(q)
	_, err := db.Exec(`DELETE FROM sessions WHERE user_id = ? AND id != ?`, userID, exceptSessionID)
	return err
}

// DeleteExpired 만료된 세션 정리
func (r *SessionRepository) DeleteExpired(q database.Queryer) error {
	db := database.GetQueryer(q)
	_, err := db.Exec(`DELETE FROM sessions WHERE expires_at <= datetime('now')`)
	return err
}
