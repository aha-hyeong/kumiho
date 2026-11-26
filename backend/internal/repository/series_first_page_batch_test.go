package repository

import (
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
)

// 묶음 첫 페이지 조회는 단건 조회(GetFirstPageID)와 같은 페이지를 골라야 한다.
func TestGetFirstPageIDsBatchMatchesScalar(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "first-page.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	for _, q := range []string{
		`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`,
		`INSERT INTO series(id,library_id,title,path) VALUES ('ordered','lib','A','/a'),('pdf-first','lib','B','/b'),('chapters','lib','C','/c'),('no-pages','lib','D','/d'),('no-volumes','lib','E','/e')`,
		// 권 번호 순서: 나중에 넣은 1권이 먼저, 그 안에서도 페이지 번호 순서
		`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('a2','ordered','2',2,'/a2'),('a1','ordered','1',1,'/a1')`,
		`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('a2c','a2','c',1,'/a2c',2),('a1c','a1','c',1,'/a1c',2)`,
		`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('a2p1','a2c',1,'/'),('a1p2','a1c',2,'/'),('a1p1','a1c',1,'/')`,
		// 1권은 페이지가 없는 PDF, 2권에 페이지가 있음
		`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('b1','pdf-first','1',1,'/b1'),('b2','pdf-first','2',2,'/b2')`,
		`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('b1c','b1','c',1,'/b1c.pdf',0),('b2c','b2','c',1,'/b2c',1)`,
		`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('b2p1','b2c',1,'/')`,
		// 한 권 안의 화 번호 순서
		`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('c1','chapters','1',1,'/c1')`,
		`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('c1-3','c1','3',3,'/c13',1),('c1-1','c1','1',1,'/c11',1)`,
		`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('c3p1','c1-3',1,'/'),('c1p1','c1-1',1,'/')`,
		// 페이지가 하나도 없는 시리즈
		`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('d1','no-pages','1',1,'/d1')`,
		`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('d1c','d1','c',1,'/d1c.pdf',0)`,
	} {
		if _, err := database.DB.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	repo := NewSeriesRepository()
	ids := []string{"ordered", "pdf-first", "chapters", "no-pages", "no-volumes"}
	got, err := repo.GetFirstPageIDsBatch(nil, ids)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"ordered": "a1p1", "pdf-first": "b2p1", "chapters": "c1p1"}
	if len(got) != len(want) {
		t.Errorf("batch result = %v, want %v", got, want)
	}
	for _, id := range ids {
		scalar, _ := repo.GetFirstPageID(nil, id)
		if got[id] != want[id] || got[id] != scalar {
			t.Errorf("%s: batch=%q scalar=%q want=%q", id, got[id], scalar, want[id])
		}
	}
}
