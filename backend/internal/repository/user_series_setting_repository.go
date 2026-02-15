package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type UserSeriesSettingRepository interface {
	Get(q database.Queryer, userID, seriesID string) (*model.UserSeriesSetting, error)
	Upsert(q database.Queryer, setting *model.UserSeriesSetting) error
}

type userSeriesSettingRepository struct{}

func NewUserSeriesSettingRepository() UserSeriesSettingRepository {
	return &userSeriesSettingRepository{}
}

func (r *userSeriesSettingRepository) Get(q database.Queryer, userID, seriesID string) (*model.UserSeriesSetting, error) {
	q = database.GetQueryer(q)
	s := &model.UserSeriesSetting{}
	query := `
		SELECT user_id, series_id, reading_mode, reading_direction, swipe_direction, click_direction, 
		       keyboard_direction, fit_mode, background_color, updated_at 
		FROM user_series_settings 
		WHERE user_id = ? AND series_id = ?
	`
	err := q.QueryRow(query, userID, seriesID).Scan(
		&s.UserID, &s.SeriesID, &s.ReadingMode, &s.ReadingDirection, &s.SwipeDirection, &s.ClickDirection,
		&s.KeyboardDirection, &s.FitMode, &s.BackgroundColor, &s.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return s, nil
}

func (r *userSeriesSettingRepository) Upsert(q database.Queryer, s *model.UserSeriesSetting) error {
	q = database.GetQueryer(q)
	query := `
		INSERT INTO user_series_settings (
			user_id, series_id, reading_mode, reading_direction, swipe_direction, click_direction, 
			keyboard_direction, fit_mode, background_color, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, series_id) DO UPDATE SET
			reading_mode = COALESCE(excluded.reading_mode, user_series_settings.reading_mode),
			reading_direction = COALESCE(excluded.reading_direction, user_series_settings.reading_direction),
			swipe_direction = COALESCE(excluded.swipe_direction, user_series_settings.swipe_direction),
			click_direction = COALESCE(excluded.click_direction, user_series_settings.click_direction),
			keyboard_direction = COALESCE(excluded.keyboard_direction, user_series_settings.keyboard_direction),
			fit_mode = COALESCE(excluded.fit_mode, user_series_settings.fit_mode),
			background_color = COALESCE(excluded.background_color, user_series_settings.background_color),
			updated_at = excluded.updated_at
	`
	_, err := q.Exec(query,
		s.UserID, s.SeriesID, s.ReadingMode, s.ReadingDirection, s.SwipeDirection, s.ClickDirection,
		s.KeyboardDirection, s.FitMode, s.BackgroundColor, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("failed to upsert user series setting: %w", err)
	}
	return nil
}
