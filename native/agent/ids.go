package main

func safeID(s string) bool {
	if s == "" || len(s) > 128 { return false }
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_'
		if !ok { return false }
	}
	return true
}
