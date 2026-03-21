package version

import (
	"fmt"
	"strconv"
	"strings"
)

type parsedVersion struct {
	major      int
	minor      int
	patch      int
	prerelease []string
}

func IsPrerelease(v string) bool {
	pv, err := parse(v)
	if err != nil {
		return false
	}
	return len(pv.prerelease) > 0
}

func Compare(a, b string) (int, error) {
	parsedA, err := parse(a)
	if err != nil {
		return 0, err
	}

	parsedB, err := parse(b)
	if err != nil {
		return 0, err
	}

	if parsedA.major != parsedB.major {
		if parsedA.major < parsedB.major {
			return -1, nil
		}
		return 1, nil
	}

	if parsedA.minor != parsedB.minor {
		if parsedA.minor < parsedB.minor {
			return -1, nil
		}
		return 1, nil
	}

	if parsedA.patch != parsedB.patch {
		if parsedA.patch < parsedB.patch {
			return -1, nil
		}
		return 1, nil
	}

	return comparePrerelease(parsedA.prerelease, parsedB.prerelease), nil
}

func parse(raw string) (*parsedVersion, error) {
	value := strings.TrimPrefix(strings.TrimSpace(raw), "v")
	if value == "" {
		return nil, fmt.Errorf("invalid version: %q", raw)
	}

	if idx := strings.Index(value, "+"); idx >= 0 {
		value = value[:idx]
	}

	core := value
	var prerelease []string
	if idx := strings.Index(value, "-"); idx >= 0 {
		core = value[:idx]
		prerelease = strings.Split(value[idx+1:], ".")
	}

	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid version: %q", raw)
	}

	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return nil, fmt.Errorf("invalid major version %q: %w", raw, err)
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid minor version %q: %w", raw, err)
	}
	patch, err := strconv.Atoi(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid patch version %q: %w", raw, err)
	}

	return &parsedVersion{
		major:      major,
		minor:      minor,
		patch:      patch,
		prerelease: prerelease,
	}, nil
}

func comparePrerelease(a, b []string) int {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	if len(a) == 0 {
		return 1
	}
	if len(b) == 0 {
		return -1
	}

	maxLen := len(a)
	if len(b) > maxLen {
		maxLen = len(b)
	}

	for i := 0; i < maxLen; i++ {
		if i >= len(a) {
			return -1
		}
		if i >= len(b) {
			return 1
		}

		partA := a[i]
		partB := b[i]
		if partA == partB {
			continue
		}

		numA, errA := strconv.Atoi(partA)
		numB, errB := strconv.Atoi(partB)

		switch {
		case errA == nil && errB == nil:
			if numA < numB {
				return -1
			}
			return 1
		case errA == nil:
			return -1
		case errB == nil:
			return 1
		case partA < partB:
			return -1
		default:
			return 1
		}
	}

	return 0
}
