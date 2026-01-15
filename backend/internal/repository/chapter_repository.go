package repository

import (
	"database/sql"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/google/uuid"
)

type ChapterRepository struct{}

func NewChapterRepository() *ChapterRepository {
	return &ChapterRepository{}
}

// Create 새 챕터 생성
func (r *ChapterRepository) Create(chapter *model.Chapter) error {
	chapter.ID = uuid.New().String()
	now := time.Now()
	chapter.CreatedAt = now
	chapter.UpdatedAt = now

	_, err := database.DB.Exec(
		`INSERT INTO chapters (id, volume_id, title, chapter_number, path, page_count, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		chapter.ID, chapter.VolumeID, chapter.Title, chapter.ChapterNumber, chapter.Path, chapter.PageCount, chapter.CreatedAt, chapter.UpdatedAt,
	)
	return err
}

// FindByVolumeID 볼륨 ID로 챕터 목록 조회
func (r *ChapterRepository) FindByVolumeID(volumeID string) ([]model.Chapter, error) {
	rows, err := database.DB.Query(
		`SELECT id, volume_id, title, chapter_number, path, page_count, created_at, updated_at 
		 FROM chapters WHERE volume_id = ? ORDER BY chapter_number`,
		volumeID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chapters []model.Chapter
	for rows.Next() {
		var c model.Chapter
		if err := rows.Scan(&c.ID, &c.VolumeID, &c.Title, &c.ChapterNumber, &c.Path, &c.PageCount, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		chapters = append(chapters, c)
	}
	return chapters, nil
}

// FindByID ID로 챕터 조회
func (r *ChapterRepository) FindByID(id string) (*model.Chapter, error) {
	var c model.Chapter
	err := database.DB.QueryRow(
		`SELECT id, volume_id, title, chapter_number, path, page_count, created_at, updated_at FROM chapters WHERE id = ?`,
		id,
	).Scan(&c.ID, &c.VolumeID, &c.Title, &c.ChapterNumber, &c.Path, &c.PageCount, &c.CreatedAt, &c.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByPath 경로로 챕터 조회
func (r *ChapterRepository) FindByPath(path string) (*model.Chapter, error) {
	var c model.Chapter
	err := database.DB.QueryRow(
		`SELECT id, volume_id, title, chapter_number, path, page_count, created_at, updated_at FROM chapters WHERE path = ?`,
		path,
	).Scan(&c.ID, &c.VolumeID, &c.Title, &c.ChapterNumber, &c.Path, &c.PageCount, &c.CreatedAt, &c.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &c, nil
}

// UpdatePageCount 페이지 수 업데이트
func (r *ChapterRepository) UpdatePageCount(id string, pageCount int) error {
	_, err := database.DB.Exec(
		`UPDATE chapters SET page_count = ?, updated_at = ? WHERE id = ?`,
		pageCount, time.Now(), id,
	)
	return err
}

// GetFirstPageID 챕터의 첫 번째 페이지 ID 조회 (썸네일용)
func (r *ChapterRepository) GetFirstPageID(chapterID string) (string, error) {
	var pageID string
	err := database.DB.QueryRow(
		`SELECT id FROM pages WHERE chapter_id = ? ORDER BY page_number LIMIT 1`,
		chapterID,
	).Scan(&pageID)

	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return pageID, nil
}
