//go:build windows

package main

import (
	"errors"
	"syscall"
	"unsafe"
)

type dataBlob struct {
	cbData uint32
	pbData *byte
}

var (
	crypt32                 = syscall.NewLazyDLL("crypt32.dll")
	kernel32                = syscall.NewLazyDLL("kernel32.dll")
	procCryptProtectData    = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData  = crypt32.NewProc("CryptUnprotectData")
	procLocalFree           = kernel32.NewProc("LocalFree")
	credentialEntropy       = []byte("SOKNA-Browser-QA-Credential-v1")
)

const cryptProtectUIForbidden = 0x1

func makeBlob(b []byte) dataBlob {
	if len(b) == 0 {
		return dataBlob{}
	}
	return dataBlob{cbData: uint32(len(b)), pbData: &b[0]}
}

func blobBytes(b dataBlob) []byte {
	if b.cbData == 0 || b.pbData == nil {
		return []byte{}
	}
	out := make([]byte, int(b.cbData))
	copy(out, unsafe.Slice(b.pbData, int(b.cbData)))
	return out
}

func protectCredentialBytes(plain []byte) ([]byte, error) {
	if len(plain) == 0 {
		return nil, errors.New("cannot protect empty credential")
	}
	in := makeBlob(plain)
	entropy := makeBlob(credentialEntropy)
	var out dataBlob
	r, _, callErr := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0,
		uintptr(unsafe.Pointer(&entropy)),
		0,
		0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		if callErr != syscall.Errno(0) {
			return nil, callErr
		}
		return nil, errors.New("CryptProtectData failed")
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	return blobBytes(out), nil
}

func unprotectCredentialBytes(cipher []byte) ([]byte, error) {
	if len(cipher) == 0 {
		return nil, errors.New("cannot unprotect empty credential")
	}
	in := makeBlob(cipher)
	entropy := makeBlob(credentialEntropy)
	var out dataBlob
	r, _, callErr := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0,
		uintptr(unsafe.Pointer(&entropy)),
		0,
		0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		if callErr != syscall.Errno(0) {
			return nil, callErr
		}
		return nil, errors.New("CryptUnprotectData failed")
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	return blobBytes(out), nil
}
