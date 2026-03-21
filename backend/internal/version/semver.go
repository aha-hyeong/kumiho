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

func IsValid(v string) bool {
	_, err := parse(v)
	return err == nil
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
	}

	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid version: %q", raw)
	}

	major, err := parseNumericIdentifier(parts[0], raw)
	if err != nil {
		return nil, err
	}
	minor, err := parseNumericIdentifier(parts[1], raw)
	if err != nil {
		return nil, err
	}
	patch, err := parseNumericIdentifier(parts[2], raw)
	if err != nil {
		return nil, err
	}

	if idx := strings.Index(value, "-"); idx >= 0 {
		pr := value[idx+1:]
		if pr == "" {
			return nil, fmt.Errorf("invalid version: %q", raw)
		}
		prerelease = strings.Split(pr, ".")
		for _, id := range prerelease {
			if id == "" {
				return nil, fmt.Errorf("invalid version: %q", raw)
			}
			if !isValidPrereleaseIdentifier(id) {
				return nil, fmt.Errorf("invalid version: %q", raw)
			}
			if isNumeric(id) {
				if hasLeadingZero(id) {
					return nil, fmt.Errorf("invalid version: %q", raw)
				}
			}
		}
	}

	return &parsedVersion{
		major:      major,
		minor:      minor,
		patch:      patch,
		prerelease: prerelease,
	}, nil
}

func parseNumericIdentifier(value string, raw string) (int, error) {
	if value == "" || hasLeadingZero(value) {
		return 0, fmt.Errorf("invalid version: %q", raw)
	}

	number, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("invalid version: %q", raw)
	}
	if number < 0 {
		return 0, fmt.Errorf("invalid version: %q", raw)
	}

	return number, nil
}

func hasLeadingZero(value string) bool {
	return len(value) > 1 && strings.HasPrefix(value, "0")
}

func isNumeric(value string) bool {
	if value == "" {
		return false
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func isValidPrereleaseIdentifier(value string) bool {
	if value == "" {
		return false
	}
	for _, ch := range value {
		switch {
		case ch >= '0' && ch <= '9':
		case ch >= 'A' && ch <= 'Z':
		case ch >= 'a' && ch <= 'z':
		case ch == '-':
		default:
			return false
		}
	}
	return true
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

		isNumA := isNumeric(partA)
		isNumB := isNumeric(partB)

		switch {
		case isNumA && isNumB:
			numA, _ := strconv.Atoi(partA)
			numB, _ := strconv.Atoi(partB)
			if numA < numB {
				return -1
			}
			return 1
		case isNumA:
			return -1
		case isNumB:
			return 1
		case partA < partB:
			return -1
		default:
			return 1
		}
	}

	return 0
}
