package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

func TestHomeEnrichmentDoesNotRepairPDFOrReadEbook(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "home.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	pdf := filepath.Join(t.TempDir(), "broken.pdf")
	if err := os.WriteFile(pdf, []byte("not a PDF"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`, nil},
		{`INSERT INTO series(id,library_id,title,path,thumbnail_path) VALUES ('s','lib','S','/s','/cover.jpg')`, nil},
		{`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('v','s','V',1,'/v')`, nil},
		{`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('c','v','C',1,?,0)`, []any{pdf}},
	} {
		if _, err := database.DB.Exec(row.query, row.args...); err != nil {
			t.Fatal(err)
		}
	}
	repo := repository.NewSeriesRepository()
	cards, err := repo.FindByIDs(nil, []string{"s"}, "")
	if err != nil {
		t.Fatal(err)
	}
	svc := NewSeriesEnrichService(repo, repository.NewChapterRepository(), repository.NewVolumeRepository())
	if err = svc.EnrichHomeList(cards, ""); err != nil {
		t.Fatal(err)
	}
	var pageCount int
	if err = database.DB.QueryRow(`SELECT page_count FROM chapters WHERE id='c'`).Scan(&pageCount); err != nil {
		t.Fatal(err)
	}
	if pageCount != 0 || cards[0].TotalPageCount != 0 || cards[0].ThumbnailURL == nil {
		t.Fatalf("PDF repair or thumbnail regression: count=%d card=%+v", pageCount, cards[0])
	}
	svc.EnrichList(cards, "")
	svc.EnrichSingle(&cards[0], "")
	if err = database.DB.QueryRow(`SELECT page_count FROM chapters WHERE id='c'`).Scan(&pageCount); err != nil {
		t.Fatal(err)
	}
	if pageCount != 0 || cards[0].TotalPageCount != 0 {
		t.Fatalf("regular enrichment mutated PDF: count=%d card=%+v", pageCount, cards[0])
	}
}
