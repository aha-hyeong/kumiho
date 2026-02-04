package repository

import (
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/google/uuid"
)

type ChapterCompletionRepository struct{}

func NewChapterCompletionRepository() *ChapterCompletionRepository {
	return &ChapterCompletionRepository{}
}

// MarkComplete 챕터 완독 처리
func (r *ChapterCompletionRepository) MarkComplete(db database.Queryer, userID, chapterID string) error {
	db = database.GetQueryer(db)
	
	// 이미 완독된 경우 무시 (INSERT IGNORE / ON CONFLICT DO NOTHING)
	_, err := db.Exec(
		`INSERT INTO chapter_completions (id, user_id, chapter_id, completed_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, chapter_id) DO UPDATE SET completed_at = excluded.completed_at`,
		uuid.New().String(), userID, chapterID, time.Now(),
	)
	return err
}

// IsCompleted 챕터 완독 여부 확인
func (r *ChapterCompletionRepository) IsCompleted(db database.Queryer, userID, chapterID string) (bool, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM chapter_completions WHERE user_id = ? AND chapter_id = ?`,
		userID, chapterID,
	).Scan(&count)
	
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// FindCompletedChapterIDs 볼륨 내 완독된 챕터 ID 목록 조회
func (r *ChapterCompletionRepository) FindCompletedChapterIDs(db database.Queryer, userID, volumeID string) (map[string]bool, error) {
	db = database.GetQueryer(db)
	
	rows, err := db.Query(
		`SELECT cc.chapter_id 
		 FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 WHERE cc.user_id = ? AND c.volume_id = ?`,
		userID, volumeID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	
	result := make(map[string]bool)
	for rows.Next() {
		var chapterID string
		if err := rows.Scan(&chapterID); err != nil {
			return nil, err
		}
		result[chapterID] = true
	}
	return result, nil
}

// FindAllCompletedByUser 사용자가 완독한 모든 챕터 ID 조회 (시리즈/볼륨 단위 없이 전체)
// 성능 주의: 필요할 때만 사용
func (r *ChapterCompletionRepository) FindAllCompletedByUser(db database.Queryer, userID string) (map[string]bool, error) {
	db = database.GetQueryer(db)
	
	rows, err := db.Query(
		`SELECT chapter_id FROM chapter_completions WHERE user_id = ?`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	
	result := make(map[string]bool)
	for rows.Next() {
		var chapterID string
		if err := rows.Scan(&chapterID); err != nil {
			return nil, err
		}
		result[chapterID] = true
	}
	return result, nil
}

// DeleteByVolume 완독 정보 삭제 (볼륨 삭제 또는 초기화 시)
func (r *ChapterCompletionRepository) DeleteByVolume(db database.Queryer, userID, volumeID string) error {
	db = database.GetQueryer(db)
	
	_, err := db.Exec(
		`DELETE FROM chapter_completions 
		 WHERE user_id = ? AND chapter_id IN (SELECT id FROM chapters WHERE volume_id = ?)`,
		userID, volumeID,
	)
	return err
}

// DeleteByChapter 특정 챕터 완독 정보 삭제
func (r *ChapterCompletionRepository) DeleteByChapter(db database.Queryer, userID, chapterID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		`DELETE FROM chapter_completions WHERE user_id = ? AND chapter_id = ?`,
		userID, chapterID,
	)
	return err
}
