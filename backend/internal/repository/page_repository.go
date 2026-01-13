package repository

import (
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/google/uuid"
)

type PageRepository struct{}

func NewPageRepository() *PageRepository {
	return &PageRepository{}
}

// Create 새 페이지 생성
func (r *PageRepository) Create(page *model.Page) error {
	page.ID = uuid.New().String()

	_, err := database.DB.Exec(
		`INSERT INTO pages (id, chapter_id, page_number, path), VALUES (?, ?, ?, ?)`,
		page.ID, page.ChapterID, page.PageNumber, page.Path,
	)
	return err
}

// CreateBatch 여러 페이지 일괄 생성
func (r *PageRepository) CreateBatch(pages []model.Page) error {
	tx, err := database.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO pages (id, chapter_id, page_number, path) VALUES (?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i := range pages {
		pages[i].ID = uuid.New().String()
		if _, err := stmt.Exec(pages[i].ID, pages[i].ChapterID, pages[i].PageNumber, pages[i].Path); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// FindByChapterID 챕터 ID로 페이지 목록 조회
func (r *PageRepository) FindByChapterID(chapterID string) ([]model.Page, error) {
	rows, err := database.DB.Query(
		`SELECT id, chapter_id, page_number, path FROM pages WHERE chapter_id = ? ORDER BY page_number`,
		chapterID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pages []model.Page
	for rows.Next() {
		var p model.Page
		if err := rows.Scan(&p.ID, &p.ChapterID, &p.PageNumber, &p.Path); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, nil
}

// FindByID ID로 페이지 조회
func (r *PageRepository) FindByID(id string) (*model.Page, error) {
	var p model.Page
	err := database.DB.QueryRow(
		`SELECT id, chapter_id, page_number, path FROM pages WHERE id = ?`,
		id,
	).Scan(&p.ID, &p.ChapterID, &p.PageNumber, &p.Path)

	if err != nil {
		return nil, err
	}
	return &p, nil
}

// DeleteByChapterID 챕터 ID로 모든 페이지 삭제
func (r *PageRepository) DeleteByChapterID(chapterID string) error {
	_, err := database.DB.Exec(`DELETE FROM pages WHERE chapter_id = ?`, chapterID)
	return err
}
