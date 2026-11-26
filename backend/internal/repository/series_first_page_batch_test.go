package repository

import (
	"database/sql"
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
		// 같은 권 번호에서 f0은 화 번호로 밀리고, f2는 권 ID로 밀린다.
		// f1 안에서는 화 ID "a", 그 안에서는 페이지 ID "a-page"가 먼저다.
		`INSERT INTO series(id,library_id,title,path) VALUES ('tie','lib','F','/f')`,
		`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('f2','tie','2',1,'/f2'),('f1','tie','1',1,'/f1'),('f0','tie','0',1,'/f0')`,
		`INSERT INTO chapters(id,volume_id,title,chapter_number,path) VALUES ('0','f2','170',170,'/f2c'),('z','f1','170',170,'/fz'),('a','f1','170',170,'/fa'),('late','f0','171',171,'/f0c')`,
		`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('f2-page','0',1,'/'),('z-page','z',1,'/'),('b-page','a',1,'/'),('a-page','a',1,'/'),('late-page','late',1,'/')`,
		// 상위 권에도 페이지가 있지만 하위 권의 권 번호가 더 작다.
		`INSERT INTO series(id,library_id,title,path) VALUES ('nested','lib','G','/g')`,
		`INSERT INTO volumes(id,series_id,title,volume_number,path,parent_id) VALUES ('parent','nested','2',2,'/parent',NULL),('child','nested','1',1,'/child','parent')`,
		`INSERT INTO chapters(id,volume_id,title,chapter_number,path) VALUES ('pc','parent','1',1,'/pc'),('cc','child','2',2,'/cc')`,
		`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('parent-page','pc',1,'/'),('child-page','cc',1,'/')`,
		// 페이지가 하나도 없는 시리즈
		`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('d1','no-pages','1',1,'/d1')`,
		`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('d1c','d1','c',1,'/d1c.pdf',0)`,
	} {
		if _, err := database.DB.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	repo := NewSeriesRepository()
	ids := []string{"ordered", "pdf-first", "chapters", "tie", "nested", "no-pages", "no-volumes"}
	got, err := repo.GetFirstPageIDsBatch(nil, ids)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"ordered": "a1p1", "pdf-first": "b2p1", "chapters": "c1p1", "tie": "a-page", "nested": "child-page"}
	if len(got) != len(want) {
		t.Errorf("batch result = %v, want %v", got, want)
	}
	const originalQuery = `SELECT p.id FROM pages p
		JOIN chapters c ON p.chapter_id = c.id
		JOIN volumes v ON c.volume_id = v.id
		WHERE v.series_id = ?
		ORDER BY v.volume_number, c.chapter_number, v.id, c.id, p.page_number, p.id LIMIT 1`
	for _, id := range ids {
		t.Run(id, func(t *testing.T) {
			var original string
			originalErr := database.DB.QueryRow(originalQuery, id).Scan(&original)
			scalar, err := repo.GetFirstPageID(nil, id)
			var wantErr error
			if _, ok := want[id]; !ok {
				wantErr = sql.ErrNoRows
			}
			if err != wantErr || originalErr != wantErr {
				t.Fatalf("scalar err=%v, original err=%v, want %v", err, originalErr, wantErr)
			}
			if scalar != original || scalar != got[id] || scalar != want[id] {
				t.Errorf("scalar=%q original=%q batch=%q want=%q", scalar, original, got[id], want[id])
			}
		})
	}
}

// 권 번호가 겹칠 때 단건 첫 볼륨과 묶음 첫 볼륨 썸네일이 같은 볼륨을 골라야 한다.
func TestFirstVolumeTieBreakMatchesBatch(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "first-volume.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	for _, q := range []string{
		`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`,
		`INSERT INTO series(id,library_id,title,path) VALUES ('s','lib','S','/s')`,
		`INSERT INTO volumes(id,series_id,title,volume_number,path,thumbnail_path) VALUES ('vz','s','z',1,'/vz','/z.jpg'),('va','s','a',1,'/va','/a.jpg')`,
	} {
		if _, err := database.DB.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	single, err := NewVolumeRepository().GetFirstVolume(nil, "s")
	if err != nil || single == nil {
		t.Fatalf("GetFirstVolume: %v %v", single, err)
	}
	batch, err := NewSeriesRepository().GetHomeFirstVolumeThumbnails(nil, []string{"s"})
	if err != nil {
		t.Fatal(err)
	}
	if single.ID != "va" || batch["s"].ID != single.ID {
		t.Fatalf("single=%q batch=%q, want both va", single.ID, batch["s"].ID)
	}
}
