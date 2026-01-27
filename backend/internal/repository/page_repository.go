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
func (r *PageRepository) Create(db database.Queryer, page *model.Page) error {
	db = database.GetQueryer(db)
	page.ID = uuid.New().String()

	_, err := db.Exec(
		`INSERT INTO pages (id, chapter_id, page_number, path, width, height) VALUES (?, ?, ?, ?, ?, ?)`,
		page.ID, page.ChapterID, page.PageNumber, page.Path, page.Width, page.Height,
	)
	return err
}

// CreateBatch 여러 페이지 일괄 생성
func (r *PageRepository) CreateBatch(db database.Queryer, pages []model.Page) error {
	db = database.GetQueryer(db)
	stmt, err := db.Prepare(`INSERT INTO pages (id, chapter_id, page_number, path, width, height) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()

	for i := range pages {
		pages[i].ID = uuid.New().String()
		if _, err := stmt.Exec(pages[i].ID, pages[i].ChapterID, pages[i].PageNumber, pages[i].Path, pages[i].Width, pages[i].Height); err != nil {
			return err
		}
	}

	return nil
}

// FindByChapterID 챕터 ID로 페이지 목록 조회
func (r *PageRepository) FindByChapterID(db database.Queryer, chapterID string) ([]model.Page, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, chapter_id, page_number, path, width, height FROM pages WHERE chapter_id = ? ORDER BY page_number`,
		chapterID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var pages []model.Page
	for rows.Next() {
		var p model.Page
		if err := rows.Scan(&p.ID, &p.ChapterID, &p.PageNumber, &p.Path, &p.Width, &p.Height); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, nil
}

// FindByID ID로 페이지 조회
func (r *PageRepository) FindByID(db database.Queryer, id string) (*model.Page, error) {
	db = database.GetQueryer(db)
	var p model.Page
	err := db.QueryRow(
		`SELECT id, chapter_id, page_number, path, width, height FROM pages WHERE id = ?`,
		id,
	).Scan(&p.ID, &p.ChapterID, &p.PageNumber, &p.Path, &p.Width, &p.Height)

	if err != nil {
		return nil, err
	}
	return &p, nil
}

// DeleteByChapterID 챕터 ID로 모든 페이지 삭제
func (r *PageRepository) DeleteByChapterID(db database.Queryer, chapterID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM pages WHERE chapter_id = ?`, chapterID)
	return err
}

// Update 페이지 정보 업데이트
func (r *PageRepository) Update(db database.Queryer, page *model.Page) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		`UPDATE pages SET width = ?, height = ? WHERE id = ?`,
		page.Width, page.Height, page.ID,
	)
	return err
}
