package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type UserSettingRepository interface {
	GetByUser(q database.Queryer, userID string) ([]model.UserSetting, error)
	Update(q database.Queryer, userID, key, value string) error
	GetByKey(q database.Queryer, userID, key string) (*model.UserSetting, error)
}

type userSettingRepository struct{}

func NewUserSettingRepository() UserSettingRepository {
	return &userSettingRepository{}
}

func (r *userSettingRepository) GetByUser(q database.Queryer, userID string) ([]model.UserSetting, error) {
	q = database.GetQueryer(q)
	query := `SELECT user_id, key, value, updated_at FROM user_settings WHERE user_id = ?`
	rows, err := q.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var settings []model.UserSetting
	for rows.Next() {
		var s model.UserSetting
		if err := rows.Scan(&s.UserID, &s.Key, &s.Value, &s.UpdatedAt); err != nil {
			return nil, err
		}
		settings = append(settings, s)
	}
	return settings, nil
}

func (r *userSettingRepository) GetByKey(q database.Queryer, userID, key string) (*model.UserSetting, error) {
	q = database.GetQueryer(q)
	s := &model.UserSetting{}
	query := `SELECT user_id, key, value, updated_at FROM user_settings WHERE user_id = ? AND key = ?`
	err := q.QueryRow(query, userID, key).Scan(&s.UserID, &s.Key, &s.Value, &s.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return s, nil
}

func (r *userSettingRepository) Update(q database.Queryer, userID, key, value string) error {
	q = database.GetQueryer(q)
	query := `
		INSERT INTO user_settings (user_id, key, value, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`
	_, err := q.Exec(query, userID, key, value, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update user setting: %w", err)
	}
	return nil
}
