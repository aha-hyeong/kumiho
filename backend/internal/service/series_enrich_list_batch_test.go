package service

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

// 라이브러리 목록 보정은 시리즈 수와 무관하게 묶음 수만큼만 쿼리해야 한다.
// 시리즈마다 쿼리하면 큰 라이브러리를 처음 열 때 NAS에서 프록시 타임아웃을 넘긴다.
func TestSeriesEnrichListBoundsQueryCount(t *testing.T) {
	for _, tc := range []struct {
		name         string
		count, total int
	}{
		// 표시 단위 1 + 집계 2 + 읽은 분량 1 (커버가 있으므로 썸네일 쿼리 없음)
		{name: "measured-list-size", count: 353, total: 4},
		// 표시 단위 1(900개 묶음) + 집계 2×2 + 읽은 분량 2
		{name: "chunk-boundary", count: 401, total: 7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, list, counts := progressListFixture(t, tc.count)
			svc.EnrichList(list, "list-reader")
			if counts.total != tc.total {
				t.Errorf("EnrichList executed %d queries for %d series, want %d", counts.total, tc.count, tc.total)
			}
			for _, s := range list {
				if s.TotalPageCount != 100 || s.VolumeCount != 1 || s.ChapterCount != 1 || s.ReadPageCount != 25 {
					t.Fatalf("series %s metrics changed: total=%d volumes=%d chapters=%d read=%d", s.ID, s.TotalPageCount, s.VolumeCount, s.ChapterCount, s.ReadPageCount)
				}
			}
		})
	}
}

func TestSeriesEnrichListMetricsFailureFallsBack(t *testing.T) {
	svc, list, counts := progressListFixture(t, 3)
	counts.failContains = "FROM volumes WHERE series_id IN ("
	svc.EnrichList(list, "list-reader")
	for _, s := range list {
		if s.TotalPageCount != 100 || s.VolumeCount != 1 || s.ChapterCount != 1 {
			t.Fatalf("series %s fallback metrics wrong: total=%d volumes=%d chapters=%d", s.ID, s.TotalPageCount, s.VolumeCount, s.ChapterCount)
		}
	}
}

