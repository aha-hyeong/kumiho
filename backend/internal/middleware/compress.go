package middleware

import (
	"bytes"
	"compress/gzip"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

// compressMinBytes 이보다 작은 응답은 gzip 헤더 비용이 더 커서 압축하지 않는다.
const compressMinBytes = 1024

var gzipWriterPool = sync.Pool{
	New: func() any {
		// NAS CPU 부담을 줄이려고 가장 빠른 단계를 쓴다. JSON은 이 단계에서도 크게 줄어든다.
		w, _ := gzip.NewWriterLevel(nil, gzip.BestSpeed)
		return w
	},
}

// Compress 메모리에 담긴 텍스트 응답(JSON, HTML, CSS, JS, SVG)을 gzip으로 압축한다.
// 스트림 응답(SSE, 파일 전송), 부분 응답(206), 이미 인코딩된 응답, 이미지 같은
// 바이너리 응답은 그대로 둔다.
func Compress() fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := c.Next(); err != nil {
			return err
		}
		compressResponse(c)
		return nil
	}
}

func compressResponse(c *fiber.Ctx) {
	resp := c.Response()
	if c.Method() == fiber.MethodHead || !c.Request().Header.HasAcceptEncoding("gzip") {
		return
	}
	status := resp.StatusCode()
	if status < 200 || status == fiber.StatusNoContent || status == fiber.StatusPartialContent || status == fiber.StatusNotModified {
		return
	}
	if resp.IsBodyStream() || len(resp.Header.ContentEncoding()) > 0 || !isCompressibleContentType(string(resp.Header.ContentType())) {
		return
	}
	body := resp.Body()
	if len(body) < compressMinBytes {
		return
	}

	var buf bytes.Buffer
	buf.Grow(len(body) / 4)
	w, ok := gzipWriterPool.Get().(*gzip.Writer)
	if !ok || w == nil {
		return
	}
	w.Reset(&buf)
	_, writeErr := w.Write(body)
	closeErr := w.Close()
	gzipWriterPool.Put(w)
	if writeErr != nil || closeErr != nil || buf.Len() >= len(body) {
		return
	}

	resp.SetBodyRaw(buf.Bytes())
	resp.Header.SetContentEncoding("gzip")
	resp.Header.Add(fiber.HeaderVary, fiber.HeaderAcceptEncoding)
}

func isCompressibleContentType(contentType string) bool {
	mediaType := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	switch {
	case mediaType == "text/event-stream":
		return false
	case strings.HasPrefix(mediaType, "text/"):
		return true
	case mediaType == "application/json", mediaType == "application/javascript", mediaType == "image/svg+xml":
		return true
	case strings.HasSuffix(mediaType, "+json"):
		return true
	}
	return false
}
