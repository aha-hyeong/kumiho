package handler

import "testing"

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
}
