//go:build !windows

package main

import "errors"

func protectCredentialBytes([]byte) ([]byte, error) {
	return nil, errors.New("browser credential store is only available on Windows")
}

func unprotectCredentialBytes([]byte) ([]byte, error) {
	return nil, errors.New("browser credential store is only available on Windows")
}
