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

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("User-Agent"); got == "" {
			t.Fatal("expected User-Agent header to be set")
		}
		if got := r.Header.Get("Accept"); got != "application/vnd.github+json" {
			t.Fatalf("Accept header = %q, want %q", got, "application/vnd.github+json")
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v0.12.4"}`))
	}))
	defer server.Close()

	release, err := fetchGitHubRelease(server.Client(), server.URL)
	if err != nil {
		t.Fatalf("fetchGitHubRelease() error = %v", err)
	}

	if release.TagName != "v0.12.4" {
		t.Fatalf("fetchGitHubRelease() tag = %q, want %q", release.TagName, "v0.12.4")
	}
}
