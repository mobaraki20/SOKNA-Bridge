from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AGENT = ROOT / "native" / "runtime" / "v2.6.0" / "agent.ps1"
CAPS = ROOT / "native" / "runtime" / "v2.6.0" / "AGENT_CAPABILITIES.json"
CONTRACT = ROOT / "docs" / "contracts" / "GITHUB_FAST_PATH_V1_FA.md"


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_fast_path_contract_exists_and_names_canonical_orchestrators():
    c = text(CONTRACT)
    assert "job.batch" in c
    assert "plan.run" in c
    assert "job.submit" in c
    assert "Control Plane" in c
    assert "CI monitoring" in c


def test_runtime_exposes_local_multi_step_orchestration():
    a = text(AGENT)
    assert '"job.batch" {' in a
    assert '"plan.run" {' in a
    assert '"job.submit" {' in a
    assert "Max 30 steps" in a
    assert "Max 100 plan steps" in a


def test_runtime_keeps_github_git_primitives_needed_by_fast_path():
    a = text(AGENT)
    for marker in (
        '"repo.sync.preflight"',
        '"repo.sync.apply_ff"',
        '"git.fetch"',
        '"git.diff"',
        '"git.add.paths"',
        '"git.commit"',
        '"git.push"',
        '"gh.auth.status"',
    ):
        assert marker in a


def test_fast_path_does_not_bypass_workspace_tool_permissions_or_protected_branch_guard():
    a = text(AGENT)
    assert "AssertWorkspaceTool $w 'git'" in a
    assert "AssertWorkspaceTool $w 'gh'" in a
    assert 'if($b-in@("main","master","production")){throw "Direct push to protected branch blocked"}' in a


def test_capability_manifest_advertises_orchestration_and_git_primitives():
    c = text(CAPS)
    for marker in (
        '"job.batch"',
        '"plan.run"',
        '"job.submit"',
        '"repo.sync.preflight"',
        '"git.fetch"',
        '"git.push"',
        '"gh.auth.status"',
    ):
        assert marker in c
