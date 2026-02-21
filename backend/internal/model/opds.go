package model

import (
	"encoding/xml"
	"time"
)

// OPDS XML 네임스페이스 상수
const (
	AtomNamespace = "http://www.w3.org/2005/Atom"
	OPDSNamespace = "http://opds-spec.org/2010/catalog"
)

// Feed OPDS 최상위 피드
type Feed struct {
	XMLName xml.Name `xml:"http://www.w3.org/2005/Atom feed"`
	ID      string   `xml:"id"`
	Title   string   `xml:"title"`
	Updated time.Time `xml:"updated"`
	Author  *Author  `xml:"author,omitempty"`
	Links   []Link   `xml:"link"`
	Entries []Entry  `xml:"entry"`
}

// Author 저자 정보
type Author struct {
	Name string `xml:"name"`
	URI  string `xml:"uri,omitempty"`
}

// Link 피드 및 엔트리 링크
type Link struct {
	Rel  string `xml:"rel,attr"`
	Type string `xml:"type,attr,omitempty"`
	Href string `xml:"href,attr"`
	Title string `xml:"title,attr,omitempty"`
}

// Entry 개별 엔트리 (시리즈, 권, 챕터 등)
type Entry struct {
	ID        string    `xml:"id"`
	Title     string    `xml:"title"`
	Updated   time.Time `xml:"updated"`
	Content   *Content  `xml:"content,omitempty"`
	Links     []Link    `xml:"link"`
	Summary   string    `xml:"summary,omitempty"`
	Author    *Author   `xml:"author,omitempty"`
}

// Content 엔트리 내용
type Content struct {
	Type string `xml:"type,attr"`
	Body string `xml:",chardata"`
}
