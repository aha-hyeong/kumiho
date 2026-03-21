package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSelectLatestVersion(t *testing.T) {
	t.Parallel()

	releases := []githubRelease{
		{TagName: "v0.12.3"},
		{TagName: "v0.12.4-beta.1", Prerelease: true},
		{TagName: "v0.12.4-beta.2", Prerelease: true},
		{TagName: "v0.12.2"},
		{TagName: "v0.12.5-beta.1", Prerelease: true, Draft: true},
	}

	t.Run("stable channel ignores prereleases", func(t *testing.T) {
		t.Parallel()

		got := selectLatestVersion(releases, "v0.12.2")
		if got != "v0.12.3" {
			t.Fatalf("selectLatestVersion() = %q, want %q", got, "v0.12.3")
		}
	})

	t.Run("beta channel includes prereleases", func(t *testing.T) {
		t.Parallel()

		got := selectLatestVersion(releases, "v0.12.4-beta.1")
		if got != "v0.12.4-beta.2" {
			t.Fatalf("selectLatestVersion() = %q, want %q", got, "v0.12.4-beta.2")
		}
	})

	t.Run("beta channel prefers stable when same version exists", func(t *testing.T) {
		t.Parallel()

		releasesWithStable := []githubRelease{
			{TagName: "v0.12.3"},
			{TagName: "v0.12.4"},
			{TagName: "v0.12.4-beta.1", Prerelease: true},
			{TagName: "v0.12.4-beta.2", Prerelease: true},
			{TagName: "v0.12.5-beta.1", Prerelease: true, Draft: true},
		}

		got := selectLatestVersion(releasesWithStable, "v0.12.4-beta.2")
		if got != "v0.12.4" {
			t.Fatalf("selectLatestVersion() = %q, want %q", got, "v0.12.4")
		}
	})
}

func TestNewGitHubRequest(t *testing.T) {
	t.Parallel()

	req, err := newGitHubRequest("https://api.github.com/repos/aha-hyeong/kumiho/releases")
	if err != nil {
		t.Fatalf("newGitHubRequest() error = %v", err)
	}

	if got := req.Header.Get("User-Agent"); got == "" {
		t.Fatal("expected User-Agent header to be set")
	}

	if got := req.Header.Get("Accept"); got != "application/vnd.github+json" {
		t.Fatalf("Accept header = %q, want %q", got, "application/vnd.github+json")
	}
}

func TestFetchGitHubRelease(t *testing.T) {
	t.Parallel()

	var gotUserAgent string
	var gotAccept string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserAgent = r.Header.Get("User-Agent")
		gotAccept = r.Header.Get("Accept")

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v0.12.4"}`))
	}))
	defer server.Close()

	release, err := fetchGitHubRelease(server.Client(), server.URL)
	if err != nil {
		t.Fatalf("fetchGitHubRelease() error = %v", err)
	}

	if gotUserAgent == "" {
		t.Fatal("expected User-Agent header to be set")
	}

	if gotAccept != "application/vnd.github+json" {
		t.Fatalf("Accept header = %q, want %q", gotAccept, "application/vnd.github+json")
	}

	if release.TagName != "v0.12.4" {
		t.Fatalf("fetchGitHubRelease() tag = %q, want %q", release.TagName, "v0.12.4")
	}
}

func TestFetchLatestVersionWithClient(t *testing.T) {
	t.Run("stable channel uses latest endpoint", func(t *testing.T) {
		handler := NewSystemHandler(nil)
		latestCalls := 0
		releasesCalls := 0
		unexpectedPath := ""

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/releases/latest":
				latestCalls++
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"tag_name":"v0.12.4"}`))
			case "/releases":
				releasesCalls++
				w.WriteHeader(http.StatusInternalServerError)
			default:
				unexpectedPath = r.URL.Path
				http.NotFound(w, r)
			}
		}))
		defer server.Close()

		got, err := handler.fetchLatestVersionWithClient("v0.12.3", server.Client(), server.URL)
		if err != nil {
			t.Fatalf("fetchLatestVersionWithClient() error = %v", err)
		}

		if got != "v0.12.4" {
			t.Fatalf("fetchLatestVersionWithClient() = %q, want %q", got, "v0.12.4")
		}

		if latestCalls != 1 {
			t.Fatalf("latest endpoint calls = %d, want %d", latestCalls, 1)
		}

		if releasesCalls != 0 {
			t.Fatalf("releases endpoint calls = %d, want %d", releasesCalls, 0)
		}

		if unexpectedPath != "" {
			t.Fatalf("unexpected request path = %q", unexpectedPath)
		}
	})

	t.Run("beta channel uses releases list endpoint", func(t *testing.T) {
		handler := NewSystemHandler(nil)
		latestCalls := 0
		releasesCalls := 0
		unexpectedPath := ""

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/releases/latest":
				latestCalls++
				w.WriteHeader(http.StatusInternalServerError)
			case "/releases":
				releasesCalls++
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`[{"tag_name":"v0.12.4-beta.2","prerelease":true},{"tag_name":"v0.12.4-beta.1","prerelease":true}]`))
			default:
				unexpectedPath = r.URL.Path
				http.NotFound(w, r)
			}
		}))
		defer server.Close()

		got, err := handler.fetchLatestVersionWithClient("v0.12.4-beta.1", server.Client(), server.URL)
		if err != nil {
			t.Fatalf("fetchLatestVersionWithClient() error = %v", err)
		}

		if got != "v0.12.4-beta.2" {
			t.Fatalf("fetchLatestVersionWithClient() = %q, want %q", got, "v0.12.4-beta.2")
		}

		if releasesCalls != 1 {
			t.Fatalf("releases endpoint calls = %d, want %d", releasesCalls, 1)
		}

		if latestCalls != 0 {
			t.Fatalf("latest endpoint calls = %d, want %d", latestCalls, 0)
		}

		if unexpectedPath != "" {
			t.Fatalf("unexpected request path = %q", unexpectedPath)
		}
	})
}
