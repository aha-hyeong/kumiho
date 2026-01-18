package repository

import (
	"database/sql"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/google/uuid"
)

type UserRepository struct{}

func NewUserRepository() *UserRepository {
	return &UserRepository{}
}

// Create 새 사용자 생성
func (r *UserRepository) Create(user *model.User) error {
	user.ID = uuid.New().String()
	now := time.Now()
	user.CreatedAt = now
	user.UpdatedAt = now

	_, err := database.DB.Exec(
		`INSERT INTO users (id, username, email, password_hash, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		user.ID, user.Username, user.Email, user.PasswordHash, user.Role, user.CreatedAt, user.UpdatedAt,
	)
	return err
}

// FindByEmail 이메일로 사용자 조회
func (r *UserRepository) FindByEmail(email string) (*model.User, error) {
	user := &model.User{}
	err := database.DB.QueryRow(
		`SELECT id, username, email, password_hash, role, created_at, updated_at
		 FROM users WHERE email = ?`,
		email,
	).Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Role, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

// FindByID ID로 사용자 조회
func (r *UserRepository) FindByID(id string) (*model.User, error) {
	user := &model.User{}
	err := database.DB.QueryRow(
		`SELECT id, username, email, password_hash, role, created_at, updated_at
		 FROM users WHERE id = ?`,
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Role, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

// Count 전체 사용자 수 조회
func (r *UserRepository) Count() (int, error) {
	var count int
	err := database.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

// FindAll 모든 사용자 조회 (관리자용)
func (r *UserRepository) FindAll() ([]model.User, error) {
	rows, err := database.DB.Query(
		`SELECT id, username, email, password_hash, role, created_at, updated_at FROM users ORDER BY created_at`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var user model.User
		if err := rows.Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.Role, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, nil
}

// Delete 사용자 삭제
func (r *UserRepository) Delete(id string) error {
	_, err := database.DB.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// Update 사용자 정보 수정
func (r *UserRepository) Update(user *model.User) error {
	user.UpdatedAt = time.Now()
	_, err := database.DB.Exec(
		`UPDATE users SET username = ?, email = ?, password_hash = ?, role = ?, updated_at = ? WHERE id = ?`,
		user.Username, user.Email, user.PasswordHash, user.Role, user.UpdatedAt, user.ID,
	)
	return err
}

// UpdateUsername 사용자 이름(닉네임)만 수정
func (r *UserRepository) UpdateUsername(id, username string) error {
	_, err := database.DB.Exec(
		`UPDATE users SET username = ?, updated_at = ? WHERE id = ?`,
		username, time.Now(), id,
	)
	return err
}
