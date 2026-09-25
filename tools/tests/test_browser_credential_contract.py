from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / "native" / "browser" / "model.go"
CREDENTIAL = ROOT / "native" / "browser" / "credential.go"
CREDENTIAL_WINDOWS = ROOT / "native" / "browser" / "credential_windows.go"
QA = ROOT / "native" / "browser" / "qa.go"
REDACT = ROOT / "native" / "browser" / "redact.go"
HOST = ROOT / "native" / "host" / "credential_local.go"
HOST_MAIN = ROOT / "native" / "host" / "main.go"
POPUP = ROOT / "extension" / "chrome" / "popup.js"
POPUP_HTML = ROOT / "extension" / "chrome" / "popup.html"


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_recipe_uses_reference_not_plaintext_contract():
    m = text(MODEL)
    assert 'CredentialRef   string `json:"credential_ref,omitempty"`' in m
    assert 'CredentialField string `json:"credential_field,omitempty"`' in m
    assert "credential_ref cannot be combined with value/value_env/text" in m
    q = text(QA)
    assert "credentialValue(a.CredentialRef, a.CredentialField)" in q


def test_windows_store_is_user_bound_dpapi_and_blob_is_not_plaintext_json():
    c = text(CREDENTIAL_WINDOWS)
    assert 'syscall.NewLazyDLL("crypt32.dll")' in c
    assert 'crypt32.NewProc("CryptProtectData")' in c
    assert 'crypt32.NewProc("CryptUnprotectData")' in c
    assert "cryptProtectUIForbidden" in c
    store = text(CREDENTIAL)
    assert "protectCredentialBytes(raw)" in store
    assert "unprotectCredentialBytes(raw)" in store
    assert 'filepath.Join(root, "SOKNA", "Bridge", "credentials")' in store


def test_secret_is_sent_to_helper_over_stdin_not_command_line():
    h = text(HOST)
    assert 'cmd.Stdin = strings.NewReader(secret)' in h
    assert '[]string{"credential", "set", "--id", q.ID, "--username", q.Username}' in h
    assert 'q.Secret = ""' in h
    assert '"credential.store"' in h
    assert '"credential.list"' in h
    assert '"credential.delete"' in h
    main = text(HOST_MAIN)
    assert "handleCredentialMessage(m)" in main


def test_popup_routes_credentials_directly_to_native_host_and_clears_password_field():
    p = text(POPUP)
    assert 'chrome.runtime.sendNativeMessage(NATIVE_HOST' in p
    assert 'type:"credential.store"' in p
    assert 'type:"credential.list"' in p
    assert 'type:"credential.delete"' in p
    assert 'document.getElementById("credSecret").value=""' in p
    html = text(POPUP_HTML)
    assert 'id="credSecret" type="password"' in html
    assert "Secrets go directly to the local Native Host" in html


def test_stored_credential_values_are_in_redaction_set():
    r = text(REDACT)
    assert "loadCredential(a.CredentialRef)" in r
    assert "addValue(rec.Secret)" in r
    assert "addValue(rec.Username)" in r


if __name__ == "__main__":
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
    print("BROWSER_CREDENTIAL_CONTRACT_PASS")
