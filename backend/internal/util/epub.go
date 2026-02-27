package util

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
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
	Metadata struct {
		Title       []string `xml:"title"`
		Creator     []string `xml:"creator"`
		Description []string `xml:"description"`
		Publisher   []string `xml:"publisher"`
		Date        []string `xml:"date"`
		Subject     []string `xml:"subject"`
		Identifier  []struct {
			ID     string `xml:"id,attr"`
			Scheme string `xml:"scheme,attr"`
			Value  string `xml:",chardata"`
		} `xml:"identifier"`
		Meta []struct {
			Property string `xml:"property,attr"`
			Name     string `xml:"name,attr"`
			Content  string `xml:"content,attr"`
			Refines  string `xml:"refines,attr"`
			Value    string `xml:",chardata"`
		} `xml:"meta"`
	} `xml:"metadata"`
	Manifest struct {
		Item []struct {
			ID         string `xml:"id,attr"`
			Href       string `xml:"href,attr"`
			MediaType  string `xml:"media-type,attr"`
			Properties string `xml:"properties,attr"`
		} `xml:"item"`
	} `xml:"manifest"`
}

type EpubMetadata struct {
	Title          string
	Creator        string
	Description    string
	Publisher      string
	Date           string
	Subjects       []string
	ISBN           string
	CoverPathInZip string
	CoverMediaType string
}

var (
	isbnTextPattern = regexp.MustCompile(`(?i)\b(?:ISBN(?:-1[03])?\s*[:：]?\s*)?([0-9Xx][0-9Xx\-\s]{8,}[0-9Xx])\b`)
	yearPattern     = regexp.MustCompile(`\b(19|20)\d{2}\b`)
)

// EpubPositionStride EPUB 가상 포지션 계산 단위 (6KB)
const EpubPositionStride = 6144

// CalculateEpubVirtualPositions EPUB의 HTML 파일들의 무압축 용량을 합산하여 가상 포지션을 계산합니다.
// 6KB = 1포지션 (약 2,000~2,200자 기준, 종이책 페이지 느낌 부여)
func CalculateEpubVirtualPositions(epubPath string) (int64, int, error) {
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		return 0, 0, err
	}
	defer r.Close()

	// 1. container.xml에서 opf 경로 찾기
	_, opfDir, opf, err := readPackageInfo(r)
	if err != nil {
		return 0, 0, err
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

	// 4. 가상 포지션 계산 (6KB = 1 position, 올림 처리, 최소 1)
	if totalBytes == 0 {
		return 0, 0, fmt.Errorf("no readable text content (HTML/XHTML) found or total bytes is 0")
	}

	totalPositions := int((totalBytes + EpubPositionStride - 1) / EpubPositionStride)
	return totalBytes, totalPositions, nil
}

// ExtractEpubMetadata OPF 기준 EPUB 메타데이터를 추출합니다.
func ExtractEpubMetadata(epubPath string) (*EpubMetadata, error) {
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	_, opfDir, opf, err := readPackageInfo(r)
	if err != nil {
		return nil, err
	}

	meta := &EpubMetadata{
		Title:       firstNonEmpty(opf.Metadata.Title),
		Creator:     firstNonEmpty(opf.Metadata.Creator),
		Description: firstNonEmpty(opf.Metadata.Description),
		Publisher:   firstNonEmpty(opf.Metadata.Publisher),
		Date:        firstNonEmpty(opf.Metadata.Date),
		Subjects:    nonEmptyList(opf.Metadata.Subject),
	}

	isbn := extractISBNFromIdentifiers(opf.Metadata.Identifier)
	if isbn == "" {
		isbn = extractISBNFromText(meta.Description)
	}
	meta.ISBN = isbn

	coverHref, coverMediaType := findCoverItem(opf)
	if coverHref != "" {
		if opfDir != "." {
			coverHref = filepath.Join(opfDir, coverHref)
		}
		meta.CoverPathInZip = filepath.ToSlash(coverHref)
		meta.CoverMediaType = coverMediaType
	}

	// 일부 EPUB은 식별자에 ISBN이 없어서 저작권 페이지에서 보강
	if meta.ISBN == "" {
		if fallbackISBN, ok := extractISBNFromLikelyFrontmatter(r); ok {
			meta.ISBN = fallbackISBN
		}
	}

	return meta, nil
}

// ExtractEpubCover EPUB 커버 이미지를 추출합니다.
// 반환값: image bytes, media type
func ExtractEpubCover(epubPath string) ([]byte, string, error) {
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		return nil, "", err
	}
	defer r.Close()

	_, opfDir, opf, err := readPackageInfo(r)
	if err != nil {
		return nil, "", err
	}

	coverHref, coverMediaType := findCoverItem(opf)
	if coverHref == "" {
		return nil, "", fmt.Errorf("cover not found in epub metadata")
	}
	if opfDir != "." {
		coverHref = filepath.Join(opfDir, coverHref)
	}
	coverPath := filepath.ToSlash(coverHref)

	for _, f := range r.File {
		if f.Name != coverPath {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, "", err
		}
		defer rc.Close()
		b, err := io.ReadAll(rc)
		if err != nil {
			return nil, "", err
		}
		return b, coverMediaType, nil
	}

	return nil, "", fmt.Errorf("cover file not found: %s", coverPath)
}

