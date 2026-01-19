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
func (r *UserRepository) Create(q database.Queryer, user *model.User) error {
	q = database.GetQueryer(q)
	user.ID = uuid.New().String()
	now := time.Now()
	user.CreatedAt = now
	user.UpdatedAt = now

	_, err := q.Exec(
		`INSERT INTO users (id, username, email, password_hash, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		user.ID, user.Username, user.Email, user.PasswordHash, user.Role, user.CreatedAt, user.UpdatedAt,
	)
	return err
}

// FindByEmail 이메일로 사용자 조회
func (r *UserRepository) FindByEmail(q database.Queryer, email string) (*model.User, error) {
	q = database.GetQueryer(q)
	user := &model.User{}
	err := q.QueryRow(
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
func (r *UserRepository) FindByID(q database.Queryer, id string) (*model.User, error) {
	q = database.GetQueryer(q)
	user := &model.User{}
	err := q.QueryRow(
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
func (r *UserRepository) Count(q database.Queryer) (int, error) {
	q = database.GetQueryer(q)
	var count int
	err := q.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

// FindAll 모든 사용자 조회 (관리자용)
func (r *UserRepository) FindAll(q database.Queryer) ([]model.User, error) {
	q = database.GetQueryer(q)
	rows, err := q.Query(
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
func (r *UserRepository) Delete(q database.Queryer, id string) error {
	q = database.GetQueryer(q)
	_, err := q.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// Update 사용자 정보 수정
func (r *UserRepository) Update(q database.Queryer, user *model.User) error {
	q = database.GetQueryer(q)
	user.UpdatedAt = time.Now()
	_, err := q.Exec(
		`UPDATE users SET username = ?, email = ?, password_hash = ?, role = ?, updated_at = ? WHERE id = ?`,
		user.Username, user.Email, user.PasswordHash, user.Role, user.UpdatedAt, user.ID,
	)
	return err
}

// UpdateUsername 사용자 이름(닉네임)만 수정
func (r *UserRepository) UpdateUsername(q database.Queryer, id, username string) error {
	q = database.GetQueryer(q)
	_, err := q.Exec(
		`UPDATE users SET username = ?, updated_at = ? WHERE id = ?`,
		username, time.Now(), id,
	)
	return err
}
