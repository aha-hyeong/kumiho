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
func (r *ChapterRepository) Create(db database.Queryer, chapter *model.Chapter) error {
	db = database.GetQueryer(db)
	if chapter.ID == "" {
		chapter.ID = uuid.New().String()
	}
	now := time.Now()
	chapter.CreatedAt = now
	chapter.UpdatedAt = now

	_, err := db.Exec(
		`INSERT INTO chapters (id, volume_id, title, chapter_number, path, page_count, total_bytes, total_positions, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		chapter.ID, chapter.VolumeID, chapter.Title, chapter.ChapterNumber, chapter.Path, chapter.PageCount, chapter.TotalBytes, chapter.TotalPositions, chapter.CreatedAt, chapter.UpdatedAt,
	)
	return err
}

// FindByVolumeID 볼륨 ID로 챕터 목록 조회
func (r *ChapterRepository) FindByVolumeID(db database.Queryer, volumeID string) ([]model.Chapter, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, volume_id, title, chapter_number, path, page_count, total_bytes, total_positions, created_at, updated_at 
		 FROM chapters WHERE volume_id = ? ORDER BY chapter_number`,
		volumeID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var chapters []model.Chapter
	for rows.Next() {
		var c model.Chapter
		if err := rows.Scan(&c.ID, &c.VolumeID, &c.Title, &c.ChapterNumber, &c.Path, &c.PageCount, &c.TotalBytes, &c.TotalPositions, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		chapters = append(chapters, c)
	}
	return chapters, nil
}

// FindBySeriesID 시리즈 ID로 모든 챕터 목록 조회
func (r *ChapterRepository) FindBySeriesID(db database.Queryer, seriesID string) ([]model.Chapter, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT c.id, c.volume_id, c.title, c.chapter_number, c.path, c.page_count, c.total_bytes, c.total_positions, c.created_at, c.updated_at 
		 FROM chapters c
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE v.series_id = ? ORDER BY v.volume_number, c.chapter_number`,
		seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var chapters []model.Chapter
	for rows.Next() {
		var c model.Chapter
		if err := rows.Scan(&c.ID, &c.VolumeID, &c.Title, &c.ChapterNumber, &c.Path, &c.PageCount, &c.TotalBytes, &c.TotalPositions, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		chapters = append(chapters, c)
	}
	return chapters, nil
}

// FindByID ID로 챕터 조회
func (r *ChapterRepository) FindByID(db database.Queryer, id string) (*model.Chapter, error) {
	db = database.GetQueryer(db)
	var c model.Chapter
	err := db.QueryRow(
		`SELECT id, volume_id, title, chapter_number, path, page_count, total_bytes, total_positions, created_at, updated_at FROM chapters WHERE id = ?`,
		id,
	).Scan(&c.ID, &c.VolumeID, &c.Title, &c.ChapterNumber, &c.Path, &c.PageCount, &c.TotalBytes, &c.TotalPositions, &c.CreatedAt, &c.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByPath 경로로 챕터 조회
func (r *ChapterRepository) FindByPath(db database.Queryer, path string) (*model.Chapter, error) {
	db = database.GetQueryer(db)
	var c model.Chapter
	err := db.QueryRow(
		`SELECT id, volume_id, title, chapter_number, path, page_count, total_bytes, total_positions, created_at, updated_at FROM chapters WHERE path = ?`,
		path,
	).Scan(&c.ID, &c.VolumeID, &c.Title, &c.ChapterNumber, &c.Path, &c.PageCount, &c.TotalBytes, &c.TotalPositions, &c.CreatedAt, &c.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &c, nil
}

// UpdatePageCount 페이지 수 업데이트
func (r *ChapterRepository) UpdatePageCount(db database.Queryer, id string, pageCount int) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		`UPDATE chapters SET page_count = ?, updated_at = ? WHERE id = ?`,
		pageCount, time.Now(), id,
	)
	return err
}

// GetFirstPageID 챕터의 첫 번째 페이지 ID 조회 (썸네일용)
func (r *ChapterRepository) GetFirstPageID(db database.Queryer, chapterID string) (string, error) {
	db = database.GetQueryer(db)
	var pageID string
	err := db.QueryRow(
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

// CountBySeriesID 시리즈의 전체 챕터 수를 조회합니다.
// 시리즈에 속한 모든 볼륨의 챕터를 합산하여 반환합니다.
// 오류 발생 시 0과 오류를 반환합니다.
func (r *ChapterRepository) CountBySeriesID(db database.Queryer, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(
		`SELECT COUNT(*) 
		 FROM chapters c
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE v.series_id = ?`,
		seriesID,
	).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// CountByVolumeID 볼륨 내 챕터 수를 조회합니다.
func (r *ChapterRepository) CountByVolumeID(db database.Queryer, volumeID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM chapters WHERE volume_id = ?`,
		volumeID,
	).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// IsLastChapter 해당 챕터가 볼륨의 마지막 챕터인지 확인
func (r *ChapterRepository) IsLastChapter(db database.Queryer, volumeID string, chapterNumber int) (bool, error) {
	db = database.GetQueryer(db)
	var dummy int
	err := db.QueryRow(
		`SELECT 1 FROM chapters WHERE volume_id = ? AND chapter_number > ? LIMIT 1`,
		volumeID, chapterNumber,
	).Scan(&dummy)

	if err == sql.ErrNoRows {
		// 이후 챕터가 없으므로 마지막 챕터
		return true, nil
	}
	if err != nil {
		return false, err
	}
	// 이후 챕터가 존재하므로 마지막 챕터가 아님
	return false, nil
}

// IsAllChaptersRead 볼륨 내 모든 챕터가 완독 상태인지 확인
func (r *ChapterRepository) IsAllChaptersRead(db database.Queryer, userID string, volumeID string) (bool, error) {
	db = database.GetQueryer(db)
	var remainingCount int
	err := db.QueryRow(
		`SELECT COUNT(*) 
		 FROM chapters c
		 LEFT JOIN chapter_completions cc ON c.id = cc.chapter_id AND cc.user_id = ?
		 WHERE c.volume_id = ? AND cc.id IS NULL`,
		userID, volumeID,
	).Scan(&remainingCount)

	if err != nil {
		return false, err
	}

	return remainingCount == 0, nil
}
