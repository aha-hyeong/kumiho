package service

import (
	"context"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

var (
	ErrUserExists         = errors.New("user already exists")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserNotFound       = errors.New("user not found")
	ErrSessionNotFound    = errors.New("session not found")
)

type AuthService struct {
	userRepo    *repository.UserRepository
	sessionRepo *repository.SessionRepository
	config      *config.Config
}

func NewAuthService(userRepo *repository.UserRepository, sessionRepo *repository.SessionRepository, cfg *config.Config) *AuthService {
	return &AuthService{
		userRepo:    userRepo,
		sessionRepo: sessionRepo,
		config:      cfg,
	}
}

// RegisterRequest 회원가입 요청
type RegisterRequest struct {
	Username string `json:"username"` // 로그인 ID
	Nickname string `json:"nickname"` // 사용자명
	Password string `json:"password"`
}

// LoginRequest 로그인 요청
type LoginRequest struct {
	Username string `json:"username"` // 로그인 ID
	Password string `json:"password"`
}

// LoginContext 로그인 시 기기 정보
type LoginContext struct {
	UserAgent string
	IPAddress string
}

// TokenResponse 토큰 응답
type TokenResponse struct {
	AccessToken  string      `json:"access_token"`
	RefreshToken string      `json:"refresh_token"`
	ExpiresIn    int64       `json:"expires_in"`
	User         *model.User `json:"user"`
}

// Register 회원가입
func (s *AuthService) Register(req *RegisterRequest, ctx *LoginContext) (*TokenResponse, error) {
	// 비밀번호 길이 확인 (8자 이상)
	if len(req.Password) < 8 {
		return nil, errors.New("password must be at least 8 characters")
	}

	tx, err := database.DB.BeginTx(context.Background(), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// ID 중복 확인
	existing, err := s.userRepo.FindByUsername(tx, req.Username)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrUserExists
	}

	// 비밀번호 해시
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	// 첫 번째 사용자는 MASTER
	count, err := s.userRepo.Count(tx)
	if err != nil {
		return nil, err
	}

	role := model.RoleUser
	canDownload := false
	if count == 0 {
		role = model.RoleMaster
		canDownload = true
	}

	user := &model.User{
		Username:     req.Username,
		Nickname:     req.Nickname,
		PasswordHash: string(hashedPassword),
		Role:         role,
		CanDownload:  canDownload,
	}

	err = s.userRepo.Create(tx, user)
	if err != nil {
		return nil, err
	}

	// 토큰 생성 및 세션 기록
	tokens, err := s.generateTokensWithSession(tx, user, ctx)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	// 만료 세션 정리 (트랜잭션 밖에서 부수 효과로)
	_ = s.sessionRepo.DeleteExpired(nil)

	return tokens, nil
}

// Login 로그인
func (s *AuthService) Login(req *LoginRequest, ctx *LoginContext) (*TokenResponse, error) {
	user, err := s.userRepo.FindByUsername(nil, req.Username)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrInvalidCredentials
	}

	// 비밀번호 확인
	if err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	tx, err := database.DB.BeginTx(context.Background(), nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// 토큰 생성 및 세션 기록
	tokens, err := s.generateTokensWithSession(tx, user, ctx)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	// 만료 세션 정리 (트랜잭션 밖에서 부수 효과로)
	_ = s.sessionRepo.DeleteExpired(nil)

	return tokens, nil
}

// RefreshToken 토큰 갱신
func (s *AuthService) RefreshToken(refreshToken string) (*TokenResponse, error) {
	claims, err := s.ValidateToken(refreshToken)
	if err != nil {
		return nil, err
	}

	// refresh 토큰인지 확인
	tokenType, ok := claims["type"].(string)
	if !ok || tokenType != "refresh" {
		return nil, errors.New("invalid refresh token")
	}

	userID, ok := claims["sub"].(string)
	if !ok {
		return nil, errors.New("invalid token claims")
	}

	user, err := s.userRepo.FindByID(nil, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	// 기존 세션 찾기 (토큰 해시로)
	oldHash := repository.HashToken(refreshToken)
	existingSession, _ := s.sessionRepo.FindByTokenHash(nil, oldHash)

	// 세션이 삭제되었으면 갱신 거부
	if existingSession == nil {
		return nil, errors.New("session revoked")
	}

	// 새 토큰 생성 (기존 세션 ID 유지)
	tokens, err := s.generateTokens(user, existingSession.ID)
	if err != nil {
		return nil, err
	}

	// 기존 세션 업데이트 (새 토큰 해시로)
	newHash := repository.HashToken(tokens.RefreshToken)
	_ = s.sessionRepo.UpdateTokenHash(nil, existingSession.ID, newHash)

	return tokens, nil
}

// LogoutByToken 토큰 기반 로그아웃 (해당 세션만 삭제)
func (s *AuthService) LogoutByToken(refreshToken string) {
	if refreshToken == "" {
		return
	}
	hash := repository.HashToken(refreshToken)
	session, err := s.sessionRepo.FindByTokenHash(nil, hash)
	if err != nil || session == nil {
		return
	}
	_ = s.sessionRepo.Delete(nil, session.ID)
}

// ValidateToken 토큰 검증
func (s *AuthService) ValidateToken(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(s.config.JWTSecret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

// IsSessionValid 세션 ID가 유효한지 확인
func (s *AuthService) IsSessionValid(sessionID string) bool {
	if sessionID == "" {
		return true // sid 클레임이 없는 구버전 토큰은 허용
	}
	session, err := s.sessionRepo.FindByID(nil, sessionID)
	return err == nil && session != nil
}

// GetSessionByID 세션 ID로 세션 정보 조회
func (s *AuthService) GetSessionByID(sessionID string) (*model.Session, error) {
	if sessionID == "" {
		return nil, ErrSessionNotFound
	}
	return s.sessionRepo.FindByID(nil, sessionID)
}

// generateTokensWithSession 토큰 생성 + 세션 기록
func (s *AuthService) generateTokensWithSession(q database.Queryer, user *model.User, ctx *LoginContext) (*TokenResponse, error) {
	var sessionID string

	// 세션 생성
	// 로그인마다 고유 세션을 발급해 브라우저/클라이언트 단위 제어를 명확히 한다.
	// (기존 "user+browser+os+ip" 재활용은 브라우저 식별 오차 시 같은 세션으로 합쳐질 수 있음)
	if ctx != nil {
		deviceInfo := ParseUserAgent(ctx.UserAgent)

		session := &model.Session{
			UserID:     user.ID,
			DeviceName: deviceInfo.DeviceName,
			DeviceType: deviceInfo.DeviceType,
			Browser:    deviceInfo.Browser,
			OS:         deviceInfo.OS,
			IPAddress:  ctx.IPAddress,
			ExpiresAt:  time.Now().Add(7 * 24 * time.Hour),
		}
		if err := s.sessionRepo.Create(q, session); err != nil {
			return nil, err
		}
		sessionID = session.ID
	}

	// 세션 ID를 포함한 토큰 생성
	tokens, err := s.generateTokens(user, sessionID)
	if err != nil {
		return nil, err
	}

	// 세션에 refresh token 해시 업데이트
	if sessionID != "" {
		hash := repository.HashToken(tokens.RefreshToken)
		if err := s.sessionRepo.UpdateTokenHash(q, sessionID, hash); err != nil {
			return nil, err
		}
	}

	return tokens, nil
}

// generateTokens 토큰 생성 (sessionID: JWT에 포함할 세션 ID)
func (s *AuthService) generateTokens(user *model.User, sessionID string) (*TokenResponse, error) {
	now := time.Now()

	// Access Token (1시간)
	accessExp := now.Add(time.Hour)
	accessClaims := jwt.MapClaims{
		"sub":  user.ID,
		"role": user.Role,
		"type": "access",
		"exp":  accessExp.Unix(),
		"iat":  now.Unix(),
	}
	if sessionID != "" {
		accessClaims["sid"] = sessionID
	}
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)

	accessTokenString, err := accessToken.SignedString([]byte(s.config.JWTSecret))
	if err != nil {
		return nil, err
	}

	// Refresh Token (7일)
	refreshExp := now.Add(7 * 24 * time.Hour)
	refreshClaims := jwt.MapClaims{
		"sub":  user.ID,
		"type": "refresh",
		"exp":  refreshExp.Unix(),
		"iat":  now.Unix(),
	}
	if sessionID != "" {
		refreshClaims["sid"] = sessionID
	}
	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)

	refreshTokenString, err := refreshToken.SignedString([]byte(s.config.JWTSecret))
	if err != nil {
		return nil, err
	}

	return &TokenResponse{
		AccessToken:  accessTokenString,
		RefreshToken: refreshTokenString,
		ExpiresIn:    int64(time.Hour.Seconds()),
		User:         user,
	}, nil
}

// GetUserByID ID로 사용자 조회
func (s *AuthService) GetUserByID(id string) (*model.User, error) {
	return s.userRepo.FindByID(nil, id)
}

// NeedsSetup 초기 설정이 필요한지 확인 (사용자가 없으면 true)
func (s *AuthService) NeedsSetup() (bool, error) {
	count, err := s.userRepo.Count(nil)
	if err != nil {
		return false, err
	}
	return count == 0, nil
}

// CreateUser 관리자가 새 사용자 생성
func (s *AuthService) CreateUser(username, nickname, password string, role model.Role, canDownload bool, libraryIDs []string) (*model.User, error) {
	// ID 중복 확인
	existing, err := s.userRepo.FindByUsername(nil, username)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrUserExists
	}

	// 비밀번호 해시
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &model.User{
		Username:     username,
		Nickname:     nickname,
		PasswordHash: string(hashedPassword),
		Role:         role,
		CanDownload:  canDownload,
	}

	if err := s.userRepo.Create(nil, user); err != nil {
		return nil, err
	}

	// 라이브러리 권한 설정
	if len(libraryIDs) > 0 {
		if err := s.userRepo.SetUserLibraries(nil, user.ID, libraryIDs); err != nil {
			return nil, err
		}
	}

	return user, nil
}

// GetAllUsers 모든 사용자 조회 (관리자용)
func (s *AuthService) GetAllUsers() ([]model.User, error) {
	return s.userRepo.FindAll(nil)
}

// DeleteUser 사용자 삭제 (관리자용)
func (s *AuthService) DeleteUser(id string) error {
	return s.userRepo.Delete(nil, id)
}

// UpdateUser 사용자 정보 수정 (관리자용)
func (s *AuthService) UpdateUser(id, nickname, password string, role model.Role, canDownload bool) (*model.User, error) {
	user, err := s.GetUserByID(id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	user.Nickname = nickname
	user.Role = role
	user.CanDownload = canDownload

	if password != "" {
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		user.PasswordHash = string(hashedPassword)
	}

	if err := s.userRepo.Update(nil, user); err != nil {
		return nil, err
	}

	return user, nil
}

// UpdateProfile 프로필(닉네임) 수정
func (s *AuthService) UpdateProfile(userID, nickname string) (*model.User, error) {
	user, err := s.GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	user.Nickname = nickname
	if err := s.userRepo.UpdateNickname(nil, userID, nickname); err != nil {
		return nil, err
	}

	return user, nil
}

// ChangePassword 비밀번호 변경
func (s *AuthService) ChangePassword(userID, oldPassword, newPassword string) error {
	user, err := s.GetUserByID(userID)
	if err != nil {
		return err
	}
	if user == nil {
		return ErrUserNotFound
	}

	// 구 비밀번호 확인
	if cErr := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); cErr != nil {
		return ErrInvalidCredentials
	}

	// 새 비밀번호 해시
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	user.PasswordHash = string(hashedPassword)
	return s.userRepo.Update(nil, user)
}

// SetUserLibraries 사용자의 접근 가능 라이브러리 설정 (관리자용)
func (s *AuthService) SetUserLibraries(userID string, libraryIDs []string) error {
	return s.userRepo.SetUserLibraries(nil, userID, libraryIDs)
}

// GetAllowedLibraryIDs 사용자의 접근 가능 라이브러리 ID 목록 조회
func (s *AuthService) GetAllowedLibraryIDs(userID string) ([]string, error) {
	return s.userRepo.GetAllowedLibraryIDs(nil, userID)
}

// IsLibraryAllowed 사용자의 라이브러리 접근 권한 여부 확인
func (s *AuthService) IsLibraryAllowed(userID, libraryID string) (bool, error) {
	// MASTER 권한 확인
	user, err := s.GetUserByID(userID)
	if err != nil {
		return false, err
	}
	if user != nil && user.Role == model.RoleMaster {
		return true, nil
	}

	allowedIDs, err := s.GetAllowedLibraryIDs(userID)
	if err != nil {
		return false, err
	}

	for _, id := range allowedIDs {
		if id == libraryID {
			return true, nil
		}
	}
	return false, nil
}

// === 세션 관리 ===

// GetUserSessions 유저의 활성 세션 목록 조회
func (s *AuthService) GetUserSessions(userID string) ([]model.Session, error) {
	return s.sessionRepo.FindByUserID(nil, userID)
}

// GetAllSessions 모든 활성 세션 조회 (관리자용)
func (s *AuthService) GetAllSessions() ([]model.Session, error) {
	return s.sessionRepo.FindAll(nil)
}

// RevokeSession 특정 세션 삭제
func (s *AuthService) RevokeSession(sessionID, userID string) error {
	session, err := s.sessionRepo.FindByID(nil, sessionID)
	if err != nil {
		return ErrSessionNotFound
	}
	if session.UserID != userID {
		return ErrSessionNotFound
	}
	return s.sessionRepo.Delete(nil, sessionID)
}

// RevokeSessionByAdmin 관리자가 특정 세션을 강제 삭제
func (s *AuthService) RevokeSessionByAdmin(sessionID string) error {
	return s.sessionRepo.Delete(nil, sessionID)
}

// RevokeOtherSessions 현재 세션을 제외한 모든 세션 삭제
func (s *AuthService) RevokeOtherSessions(userID, currentSessionID string) error {
	if currentSessionID == "" {
		return errors.New("current session not identified")
	}
	return s.sessionRepo.DeleteByUserIDExcept(nil, userID, currentSessionID)
}

// UpdateSessionLastActive 세션 마지막 활동 시간 갱신
func (s *AuthService) UpdateSessionLastActive(sessionID string) {
	if err := s.sessionRepo.UpdateLastActive(nil, sessionID); err != nil {
		// 로깅만, 실패해도 요청 차단하지 않음
		_ = err
	}
}

// GetCurrentSessionID 현재 토큰으로 세션 ID 조회
func (s *AuthService) GetCurrentSessionID(refreshToken string) string {
	if refreshToken == "" {
		return ""
	}
	hash := repository.HashToken(refreshToken)
	session, err := s.sessionRepo.FindByTokenHash(nil, hash)
	if err != nil || session == nil {
		return ""
	}
	return session.ID
}

// GetSessionByRefreshToken refresh 토큰으로 세션 조회 (로그아웃 시 SSE 끊기용)
func (s *AuthService) GetSessionByRefreshToken(refreshToken string) (*model.Session, error) {
	if refreshToken == "" {
		return nil, ErrSessionNotFound
	}
	hash := repository.HashToken(refreshToken)
	return s.sessionRepo.FindByTokenHash(nil, hash)
}