func readPackageInfo(r *zip.ReadCloser) (string, string, *OpfXml, error) {
	var container ContainerXml
	cf, err := r.Open("META-INF/container.xml")
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to open container.xml: %w", err)
	}
	defer cf.Close()

	if err := xml.NewDecoder(cf).Decode(&container); err != nil {
		return "", "", nil, fmt.Errorf("failed to decode container.xml: %w", err)
	}
	if len(container.Rootfiles.Rootfile) == 0 {
		return "", "", nil, fmt.Errorf("no rootfile found in container.xml")
	}

	opfPath := container.Rootfiles.Rootfile[0].FullPath
	opfDir := filepath.Dir(opfPath)

	var opf OpfXml
	of, err := r.Open(opfPath)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to open opf file (%s): %w", opfPath, err)
	}
	defer of.Close()
	if err := xml.NewDecoder(of).Decode(&opf); err != nil {
		return "", "", nil, fmt.Errorf("failed to decode opf file: %w", err)
	}

	return opfPath, opfDir, &opf, nil
}

func firstNonEmpty(values []string) string {
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" {
			return v
		}
	}
	return ""
}

func nonEmptyList(values []string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func extractISBNFromIdentifiers(identifiers []struct {
	ID     string `xml:"id,attr"`
	Scheme string `xml:"scheme,attr"`
	Value  string `xml:",chardata"`
}) string {
	for _, id := range identifiers {
		candidate := strings.TrimSpace(id.Value)
		if candidate == "" {
			continue
		}
		normalized := normalizeISBN(candidate)
		if normalized != "" {
			return normalized
		}
	}
	return ""
}

func normalizeISBN(raw string) string {
	m := isbnTextPattern.FindStringSubmatch(raw)
	if len(m) < 2 {
		return ""
	}
	candidate := strings.ToUpper(strings.TrimSpace(m[1]))
	candidate = strings.NewReplacer("-", "", " ", "").Replace(candidate)
	if len(candidate) == 10 || len(candidate) == 13 {
		return candidate
	}
	// YYYY 같은 숫자가 잘못 잡히는 경우 방지
	if yearPattern.MatchString(candidate) && len(candidate) < 10 {
		return ""
	}
	return ""
}

func extractISBNFromText(text string) string {
	return normalizeISBN(text)
}

func findCoverItem(opf *OpfXml) (string, string) {
	if opf == nil {
		return "", ""
	}
	itemsByID := make(map[string]struct {
		Href      string
		MediaType string
	})
	for _, item := range opf.Manifest.Item {
		itemsByID[item.ID] = struct {
			Href      string
			MediaType string
		}{Href: item.Href, MediaType: item.MediaType}
	}

	// EPUB3 표준: properties="cover-image"
	for _, item := range opf.Manifest.Item {
		if strings.Contains(strings.ToLower(item.Properties), "cover-image") {
			return item.Href, item.MediaType
		}
	}

	// EPUB2 관례: <meta name="cover" content="cover-id">
	for _, m := range opf.Metadata.Meta {
		if strings.EqualFold(strings.TrimSpace(m.Name), "cover") {
			coverID := strings.TrimSpace(m.Content)
			if coverID == "" {
				continue
			}
			if item, ok := itemsByID[coverID]; ok {
				return item.Href, item.MediaType
			}
		}
	}

	// fallback: id/href에 cover 문자열이 포함된 이미지
	for _, item := range opf.Manifest.Item {
		if !strings.HasPrefix(strings.ToLower(item.MediaType), "image/") {
			continue
		}
		idL := strings.ToLower(item.ID)
		hrefL := strings.ToLower(item.Href)
		if strings.Contains(idL, "cover") || strings.Contains(hrefL, "cover") {
			return item.Href, item.MediaType
		}
	}

	return "", ""
}

func extractISBNFromLikelyFrontmatter(r *zip.ReadCloser) (string, bool) {
	for _, f := range r.File {
		name := strings.ToLower(f.Name)
		if !strings.HasSuffix(name, ".html") && !strings.HasSuffix(name, ".xhtml") {
			continue
		}
		if !strings.Contains(name, "copyright") && !strings.Contains(name, "colophon") && !strings.Contains(name, "title") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		b, readErr := io.ReadAll(rc)
		_ = rc.Close()
		if readErr != nil {
			continue
		}
		if isbn := normalizeISBN(string(b)); isbn != "" {
			return isbn, true
		}
	}
	return "", false
}
