package util

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"path/filepath"
	"strings"
)

// ContainerXml META-INF/container.xml structure
type ContainerXml struct {
	XMLName   xml.Name `xml:"container"`
	Rootfiles struct {
		Rootfile []struct {
			FullPath string `xml:"full-path,attr"`
		} `xml:"rootfile"`
	} `xml:"rootfiles"`
}

// OpfXml .opf file structure (simplified)
type OpfXml struct {
	XMLName  xml.Name `xml:"package"`
	Manifest struct {
		Item []struct {
			ID        string `xml:"id,attr"`
			Href      string `xml:"href,attr"`
			MediaType string `xml:"media-type,attr"`
		} `xml:"item"`
	} `xml:"manifest"`
}

// CalculateEpubVirtualPositions EPUB의 HTML 파일들의 무압축 용량을 합산하여 가상 포지션을 계산합니다.
// 6KB = 1포지션 (약 2,000~2,200자 기준, 종이책 페이지 느낌 부여)
func CalculateEpubVirtualPositions(epubPath string) (int64, int, error) {
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		return 0, 0, err
	}
	defer r.Close()

	// 1. container.xml에서 opf 경로 찾기
	var container ContainerXml
	cf, err := r.Open("META-INF/container.xml")
	if err != nil {
		return 0, 0, fmt.Errorf("failed to open container.xml: %w", err)
	}
	defer cf.Close()

	err = xml.NewDecoder(cf).Decode(&container)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to decode container.xml: %w", err)
	}

	if len(container.Rootfiles.Rootfile) == 0 {
		return 0, 0, fmt.Errorf("no rootfile found in container.xml")
	}

	opfPath := container.Rootfiles.Rootfile[0].FullPath
	opfDir := filepath.Dir(opfPath)

	// 2. opf 파일 파싱하여 매니페스트 아이템 확인
	var opf OpfXml
	of, err := r.Open(opfPath)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to open opf file (%s): %w", opfPath, err)
	}
	defer of.Close()

	if err := xml.NewDecoder(of).Decode(&opf); err != nil {
		return 0, 0, fmt.Errorf("failed to decode opf file: %w", err)
	}

	// 3. HTML/XHTML 파일들의 용량 합계 계산
	var totalBytes int64
	htmlFiles := make(map[string]bool)
	for _, item := range opf.Manifest.Item {
		mt := strings.ToLower(item.MediaType)
		if mt == "application/xhtml+xml" || mt == "text/html" {
			// 상대 경로를 절대 경로(zip 내)로 변환
			fullPath := item.Href
			if opfDir != "." {
				fullPath = filepath.Join(opfDir, item.Href)
			}
			// Windows 경로 구분자 처리 (zip은 항상 / 사용)
			fullPath = filepath.ToSlash(fullPath)
			htmlFiles[fullPath] = true
		}
	}

	for _, f := range r.File {
		if htmlFiles[f.Name] {
			totalBytes += int64(f.UncompressedSize64)
		}
	}

	// 4. 가상 포지션 계산 (6KB = 1 position, 최소 1)
	totalPositions := int(totalBytes / 6144)
	if totalPositions == 0 && totalBytes > 0 {
		totalPositions = 1
	}

	return totalBytes, totalPositions, nil
}