// 묶음 보정 결과는 기존 단건 보정(EnrichSingle)과 같아야 한다.
func TestSeriesEnrichListMatchesSingleEnrichment(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "list-parity.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	stamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	for _, row := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`, nil},
		{`INSERT INTO users(id,username,nickname,password_hash) VALUES ('u','u','u','hash')`, nil},
		// 커버가 있는 시리즈
		{`INSERT INTO series(id,library_id,title,path,thumbnail_path) VALUES ('covered','lib','A','/a','/cover.jpg')`, nil},
		{`INSERT INTO volumes(id,series_id,title,volume_number,path,unit) VALUES ('covered-v','covered','V',1,'/a/v','volume')`, nil},
		{`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('covered-c','covered-v','C',1,'/a/c',30)`, nil},
		// 커버 없이 페이지가 있는 시리즈: 두 번째 권의 페이지를 먼저 넣어도 첫 권 첫 페이지를 골라야 한다.
		{`INSERT INTO series(id,library_id,title,path) VALUES ('paged','lib','B','/b')`, nil},
		{`INSERT INTO volumes(id,series_id,title,volume_number,path,unit) VALUES ('paged-v2','paged','V2',2,'/b/v2','chapter')`, nil},
		{`INSERT INTO volumes(id,series_id,title,volume_number,path,unit) VALUES ('paged-v1','paged','V1',1,'/b/v1','chapter')`, nil},
		{`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('paged-c2','paged-v2','C',1,'/b/c2',4)`, nil},
		{`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('paged-c1','paged-v1','C',1,'/b/c1',2)`, nil},
		{`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('paged-p2-1','paged-c2',1,'/b/c2/1.jpg')`, nil},
		{`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('paged-p1-2','paged-c1',2,'/b/c1/2.jpg')`, nil},
		{`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('paged-p1-1','paged-c1',1,'/b/c1/1.jpg')`, nil},
		// 페이지 없이 첫 볼륨 썸네일만 있는 시리즈(PDF 등)와 EPUB 위치 단위
		{`INSERT INTO series(id,library_id,title,path) VALUES ('volthumb','lib','C','/c')`, nil},
		{`INSERT INTO volumes(id,series_id,title,volume_number,path,thumbnail_path,thumbnail_version,updated_at) VALUES ('volthumb-v','volthumb','V',1,'/c/v','/c/thumb.jpg',3,?)`, []any{stamp}},
		{`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count,total_positions) VALUES ('volthumb-c','volthumb-v','C',1,'/c/c',0,250)`, nil},
		// 썸네일 후보가 전혀 없고 오디오 길이를 단위로 쓰는 시리즈
		{`INSERT INTO series(id,library_id,title,path) VALUES ('audio','lib','D','/d')`, nil},
		{`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('audio-v','audio','V',1,'/d/v')`, nil},
		{`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count,duration,has_audio) VALUES ('audio-c','audio-v','C',1,'/d/c',0,600,1)`, nil},
		// 볼륨이 하나도 없는 시리즈
		{`INSERT INTO series(id,library_id,title,path) VALUES ('empty','lib','E','/e')`, nil},
		{`INSERT INTO reading_progress(id,user_id,series_id,volume_id,chapter_id,current_page,total_pages,progress_percent) VALUES ('rp','u','paged','paged-v1','paged-c1',1,2,50)`, nil},
	} {
		if _, err := database.DB.Exec(row.query, row.args...); err != nil {
			t.Fatalf("%s: %v", row.query, err)
		}
	}

	repo := repository.NewSeriesRepository()
	svc := NewSeriesEnrichService(repo, repository.NewChapterRepository(), repository.NewVolumeRepository())
	batched, err := repo.FindByLibraryID(nil, "lib", "u")
	if err != nil {
		t.Fatal(err)
	}
	single, err := repo.FindByLibraryID(nil, "lib", "u")
	if err != nil {
		t.Fatal(err)
	}
	svc.EnrichList(batched, "u")
	for i := range single {
		svc.EnrichSingle(&single[i], "u")
	}

	if len(batched) != 5 || len(single) != len(batched) {
		t.Fatalf("unexpected fixture size: batched=%d single=%d", len(batched), len(single))
	}
	for i := range batched {
		if !reflect.DeepEqual(batched[i], single[i]) {
			t.Errorf("series %s differs:\n batched=%+v\n  single=%+v", batched[i].ID, cardSummary(batched[i]), cardSummary(single[i]))
		}
	}

	byID := map[string]model.Series{}
	for _, s := range batched {
		byID[s.ID] = s
	}
	if url := byID["paged"].ThumbnailURL; url == nil || *url != "/api/v1/pages/paged-p1-1/image?width=400" {
		t.Errorf("paged thumbnail = %v, want first page of first volume", url)
	}
	if byID["volthumb"].ThumbnailURL == nil || byID["volthumb"].TotalPageCount != 250 {
		t.Errorf("volume thumbnail fallback or EPUB units wrong: %+v", cardSummary(byID["volthumb"]))
	}
	if byID["audio"].ThumbnailURL != nil || byID["audio"].TotalPageCount != 600 {
		t.Errorf("audio card wrong: %+v", cardSummary(byID["audio"]))
	}
	if e := byID["empty"]; e.ThumbnailURL != nil || e.VolumeCount != 0 || e.ChapterCount != 0 || e.TotalPageCount != 0 || e.DisplayUnit != "" {
		t.Errorf("empty series card wrong: %+v", cardSummary(e))
	}
	if p := byID["paged"]; p.ReadPageCount != 1 || p.VolumeCount != 2 || p.ChapterCount != 2 || p.TotalPageCount != 6 || p.DisplayUnit != "chapter" {
		t.Errorf("paged metrics wrong: %+v", cardSummary(p))
	}
}

func cardSummary(s model.Series) map[string]any {
	thumbnail := "<nil>"
	if s.ThumbnailURL != nil {
		thumbnail = *s.ThumbnailURL
	}
	return map[string]any{
		"thumbnail": thumbnail, "total": s.TotalPageCount, "read": s.ReadPageCount,
		"volumes": s.VolumeCount, "chapters": s.ChapterCount, "unit": s.DisplayUnit,
	}
}
