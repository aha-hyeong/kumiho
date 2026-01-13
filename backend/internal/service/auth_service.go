package service

import (
	"errors"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrUserExists       = errors.New("user already exists")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserNotFound     = errors.New("user not found")
)

type AuthService struct {
	userRepo *repository.UserRepository
	config   *config.Config
}

func NewAuthService(userRepo *repository.UserRepository, cfg *config.Config) *AuthService {
	return &AuthService{
		userRepo: userRepo,
		config:   cfg,
	}
}

// RegisterRequest 회원가입 요청
type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginRequest 로그인 요청
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// TokenResponse 토큰 응답
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	User         *model.User `json:"user"`
}

// Register 회원가입
func (s *AuthService) Register(req *RegisterRequest) (*TokenResponse, error) {
	// 이메일 중복 확인
	existing, err := s.userRepo.FindByEmail(req.Email)
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
	count, err := s.userRepo.Count()
	if err != nil {
		return nil, err
	}

	role := model.RoleUser
	if count == 0 {
		role = model.RoleMaster
	}

	user := &model.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: string(hashedPassword),
		Role:         role,
	}

	if err := s.userRepo.Create(user); err != nil {
		return nil, err
	}

	// 토큰 생성
	return s.generateTokens(user)
}

// Login 로그인
func (s *AuthService) Login(req *LoginRequest) (*TokenResponse, error) {
	user, err := s.userRepo.FindByEmail(req.Email)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrInvalidCredentials
	}

	// 비밀번호 확인
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return s.generateTokens(user)
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

	user, err := s.userRepo.FindByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	return s.generateTokens(user)
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

// generateTokens 토큰 생성
func (s *AuthService) generateTokens(user *model.User) (*TokenResponse, error) {
	now := time.Now()

	// Access Token (1시간)
	accessExp := now.Add(time.Hour)
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  user.ID,
		"role": user.Role,
		"type": "access",
		"exp":  accessExp.Unix(),
		"iat":  now.Unix(),
	})

	accessTokenString, err := accessToken.SignedString([]byte(s.config.JWTSecret))
	if err != nil {
		return nil, err
	}

	// Refresh Token (7일)
	refreshExp := now.Add(7 * 24 * time.Hour)
	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  user.ID,
		"type": "refresh",
		"exp":  refreshExp.Unix(),
		"iat":  now.Unix(),
	})

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
	return s.userRepo.FindByID(id)
}

// NeedsSetup 초기 설정이 필요한지 확인 (사용자가 없으면 true)
func (s *AuthService) NeedsSetup() (bool, error) {
	count, err := s.userRepo.Count()
	if err != nil {
		return false, err
	}
	return count == 0, nil
}

// CreateUser 관리자가 새 사용자 생성
func (s *AuthService) CreateUser(username, email, password string, role model.Role) (*model.User, error) {
	// 이메일 중복 확인
	existing, err := s.userRepo.FindByEmail(email)
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
		Email:        email,
		PasswordHash: string(hashedPassword),
		Role:         role,
	}

	if err := s.userRepo.Create(user); err != nil {
		return nil, err
	}

	return user, nil
}

// GetAllUsers 모든 사용자 조회 (관리자용)
func (s *AuthService) GetAllUsers() ([]model.User, error) {
	return s.userRepo.FindAll()
}

// DeleteUser 사용자 삭제 (관리자용)
func (s *AuthService) DeleteUser(id string) error {
	return s.userRepo.Delete(id)
}
