package version

import "testing"

func TestIsPrerelease(t *testing.T) {
	t.Parallel()

	if !IsPrerelease("v0.12.4-beta.1") {
		t.Fatal("expected beta version to be prerelease")
	}

	if IsPrerelease("v0.12.4") {
		t.Fatal("expected stable version to not be prerelease")
	}

	if IsPrerelease("v0.12.4+build-1") {
		t.Fatal("expected build metadata version to not be prerelease")
	}
}

func TestCompare(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		a    string
		b    string
		want int
	}{
		{
			name: "same version",
			a:    "v0.12.4",
			b:    "v0.12.4",
			want: 0,
		},
		{
			name: "stable newer than older stable",
			a:    "v0.12.4",
			b:    "v0.12.3",
			want: 1,
		},
		{
			name: "stable newer than prerelease of same version",
			a:    "v0.12.4",
			b:    "v0.12.4-beta.2",
			want: 1,
		},
		{
			name: "newer beta wins",
			a:    "v0.12.4-beta.2",
			b:    "v0.12.4-beta.1",
			want: 1,
		},
		{
			name: "higher patch beta wins over lower stable",
			a:    "v0.12.4-beta.1",
			b:    "v0.12.3",
			want: 1,
		},
		{
			name: "build metadata ignored for equality",
			a:    "v0.12.4+build-1",
			b:    "v0.12.4+build-2",
			want: 0,
		},
		{
			name: "large numeric prerelease identifiers compare without overflow",
			a:    "v0.12.4-beta.999999999999999999999",
			b:    "v0.12.4-beta.2",
			want: 1,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := Compare(tt.a, tt.b)
			if err != nil {
				t.Fatalf("Compare returned error: %v", err)
			}

			if got != tt.want {
				t.Fatalf("Compare(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestCompareInvalidVersions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		a    string
		b    string
	}{
		{
			name: "missing patch version",
			a:    "v1.2",
			b:    "v1.2.3",
		},
		{
			name: "empty prerelease identifier",
			a:    "v1.2.3-",
			b:    "v1.2.3",
		},
		{
			name: "leading zero in major",
			a:    "v01.2.3",
			b:    "v1.2.3",
		},
		{
			name: "empty prerelease segment",
			a:    "v1.2.3-.1",
			b:    "v1.2.3",
		},
		{
			name: "invalid prerelease characters",
			a:    "v1.2.3-beta_test",
			b:    "v1.2.3",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if _, err := Compare(tt.a, tt.b); err == nil {
				t.Fatalf("Compare(%q, %q) expected error, got nil", tt.a, tt.b)
			}
		})
	}
}
