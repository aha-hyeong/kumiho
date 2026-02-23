package util

import (
	"fmt"
	"image/jpeg"
	"os"

	"github.com/gen2brain/go-fitz"
)

// GetPdfPageCount PDF 파일의 전체 페이지 수를 반환합니다.
func GetPdfPageCount(pdfPath string) (int, error) {
	doc, err := fitz.New(pdfPath)
	if err != nil {
		return 0, fmt.Errorf("could not open PDF file: %w", err)
	}
	defer doc.Close()

	return doc.NumPage(), nil
}

// ExtractPdfThumbnail PDF 파일의 첫 페이지를 이미지로 추출하여 저장합니다.
func ExtractPdfThumbnail(pdfPath, outPath string) error {
	doc, err := fitz.New(pdfPath)
	if err != nil {
		return fmt.Errorf("could not open PDF file: %w", err)
	}
	defer doc.Close()

	if doc.NumPage() == 0 {
		return fmt.Errorf("PDF file has no pages")
	}

	// 첫 페이지를 라이브러리 기본 해상도로 렌더링
	img, err := doc.Image(0)
	if err != nil {
		return fmt.Errorf("could not render first page: %w", err)
	}

	out, err := os.Create(outPath)
	if err != nil {
		return fmt.Errorf("could not create output file: %w", err)
	}
	defer out.Close()

	// JPEG로 인코딩 (품질 90), 실패 시 생성된 파일 삭제
	if err := jpeg.Encode(out, img, &jpeg.Options{Quality: 90}); err != nil {
		os.Remove(outPath)
		return fmt.Errorf("could not encode image: %w", err)
	}

	return nil
}
