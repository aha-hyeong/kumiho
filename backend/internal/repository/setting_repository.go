package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type SettingRepository interface {
	GetByKey(q database.Queryer, key string) (*model.Setting, error)
	GetAll(q database.Queryer) ([]model.Setting, error)
	Update(q database.Queryer, key, value string) error
}

type settingRepository struct{}

func NewSettingRepository() SettingRepository {
	return &settingRepository{}
}

func (r *settingRepository) GetByKey(q database.Queryer, key string) (*model.Setting, error) {
	q = database.GetQueryer(q)
	setting := &model.Setting{}
	query := `SELECT key, value, updated_at FROM server_settings WHERE key = ?`
	err := q.QueryRow(query, key).Scan(&setting.Key, &setting.Value, &setting.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return setting, nil
}

func (r *settingRepository) GetAll(q database.Queryer) ([]model.Setting, error) {
	q = database.GetQueryer(q)
	query := `SELECT key, value, updated_at FROM server_settings`
	rows, err := q.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var settings []model.Setting
	for rows.Next() {
		var s model.Setting
		if err := rows.Scan(&s.Key, &s.Value, &s.UpdatedAt); err != nil {
			return nil, err
		}
		settings = append(settings, s)
	}
	return settings, nil
}

func (r *settingRepository) Update(q database.Queryer, key, value string) error {
	q = database.GetQueryer(q)
	query := `
		INSERT INTO server_settings (key, value, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`
	_, err := q.Exec(query, key, value, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update setting: %w", err)
	}
	return nil
}
