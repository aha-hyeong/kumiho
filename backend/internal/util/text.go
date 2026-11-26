package util

import (
	"bytes"
	"errors"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/korean"
)

// ErrUnsupportedTextEncoding is returned when a text file's encoding cannot be safely determined or supported.
var ErrUnsupportedTextEncoding = errors.New("unsupported text encoding")

// ErrNoReadableTextContent is returned when a text file has no parseable text (e.g. empty or only spaces).
var ErrNoReadableTextContent = errors.New("txt has no readable content")

// DecodeRawText safely decodes a raw byte slice into a normalized Go string.
// Currently supports UTF-8 and CP949 (EUC-KR).
// Returns the decoded string and the determined encoding name, or an error if the encoding is unsupported.
func DecodeRawText(raw []byte) (string, string, error) {
	if bytes.HasPrefix(raw, []byte{0xFF, 0xFE}) || bytes.HasPrefix(raw, []byte{0xFE, 0xFF}) {
		// Explicitly reject UTF-16 BOMs
		return "", "", ErrUnsupportedTextEncoding
	}

	// Remove UTF-8 BOM if present
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})

	if utf8.Valid(raw) {
		return NormalizeDecodedText(string(raw)), "utf-8", nil
	}

	// Fallback to CP949 (EUC-KR) decoder
	decoded, err := korean.EUCKR.NewDecoder().Bytes(raw)
	if err != nil {
		return "", "", ErrUnsupportedTextEncoding
	}

	return NormalizeDecodedText(string(decoded)), "cp949", nil
}

// NormalizeDecodedText standardizes line endings to \n.
func NormalizeDecodedText(content string) string {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	return strings.ReplaceAll(normalized, "\r", "\n")
}
