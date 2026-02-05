package repository

import (
	"database/sql"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"

	"github.com/google/uuid"
)

type VolumeCompletionRepository struct{}

func NewVolumeCompletionRepository() *VolumeCompletionRepository {
	return &VolumeCompletionRepository{}
}

// MarkComplete 볼륨 완료 표시 (이미 완료된 경우 업데이트)
func (r *VolumeCompletionRepository) MarkComplete(db database.Queryer, userID, volumeID string) (*model.VolumeCompletion, error) {
	db = database.GetQueryer(db)
	now := time.Now()
	completion := &model.VolumeCompletion{
		ID:          uuid.New().String(),
		UserID:      userID,
		VolumeID:    volumeID,
		CompletedAt: now,
	}

	_, err := db.Exec(`
		INSERT INTO volume_completions (id, user_id, volume_id, completed_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, volume_id) DO UPDATE SET completed_at = excluded.completed_at
	`, completion.ID, completion.UserID, completion.VolumeID, completion.CompletedAt)

	if err != nil {
		return nil, err
	}

	return completion, nil
}

// FindByUserAndVolume 사용자와 볼륨으로 완료 기록 조회
func (r *VolumeCompletionRepository) FindByUserAndVolume(db database.Queryer, userID, volumeID string) (*model.VolumeCompletion, error) {
	db = database.GetQueryer(db)
	var completion model.VolumeCompletion
	err := db.QueryRow(`
		SELECT id, user_id, volume_id, completed_at
		FROM volume_completions
		WHERE user_id = ? AND volume_id = ?
	`, userID, volumeID).Scan(&completion.ID, &completion.UserID, &completion.VolumeID, &completion.CompletedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &completion, nil
}

// IsCompleted 볼륨 완료 여부 확인
func (r *VolumeCompletionRepository) IsCompleted(db database.Queryer, userID, volumeID string) (bool, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM volume_completions
		WHERE user_id = ? AND volume_id = ?
	`, userID, volumeID).Scan(&count)

	if err != nil {
		return false, err
	}

	return count > 0, nil
}

// FindByUserAndSeries 사용자와 시리즈로 완료된 볼륨 목록 조회
func (r *VolumeCompletionRepository) FindByUserAndSeries(db database.Queryer, userID, seriesID string) ([]model.VolumeCompletion, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(`
		SELECT vc.id, vc.user_id, vc.volume_id, vc.completed_at
		FROM volume_completions vc
		INNER JOIN volumes v ON vc.volume_id = v.id
		WHERE vc.user_id = ? AND v.series_id = ?
		ORDER BY v.volume_number ASC
	`, userID, seriesID)

	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var completions []model.VolumeCompletion
	for rows.Next() {
		var c model.VolumeCompletion
		if err := rows.Scan(&c.ID, &c.UserID, &c.VolumeID, &c.CompletedAt); err != nil {
			return nil, err
		}
		completions = append(completions, c)
	}

	return completions, nil
}

// Delete 완료 기록 삭제 (읽지 않음으로 되돌리기)
func (r *VolumeCompletionRepository) Delete(db database.Queryer, userID, volumeID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`
		DELETE FROM volume_completions
		WHERE user_id = ? AND volume_id = ?
	`, userID, volumeID)
	return err
}

// CountByUserAndSeries 시리즈에서 완료된 볼륨 수 조회
func (r *VolumeCompletionRepository) CountByUserAndSeries(db database.Queryer, userID, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM volume_completions vc
		INNER JOIN volumes v ON vc.volume_id = v.id
		WHERE vc.user_id = ? AND v.series_id = ?
	`, userID, seriesID).Scan(&count)

	if err != nil {
		return 0, err
	}

	return count, nil
}

// CountTotalCompleted 사용자가 완료한 총 볼륨 수
func (r *VolumeCompletionRepository) CountTotalCompleted(db database.Queryer, userID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM volume_completions
		WHERE user_id = ?
	`, userID).Scan(&count)
	return count, err
}

// CountCompletedSeries 사용자가 완독한 시리즈 수 (모든 볼륨을 읽은 경우)
// 경고: 볼륨이 없는 시리즈는 제외됩니다.
func (r *VolumeCompletionRepository) CountCompletedSeries(db database.Queryer, userID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	
	// 로직:
	// 1. volumes 테이블에서 시리즈별로 그룹핑할 기준 시리즈 집합을 만든다.
	// 2. 각 시리즈에 대해, 해당 시리즈 내에 사용자가 아직 완료하지 않은 볼륨이 하나라도 있으면 제외한다.
	// 3. 즉, "사용자가 완료하지 않은 볼륨이 존재하지 않는" 시리즈만 완독 시리즈로 간주한다.
	query := `
		SELECT COUNT(*)
		FROM (
			SELECT v.series_id
			FROM volumes v
			WHERE NOT EXISTS (
				SELECT 1
				FROM volumes v2
				WHERE v2.series_id = v.series_id
					AND NOT EXISTS (
						SELECT 1
						FROM volume_completions vc
						WHERE vc.volume_id = v2.id
							AND vc.user_id = ?
					)
			)
			GROUP BY v.series_id
		) AS completed_series
	`
	
	err := db.QueryRow(query, userID).Scan(&count)
	return count, err
}

