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
