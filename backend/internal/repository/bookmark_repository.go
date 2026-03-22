package repository

import (
	"database/sql"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/google/uuid"
)

type BookmarkRepository struct{}

func NewBookmarkRepository() *BookmarkRepository {
	return &BookmarkRepository{}
}

func (r *BookmarkRepository) Create(db database.Queryer, b *model.Bookmark) error {
	db = database.GetQueryer(db)

	if b.ID == "" {
		b.ID = uuid.New().String()
	}
	if b.CreatedAt.IsZero() {
		b.CreatedAt = time.Now()
	}

	_, err := db.Exec(
		`INSERT INTO bookmarks (
			id, user_id, series_id, volume_id, chapter_id, 
			title, description, page_number, current_position, current_cfi, current_time, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		b.ID, b.UserID, b.SeriesID, b.VolumeID, b.ChapterID,
		b.Title, b.Description, b.PageNumber, b.CurrentPosition, b.CurrentCFI, b.CurrentTime, b.CreatedAt,
	)
	return err
}

func (r *BookmarkRepository) FindByID(db database.Queryer, id string) (*model.Bookmark, error) {
	db = database.GetQueryer(db)

	var b model.Bookmark
	var vID, cID, cCFI sql.NullString
	var cTime sql.NullFloat64

	err := db.QueryRow(
		`SELECT id, user_id, series_id, volume_id, chapter_id, 
				COALESCE(title, ''), COALESCE(description, ''), page_number, current_position, current_cfi, "current_time", created_at
		 FROM bookmarks WHERE id = ?`,
		id,
	).Scan(
		&b.ID, &b.UserID, &b.SeriesID, &vID, &cID,
		&b.Title, &b.Description, &b.PageNumber, &b.CurrentPosition, &cCFI, &cTime, &b.CreatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	if vID.Valid {
		b.VolumeID = &vID.String
	}
	if cID.Valid {
		b.ChapterID = &cID.String
	}
	if cCFI.Valid {
		b.CurrentCFI = &cCFI.String
	}
	if cTime.Valid {
		b.CurrentTime = &cTime.Float64
	}

	return &b, nil
}

func (r *BookmarkRepository) FindByUserAndSeries(db database.Queryer, userID, seriesID string) ([]*model.Bookmark, error) {
	db = database.GetQueryer(db)

	rows, err := db.Query(
		`SELECT id, user_id, series_id, volume_id, chapter_id, 
				COALESCE(title, ''), COALESCE(description, ''), page_number, current_position, current_cfi, "current_time", created_at
		 FROM bookmarks WHERE user_id = ? AND series_id = ?
		 ORDER BY created_at DESC`,
		userID, seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var bookmarks []*model.Bookmark
	for rows.Next() {
		var b model.Bookmark
		var vID, cID, cCFI sql.NullString
		var cTime sql.NullFloat64

		if err := rows.Scan(
			&b.ID, &b.UserID, &b.SeriesID, &vID, &cID,
			&b.Title, &b.Description, &b.PageNumber, &b.CurrentPosition, &cCFI, &cTime, &b.CreatedAt,
		); err != nil {
			return nil, err
		}

		if vID.Valid {
			b.VolumeID = &vID.String
		}
		if cID.Valid {
			b.ChapterID = &cID.String
		}
		if cCFI.Valid {
			b.CurrentCFI = &cCFI.String
		}
		if cTime.Valid {
			b.CurrentTime = &cTime.Float64
		}

		bookmarks = append(bookmarks, &b)
	}

	return bookmarks, nil
}

func (r *BookmarkRepository) Delete(db database.Queryer, id string, userID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec("DELETE FROM bookmarks WHERE id = ? AND user_id = ?", id, userID)
	return err
}

func (r *BookmarkRepository) Update(db database.Queryer, b *model.Bookmark) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		`UPDATE bookmarks SET title = ?, description = ? WHERE id = ? AND user_id = ?`,
		b.Title, b.Description, b.ID, b.UserID,
	)
	return err
}
