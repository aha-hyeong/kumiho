package frontend

import (
	"embed"
	"io/fs"
	"net/http"
)

// DistFS 프론트엔드 빌드 결과물을 임베딩합니다.
// CI/CD 과정에서 web/dist 폴더가 이 위치로 복사됩니다.
//
//go:embed all:dist
var dist embed.FS

// GetFileSystem 임베딩된 정적 파일 시스템을 반환합니다.
func GetFileSystem() http.FileSystem {
	f, err := fs.Sub(dist, "dist")
	if err != nil {
		// dist 폴더가 없거나 문제가 생기면 패닉 대신 빈 파일 시스템을 반환하거나 로깅 처리 가능
		// 여기선 간단히 패닉 처리 (빌드 타임에 보장되므로)
		panic(err)
	}
	return http.FS(f)
}
