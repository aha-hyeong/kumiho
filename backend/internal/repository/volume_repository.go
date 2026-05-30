package repository

import (
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type VolumeRepository struct{}

func NewVolumeRepository() *VolumeRepository {
	return &VolumeRepository{}
}

// Create 새 볼륨 생성
func (r *VolumeRepository) Create(db database.Queryer, volume *model.Volume) error {
	db = database.GetQueryer(db)
	if volume.ID == "" {
		volume.ID = uuid.New().String()
	}
	now := time.Now()
	if volume.CreatedAt.IsZero() {
		volume.CreatedAt = now
	}
	if volume.UpdatedAt.IsZero() {
		volume.UpdatedAt = now
	}

	_, err := db.Exec(
		`INSERT INTO volumes (id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		volume.ID, volume.SeriesID, volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.HasAudio, volume.Unit, volume.ChapterCount, volume.ParentID, volume.Description, volume.Authors, volume.PublicationYear, volume.Extension, volume.CreatedAt, volume.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if _, err := db.Exec(`UPDATE series SET last_content_updated_at = ? WHERE id = ?`, now, volume.SeriesID); err != nil {
		return err
	}
	return nil
}

// Update 볼륨 정보 수정 (콘텐츠 변경으로 간주)
func (r *VolumeRepository) Update(db database.Queryer, volume *model.Volume) error {
	db = database.GetQueryer(db)
	volume.UpdatedAt = time.Now()
	return r.update(db, volume, true)
}

// UpdatePreservingContentUpdatedAt 볼륨 메타데이터만 수정하고 시리즈 콘텐츠 갱신 시간과 볼륨 updated_at을 보존
func (r *VolumeRepository) UpdatePreservingContentUpdatedAt(db database.Queryer, volume *model.Volume) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		`UPDATE volumes 
		 SET title = ?, volume_number = ?, path = ?, thumbnail_path = ?, has_audio = ?, unit = ?, chapter_count = ?, parent_id = ?, description = ?, authors = ?, publication_year = ?, extension = ?
		 WHERE id = ?`,
		volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.HasAudio, volume.Unit, volume.ChapterCount, volume.ParentID, volume.Description, volume.Authors, volume.PublicationYear, volume.Extension, volume.ID,
	)
	return err
}

func (r *VolumeRepository) update(db database.Queryer, volume *model.Volume, updateContentTimestamp bool) error {
	_, err := db.Exec(
		`UPDATE volumes 
		 SET title = ?, volume_number = ?, path = ?, thumbnail_path = ?, has_audio = ?, unit = ?, chapter_count = ?, parent_id = ?, description = ?, authors = ?, publication_year = ?, extension = ?, updated_at = ?
		 WHERE id = ?`,
		volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.HasAudio, volume.Unit, volume.ChapterCount, volume.ParentID, volume.Description, volume.Authors, volume.PublicationYear, volume.Extension, volume.UpdatedAt, volume.ID,
	)
	if err != nil {
		return err
	}
	if !updateContentTimestamp {
		return nil
	}
	if _, err := db.Exec(`UPDATE series SET last_content_updated_at = ? WHERE id = ?`, volume.UpdatedAt, volume.SeriesID); err != nil {
		return err
	}
	return nil
}

// UpdateHasAudio has_audio 플래그만 업데이트
func (r *VolumeRepository) UpdateHasAudio(db database.Queryer, volumeID string, hasAudio bool) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`UPDATE volumes SET has_audio = ? WHERE id = ?`, hasAudio, volumeID)
	return err
}

// UpdateExtension extension 필드만 업데이트 (updated_at은 변경하지 않음 - 스캐너 ModTime 비교에 영향 방지)
func (r *VolumeRepository) UpdateExtension(db database.Queryer, volumeID string, extension string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`UPDATE volumes SET extension = ? WHERE id = ?`, extension, volumeID)
	return err
}

// FindBySeriesID 시리즈 ID로 볼륨 목록 조회
func (r *VolumeRepository) FindBySeriesID(db database.Queryer, seriesID string) ([]model.Volume, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at 
		 FROM volumes WHERE series_id = ? ORDER BY volume_number`,
		seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail, unit, parentID sql.NullString
		var description, authors, pubYear, extension sql.NullString

		if err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if parentID.Valid {
			v.ParentID = &parentID.String
		}
		if description.Valid {
			v.Description = description.String
		}
		if authors.Valid {
			v.Authors = authors.String
		}
		if pubYear.Valid {
			v.PublicationYear = pubYear.String
		}
		if extension.Valid {
			v.Extension = extension.String
		}
		volumes = append(volumes, v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return volumes, nil
}

func (r *VolumeRepository) FindRootVolumesBySeriesID(db database.Queryer, seriesID string) ([]model.Volume, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at
		 FROM volumes
		 WHERE series_id = ? AND parent_id IS NULL
		 ORDER BY volume_number`,
		seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail, unit, parentID sql.NullString
		var description, authors, pubYear, extension sql.NullString

		if err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if parentID.Valid {
			v.ParentID = &parentID.String
		}
		if description.Valid {
			v.Description = description.String
		}
		if authors.Valid {
			v.Authors = authors.String
		}
		if pubYear.Valid {
			v.PublicationYear = pubYear.String
		}
		if extension.Valid {
			v.Extension = extension.String
		}
		volumes = append(volumes, v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return volumes, nil
}

func (r *VolumeRepository) FindRootDisplayUnitsBySeriesIDs(db database.Queryer, seriesIDs []string) (map[string]string, error) {
	db = database.GetQueryer(db)
	if len(seriesIDs) == 0 {
		return map[string]string{}, nil
	}

	const batchSize = 900
	displayUnits := make(map[string]string, len(seriesIDs))
	for start := 0; start < len(seriesIDs); start += batchSize {
		end := start + batchSize
		if end > len(seriesIDs) {
			end = len(seriesIDs)
		}
		chunkUnits, err := r.findRootDisplayUnitsBySeriesIDsChunk(db, seriesIDs[start:end])
		if err != nil {
			return nil, err
		}
		for seriesID, displayUnit := range chunkUnits {
			displayUnits[seriesID] = displayUnit
		}
	}

	return displayUnits, nil
}

func (r *VolumeRepository) findRootDisplayUnitsBySeriesIDsChunk(db database.Queryer, seriesIDs []string) (map[string]string, error) {
	if len(seriesIDs) == 0 {
		return map[string]string{}, nil
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(seriesIDs)), ",")
	query := fmt.Sprintf(`
		SELECT
			series_id,
			CASE
				WHEN SUM(CASE WHEN COALESCE(unit, 'volume') != 'chapter' THEN 1 ELSE 0 END) = 0 THEN 'chapter'
				ELSE 'volume'
			END AS display_unit
		FROM volumes
		WHERE parent_id IS NULL
		  AND series_id IN (%s)
		GROUP BY series_id
	`, placeholders)

	args := make([]any, len(seriesIDs))
	for i, seriesID := range seriesIDs {
		args[i] = seriesID
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	displayUnits := make(map[string]string, len(seriesIDs))
	for rows.Next() {
		var (
			seriesID    string
			displayUnit string
		)
		if err := rows.Scan(&seriesID, &displayUnit); err != nil {
			return nil, err
		}
		displayUnits[seriesID] = displayUnit
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return displayUnits, nil
}

// FindByID ID로 볼륨 조회
func (r *VolumeRepository) FindByID(db database.Queryer, id string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail, unit, parentID sql.NullString
	var description, authors, pubYear, extension sql.NullString

	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at FROM volumes WHERE id = ?`,
		id,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		v.ThumbnailPath = &thumbnail.String
	}
	if unit.Valid {
		v.Unit = unit.String
	}
	if parentID.Valid {
		v.ParentID = &parentID.String
	}
	if description.Valid {
		v.Description = description.String
	}
	if authors.Valid {
		v.Authors = authors.String
	}
	if pubYear.Valid {
		v.PublicationYear = pubYear.String
	}
	if extension.Valid {
		v.Extension = extension.String
	}
	return &v, nil
}

// FindByPath 경로로 볼륨 조회
func (r *VolumeRepository) FindByPath(db database.Queryer, path string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail, unit, parentID sql.NullString
	var description, authors, pubYear, extension sql.NullString

	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at FROM volumes WHERE path = ?`,
		path,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		v.ThumbnailPath = &thumbnail.String
	}
	if unit.Valid {
		v.Unit = unit.String
	}
	if parentID.Valid {
		v.ParentID = &parentID.String
	}
	if description.Valid {
		v.Description = description.String
	}
	if authors.Valid {
		v.Authors = authors.String
	}
	if pubYear.Valid {
		v.PublicationYear = pubYear.String
	}
	if extension.Valid {
		v.Extension = extension.String
	}
	return &v, nil
}

// GetFirstPageID 볼륨의 첫 번째 페이지 ID 조회 (썸네일용)
func (r *VolumeRepository) GetFirstPageID(db database.Queryer, volumeID string) (string, error) {
	db = database.GetQueryer(db)
	var pageID string
	err := db.QueryRow(
		`SELECT p.id 
		 FROM pages p
		 JOIN chapters c ON p.chapter_id = c.id
		 WHERE c.volume_id = ?
		 ORDER BY c.chapter_number, p.page_number
		 LIMIT 1`,
		volumeID,
	).Scan(&pageID)

	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return pageID, nil
}

// DeleteBySeriesID 시리즈 ID로 모든 볼륨 삭제
func (r *VolumeRepository) DeleteBySeriesID(db database.Queryer, seriesID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM volumes WHERE series_id = ?`, seriesID)
	return err
}

// Delete 볼륨 삭제
func (r *VolumeRepository) Delete(db database.Queryer, id string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM volumes WHERE id = ?`, id)
	return err
}

// CountBySeriesID 시리즈의 전체 볼륨 수를 조회합니다.
// 오류 발생 시 0과 오류를 반환합니다.
func (r *VolumeRepository) CountBySeriesID(db database.Queryer, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM volumes WHERE series_id = ?`, seriesID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// GetChapterCount 사용 가능한 챕터 개수를 조회합니다.
func (r *VolumeRepository) GetChapterCount(db database.Queryer, volumeID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM chapters WHERE volume_id = ?`, volumeID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// HasZeroPageChapters page_count가 0인 비-오디오 챕터가 있는지 확인합니다.
func (r *VolumeRepository) HasZeroPageChapters(db database.Queryer, volumeID string) (bool, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM chapters WHERE volume_id = ? AND page_count <= 0 AND has_audio = 0`, volumeID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// GetTotalPages 볼륨의 전체 페이지 수 조회 (하위 볼륨 포함)
func (r *VolumeRepository) GetTotalPages(db database.Queryer, volumeID string) (int, error) {
	db = database.GetQueryer(db)
	var totalPages float64
	err := db.QueryRow(
		`WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
			 SELECT COALESCE(SUM(
				CASE 
					WHEN c.page_count > 0 THEN c.page_count 
					WHEN c.page_count <= 0 AND c.total_positions > 0 THEN c.total_positions
					ELSE 0 
			END), 0)
		 FROM chapters c
		 WHERE c.volume_id IN (SELECT id FROM descendant_volumes)`,
		volumeID,
	).Scan(&totalPages)
	if err != nil {
		return 0, err
	}
	if totalPages < 0 {
		return 0, nil
	}
	return int(math.Round(totalPages)), nil
}

// GetReadPages 사용자가 볼륨에서 읽은 총 페이지 수 조회 (하위 볼륨 포함)
func (r *VolumeRepository) GetReadPages(db database.Queryer, userID, volumeID string) (int, error) {
	db = database.GetQueryer(db)

	// 하위 볼륨 포함 재귀 집계
	var completedPages float64
	err := db.QueryRow(
		`WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
			 SELECT COALESCE(SUM(
				CASE 
					WHEN c.page_count > 0 THEN c.page_count 
					WHEN c.page_count <= 0 AND c.total_positions > 0 THEN c.total_positions
					ELSE 0 
			END), 0)
		 FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 WHERE cc.user_id = ? AND c.volume_id IN (SELECT id FROM descendant_volumes)`,
		volumeID, userID,
	).Scan(&completedPages)
	if err != nil {
		return 0, err
	}

	var progressPages float64
	err = db.QueryRow(
		`WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
			 SELECT COALESCE(SUM(
				CASE 
					WHEN c.page_count > 0 THEN rp.current_page
					WHEN c.page_count <= 0 AND c.total_positions > 0 THEN rp.current_page
					WHEN c.has_audio = 1 THEN 0
					ELSE rp.progress_percent
				END
				 ), 0)
		 FROM reading_progress rp
		 JOIN chapters c ON rp.chapter_id = c.id
		 WHERE rp.user_id = ? AND c.volume_id IN (SELECT id FROM descendant_volumes)
		 AND rp.chapter_id NOT IN (
			 SELECT chapter_id FROM chapter_completions WHERE user_id = ?
		 )`,
		volumeID, userID, userID,
	).Scan(&progressPages)
	if err != nil {
		return 0, err
	}

	totalRead := completedPages + progressPages
	if totalRead < 0 {
		return 0, nil
	}
	return int(math.Round(totalRead)), nil
}

// GetProgressPercent 사용자의 볼륨 실제 진행 퍼센트 조회 (하위 볼륨 포함)
func (r *VolumeRepository) GetProgressPercent(db database.Queryer, userID, volumeID string) (float64, error) {
	db = database.GetQueryer(db)

	var percent float64
	err := db.QueryRow(
		`WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
			),
			chapter_units AS (
				SELECT
					c.id AS chapter_id,
					CASE
						WHEN c.has_audio = 1 AND c.duration > 0 THEN CAST(c.duration AS INTEGER)
						WHEN c.page_count > 0 THEN c.page_count
						WHEN c.total_positions > 0 THEN c.total_positions
						ELSE 0
					END AS unit_total,
					c.has_audio
				FROM chapters c
			WHERE c.volume_id IN (SELECT id FROM descendant_volumes)
		),
		total_units AS (
			SELECT COALESCE(SUM(cu.unit_total), 0) AS value
			FROM chapter_units cu
		),
		completed_units AS (
			SELECT COALESCE(SUM(cu.unit_total), 0) AS value
			FROM chapter_units cu
			JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id
			WHERE cc.user_id = ?
			),
			inprogress_units AS (
				SELECT COALESCE(SUM(
					CASE
						WHEN cu.has_audio = 1 AND COALESCE(NULLIF(rp.duration, 0), CAST(cu.unit_total AS REAL)) > 0 THEN
							MIN(1.0, MAX(0.0, COALESCE(rp.current_time, 0.0) / COALESCE(NULLIF(rp.duration, 0), CAST(cu.unit_total AS REAL)))) * cu.unit_total
						WHEN rp.current_cfi IS NOT NULL AND rp.current_cfi <> '' THEN
							MIN(1.0, MAX(0.0, rp.progress_percent / 100.0)) * cu.unit_total
						WHEN rp.total_pages > 0 THEN
							MIN(1.0, MAX(0.0, CAST(rp.current_page AS REAL) / CAST(rp.total_pages AS REAL))) * cu.unit_total
						ELSE
							MIN(1.0, MAX(0.0, rp.progress_percent / 100.0)) * cu.unit_total
					END
				), 0.0) AS value
			FROM chapter_units cu
			JOIN reading_progress rp ON rp.chapter_id = cu.chapter_id
			LEFT JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id AND cc.user_id = rp.user_id
			WHERE rp.user_id = ?
			  AND cc.chapter_id IS NULL
		)
		SELECT CASE
			WHEN total_units.value <= 0 THEN 0.0
			ELSE MIN(100.0, MAX(0.0, ((completed_units.value + inprogress_units.value) * 100.0) / total_units.value))
		END
		FROM total_units, completed_units, inprogress_units`,
		volumeID, userID, userID,
	).Scan(&percent)
	return percent, err
}

// GetFirstVolume 시리즈의 첫 번째 볼륨 조회
func (r *VolumeRepository) GetFirstVolume(db database.Queryer, seriesID string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail, unit, parentID sql.NullString
	var description, authors, pubYear, extension sql.NullString

	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at 
		 FROM volumes WHERE series_id = ? ORDER BY volume_number LIMIT 1`,
		seriesID,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		v.ThumbnailPath = &thumbnail.String
	}
	if unit.Valid {
		v.Unit = unit.String
	}
	if parentID.Valid {
		v.ParentID = &parentID.String
	}
	if description.Valid {
		v.Description = description.String
	}
	if authors.Valid {
		v.Authors = authors.String
	}
	if pubYear.Valid {
		v.PublicationYear = pubYear.String
	}
	if extension.Valid {
		v.Extension = extension.String
	}
	return &v, nil
}

// FindByParentID 부모 볼륨 ID로 볼륨 목록 조회 (시리즈 스코프 제한)
func (r *VolumeRepository) FindByParentID(db database.Queryer, parentID string) ([]model.Volume, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at 
		 FROM volumes 
		 WHERE parent_id = ? 
		   AND series_id = (SELECT series_id FROM volumes WHERE id = ?)
		 ORDER BY volume_number`,
		parentID,
		parentID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail, unit, pID sql.NullString
		var description, authors, pubYear, extension sql.NullString

		if err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &pID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if pID.Valid {
			v.ParentID = &pID.String
		}
		if description.Valid {
			v.Description = description.String
		}
		if authors.Valid {
			v.Authors = authors.String
		}
		if pubYear.Valid {
			v.PublicationYear = pubYear.String
		}
		if extension.Valid {
			v.Extension = extension.String
		}
		volumes = append(volumes, v)
	}
	return volumes, nil
}

// CountByParentID 부모 볼륨 ID로 하위 볼륨 개수 조회
func (r *VolumeRepository) CountByParentID(db database.Queryer, parentID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM volumes WHERE parent_id = ?`, parentID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// GetDistinctExtensions 시리즈 내 모든 볼륨의 고유한 확장자 목록 조회
func (r *VolumeRepository) GetDistinctExtensions(db database.Queryer, seriesID string) ([]string, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(`SELECT DISTINCT extension FROM volumes WHERE series_id = ? AND (extension IS NOT NULL AND extension != '')`, seriesID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var extensions []string
	for rows.Next() {
		var ext string
		if err := rows.Scan(&ext); err != nil {
			return nil, err
		}
		extensions = append(extensions, ext)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return extensions, nil
}

// GetTotalPagesBatch 시리즈 내 하위 볼륨들의 전체 페이지 수 배치 조회
func (r *VolumeRepository) GetTotalPagesBatch(db database.Queryer, volumeIDs []string) (map[string]int, error) {
	if len(volumeIDs) == 0 {
		return make(map[string]int), nil
	}
	db = database.GetQueryer(db)

	query := `
		WITH RECURSIVE descendant_volumes(root_id, id) AS (
			SELECT id, id FROM volumes WHERE id IN (?)
			UNION ALL
			SELECT dv.root_id, v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
			SELECT dv.root_id, COALESCE(SUM(
				CASE 
					WHEN c.page_count > 0 THEN c.page_count 
					WHEN c.page_count <= 0 AND c.total_positions > 0 THEN c.total_positions
					ELSE 0 
			END), 0)
		FROM chapters c
		JOIN descendant_volumes dv ON c.volume_id = dv.id
		GROUP BY dv.root_id
	`

	// ID 목록을 query에 바인딩하기 위해 ? 개수 조절
	placeholders := make([]string, len(volumeIDs))
	args := make([]interface{}, len(volumeIDs))
	for i, id := range volumeIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	actualQuery := strings.Replace(query, "?", strings.Join(placeholders, ","), 1)

	rows, err := db.Query(actualQuery, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string]int)
	for rows.Next() {
		var id string
		var total float64
		if err := rows.Scan(&id, &total); err != nil {
			return nil, err
		}
		if total < 0 {
			result[id] = 0
			continue
		}
		result[id] = int(math.Round(total))
	}
	return result, nil
}

// GetReadPagesBatch 사용자가 시리즈 내 하위 볼륨들에서 읽은 총 페이지 수 배치 조회
func (r *VolumeRepository) GetReadPagesBatch(db database.Queryer, userID string, volumeIDs []string) (map[string]int, error) {
	if len(volumeIDs) == 0 {
		return make(map[string]int), nil
	}
	db = database.GetQueryer(db)

	placeholders := make([]string, len(volumeIDs))
	args := make([]interface{}, 0, len(volumeIDs)*2+1)
	for i, id := range volumeIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	placeholderStr := strings.Join(placeholders, ",")

	// 1. 완료된 페이지 집계
	completedQuery := `
		WITH RECURSIVE descendant_volumes(root_id, id) AS (
			SELECT id, id FROM volumes WHERE id IN (` + placeholderStr + `)
			UNION ALL
			SELECT dv.root_id, v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		SELECT dv.root_id, COALESCE(SUM(
			CASE 
				WHEN c.page_count > 0 THEN c.page_count 
				WHEN c.page_count <= 0 AND c.total_positions > 0 THEN c.total_positions
				ELSE 0 
			END), 0)
		FROM chapter_completions cc
		JOIN chapters c ON cc.chapter_id = c.id
		JOIN descendant_volumes dv ON c.volume_id = dv.id
		WHERE cc.user_id = ?
		GROUP BY dv.root_id
	`
	completedArgs := append(args, userID)
	rows, err := db.Query(completedQuery, completedArgs...)
	if err != nil {
		return nil, err
	}

	completedMap := make(map[string]int)
	for rows.Next() {
		var id string
		var count int
		if scanErr := rows.Scan(&id, &count); scanErr != nil {
			_ = rows.Close()
			return nil, scanErr
		}
		completedMap[id] = count
	}
	_ = rows.Close()

	// 2. 진행 중인 페이지 집계
	progressQuery := `
		WITH RECURSIVE descendant_volumes(root_id, id) AS (
			SELECT id, id FROM volumes WHERE id IN (` + placeholderStr + `)
			UNION ALL
			SELECT dv.root_id, v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		SELECT dv.root_id, COALESCE(SUM(
			CASE 
				WHEN c.page_count > 0 THEN rp.current_page
				WHEN c.page_count <= 0 AND c.total_positions > 0 THEN rp.current_page
				ELSE CAST(rp.progress_percent AS INTEGER)
			END
		), 0)
		FROM reading_progress rp
		JOIN chapters c ON rp.chapter_id = c.id
		JOIN descendant_volumes dv ON c.volume_id = dv.id
		WHERE rp.user_id = ?
		AND rp.chapter_id NOT IN (
			SELECT chapter_id FROM chapter_completions WHERE user_id = ?
		)
		GROUP BY dv.root_id
	`
	progressArgs := append(args, userID, userID)
	rows, err = db.Query(progressQuery, progressArgs...)
	if err != nil {
		return nil, err
	}

	progressMap := make(map[string]int)
	for rows.Next() {
		var id string
		var count int
		if err := rows.Scan(&id, &count); err != nil {
			_ = rows.Close()
			return nil, err
		}
		progressMap[id] = count
	}
	_ = rows.Close()

	// 3. 결과 합산
	result := make(map[string]int)
	for _, id := range volumeIDs {
		result[id] = completedMap[id] + progressMap[id]
	}
	return result, nil
}

// GetProgressPercentBatch 사용자의 볼륨 실제 진행 퍼센트 배치 조회
func (r *VolumeRepository) GetProgressPercentBatch(db database.Queryer, userID string, volumeIDs []string) (map[string]float64, error) {
	if len(volumeIDs) == 0 {
		return make(map[string]float64), nil
	}
	db = database.GetQueryer(db)

	placeholders := make([]string, len(volumeIDs))
	args := make([]interface{}, 0, len(volumeIDs))
	for i, id := range volumeIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	placeholderStr := strings.Join(placeholders, ",")

	query := `
		WITH RECURSIVE descendant_volumes(root_id, id) AS (
			SELECT id, id FROM volumes WHERE id IN (` + placeholderStr + `)
			UNION ALL
			SELECT dv.root_id, v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		),
			chapter_units AS (
				SELECT
					dv.root_id,
					c.id AS chapter_id,
					CASE
						WHEN c.has_audio = 1 AND c.duration > 0 THEN CAST(c.duration AS INTEGER)
						WHEN c.page_count > 0 THEN c.page_count
						WHEN c.total_positions > 0 THEN c.total_positions
						ELSE 0
					END AS unit_total,
					c.has_audio
				FROM chapters c
			JOIN descendant_volumes dv ON c.volume_id = dv.id
		),
		volume_stats AS (
				SELECT
					cu.root_id,
					SUM(cu.unit_total) AS total_units,
					SUM(CASE WHEN cc.chapter_id IS NOT NULL THEN cu.unit_total ELSE 0 END) AS completed_units,
					SUM(CASE WHEN rp.chapter_id IS NOT NULL AND cc.chapter_id IS NULL THEN
						CASE
							WHEN cu.has_audio = 1 AND COALESCE(NULLIF(rp.duration, 0), CAST(cu.unit_total AS REAL)) > 0 THEN
								MIN(1.0, MAX(0.0, COALESCE(rp.current_time, 0.0) / COALESCE(NULLIF(rp.duration, 0), CAST(cu.unit_total AS REAL)))) * cu.unit_total
							WHEN rp.current_cfi IS NOT NULL AND rp.current_cfi <> '' THEN
								MIN(1.0, MAX(0.0, rp.progress_percent / 100.0)) * cu.unit_total
							WHEN rp.total_pages > 0 THEN
								MIN(1.0, MAX(0.0, CAST(rp.current_page AS REAL) / CAST(rp.total_pages AS REAL))) * cu.unit_total
							ELSE
								MIN(1.0, MAX(0.0, rp.progress_percent / 100.0)) * cu.unit_total
						END
						ELSE 0 END) AS inprogress_units
			FROM chapter_units cu
			LEFT JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id AND cc.user_id = ?
			LEFT JOIN reading_progress rp ON rp.chapter_id = cu.chapter_id AND rp.user_id = ?
			GROUP BY cu.root_id
		)
		SELECT root_id, CASE
			WHEN total_units <= 0 THEN 0.0
			ELSE MIN(100.0, MAX(0.0, ((completed_units + inprogress_units) * 100.0) / total_units))
		END
		FROM volume_stats
	`

	fullArgs := append(args, userID, userID)
	rows, err := db.Query(query, fullArgs...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string]float64)
	for rows.Next() {
		var id string
		var percent float64
		if err := rows.Scan(&id, &percent); err != nil {
			return nil, err
		}
		result[id] = percent
	}
	return result, nil
}

// FindByIDs 여러 볼륨 ID 목록으로 볼륨 상세 조회
func (r *VolumeRepository) FindByIDs(db database.Queryer, ids []string) ([]model.Volume, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	db = database.GetQueryer(db)

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at FROM volumes WHERE id IN (%s)`,
		strings.Join(placeholders, ","),
	)

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail, unit, parentID sql.NullString
		var description, authors, pubYear, extension sql.NullString

		err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt)
		if err != nil {
			return nil, err
		}

		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if parentID.Valid {
			v.ParentID = &parentID.String
		}
		if description.Valid {
			v.Description = description.String
		}
		if authors.Valid {
			v.Authors = authors.String
		}
		if pubYear.Valid {
			v.PublicationYear = pubYear.String
		}
		if extension.Valid {
			v.Extension = extension.String
		}
		volumes = append(volumes, v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return volumes, nil
}

// GetFirstPageIDsBatch 여러 볼륨의 첫 번째 페이지 ID 배치 조회 (썸네일용)
func (r *VolumeRepository) GetFirstPageIDsBatch(db database.Queryer, volumeIDs []string) (map[string]string, error) {
	if len(volumeIDs) == 0 {
		return make(map[string]string), nil
	}
	db = database.GetQueryer(db)

	placeholders := make([]string, len(volumeIDs))
	args := make([]interface{}, len(volumeIDs))
	for i, id := range volumeIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		WITH RankedPages AS (
			SELECT c.volume_id, p.id AS page_id,
			       ROW_NUMBER() OVER (PARTITION BY c.volume_id ORDER BY c.chapter_number, p.page_number) AS rn
			FROM pages p
			JOIN chapters c ON p.chapter_id = c.id
			WHERE c.volume_id IN (%s)
		)
		SELECT volume_id, page_id FROM RankedPages WHERE rn = 1
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	results := make(map[string]string)
	for rows.Next() {
		var volumeID, pageID string
		if err := rows.Scan(&volumeID, &pageID); err != nil {
			return nil, err
		}
		results[volumeID] = pageID
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

// GetFirstVolumesBatch 여러 시리즈의 첫 번째 볼륨 조회
func (r *VolumeRepository) GetFirstVolumesBatch(db database.Queryer, seriesIDs []string) (map[string]*model.Volume, error) {
	if len(seriesIDs) == 0 {
		return make(map[string]*model.Volume), nil
	}
	db = database.GetQueryer(db)

	placeholders := make([]string, len(seriesIDs))
	args := make([]interface{}, len(seriesIDs))
	for i, id := range seriesIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		WITH RankedVolumes AS (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY volume_number) AS rn
			FROM volumes
			WHERE series_id IN (%s)
		)
		SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at
		FROM RankedVolumes
		WHERE rn = 1
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	results := make(map[string]*model.Volume)
	for rows.Next() {
		var v model.Volume
		var thumbnail, unit, parentID sql.NullString
		var description, authors, pubYear, extension sql.NullString

		err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt)
		if err != nil {
			return nil, err
		}

		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if parentID.Valid {
			v.ParentID = &parentID.String
		}
		if description.Valid {
			v.Description = description.String
		}
		if authors.Valid {
			v.Authors = authors.String
		}
		if pubYear.Valid {
			v.PublicationYear = pubYear.String
		}
		if extension.Valid {
			v.Extension = extension.String
		}
		results[v.SeriesID] = &v
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}
