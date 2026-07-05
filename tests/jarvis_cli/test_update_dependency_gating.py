"""Tests for the update-time dependency gating (skip reinstalls when no
dependency manifest changed) and the node-install stamp helpers.

The 15-minute update problem: every ``jarvis update`` unconditionally
reinstalled all Python deps and ran ``npm ci`` (a full ~1GB node_modules
wipe/reinstall) twice — even for pulls that only touched Python/TS source.
These tests pin the gating that makes those steps conditional.
"""

import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from jarvis_cli import main as hm
from jarvis_cli.main import cmd_update


def _git_side_effect(commit_count="1"):
    """Simulate git calls made by _cmd_update_impl for a 1-commit update."""

    def side_effect(cmd, **kwargs):
        joined = " ".join(str(c) for c in cmd)
        if "rev-parse" in joined and "--abbrev-ref" in joined:
            return subprocess.CompletedProcess(cmd, 0, stdout="main\n", stderr="")
        if "rev-parse" in joined and "HEAD" in joined:
            return subprocess.CompletedProcess(cmd, 0, stdout="a" * 40 + "\n", stderr="")
        if "rev-list" in joined:
            return subprocess.CompletedProcess(cmd, 0, stdout=f"{commit_count}\n", stderr="")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    return side_effect


@pytest.fixture(autouse=True)
def _patch_managed_uv():
    import shutil

    with patch("jarvis_cli.managed_uv.resolve_uv", side_effect=lambda: shutil.which("uv")), \
         patch("jarvis_cli.managed_uv.ensure_uv", side_effect=lambda: shutil.which("uv")), \
         patch("jarvis_cli.managed_uv.update_managed_uv", return_value=None):
        yield


@pytest.fixture
def gated_update(tmp_path):
    """Run cmd_update with every expensive step mocked; returns the mocks."""

    def _run(changed_files, *, marker_exists=False, force=False, node_fresh=True):
        marker = tmp_path / ".update-incomplete"
        if marker_exists:
            marker.write_text("started=0\n")

        args = SimpleNamespace(yes=True, no_backup=True, force=force)
        with patch("shutil.which", return_value=None), \
             patch("subprocess.run", side_effect=_git_side_effect()), \
             patch.object(hm, "_files_changed_between", return_value=changed_files), \
             patch.object(hm, "_update_marker_path", return_value=marker), \
             patch.object(hm, "_install_python_dependencies_with_optional_fallback") as py_install, \
             patch.object(hm, "_verify_core_dependencies_installed") as verify, \
             patch.object(hm, "_refresh_active_lazy_features") as lazy, \
             patch.object(hm, "_update_node_dependencies") as node, \
             patch.object(hm, "_node_install_is_fresh", return_value=node_fresh), \
             patch.object(hm, "_build_web_ui"), \
             patch.object(hm, "_maybe_rebuild_desktop_after_update"), \
             patch.object(hm, "_desktop_packaged_executable", return_value=None), \
             patch.object(hm, "_desktop_dist_exists", return_value=False), \
             patch.object(hm, "_is_termux_env", return_value=False), \
             patch.object(hm, "_clear_bytecode_cache", return_value=0), \
             patch.object(hm, "_validate_critical_files_syntax", return_value=(True, None, None)):
            cmd_update(args)
        return SimpleNamespace(py_install=py_install, verify=verify, lazy=lazy, node=node)

    return _run


class TestUpdateDependencyGating:
    def test_code_only_pull_skips_all_dependency_reinstalls(self, gated_update):
        mocks = gated_update({"jarvis_cli/main.py", "brain/foo.py"})
        mocks.py_install.assert_not_called()
        mocks.node.assert_not_called()
        mocks.lazy.assert_not_called()
        # The skip path still sweeps base deps for a half-stale venv.
        mocks.verify.assert_called_once()

    def test_pyproject_change_reinstalls_python_deps(self, gated_update):
        mocks = gated_update({"pyproject.toml"})
        mocks.py_install.assert_called_once()
        mocks.lazy.assert_called_once()
        mocks.node.assert_not_called()

    def test_lockfile_change_reinstalls_node_deps_only(self, gated_update):
        mocks = gated_update({"package-lock.json"})
        mocks.py_install.assert_not_called()
        mocks.node.assert_called_once()
        # Desktop app absent (mocked) => light workspace set.
        assert mocks.node.call_args.kwargs == {"include_desktop": False}

    def test_stale_node_stamp_reinstalls_node_deps(self, gated_update):
        mocks = gated_update({"jarvis_cli/main.py"}, node_fresh=False)
        mocks.py_install.assert_not_called()
        mocks.verify.assert_called_once()
        mocks.node.assert_called_once_with(include_desktop=False)

    def test_lazy_deps_pin_change_refreshes_lazy_features(self, gated_update):
        mocks = gated_update({"tools/lazy_deps.py"})
        mocks.py_install.assert_not_called()
        mocks.lazy.assert_called_once()

    def test_unknown_change_set_falls_back_to_full_reinstall(self, gated_update):
        mocks = gated_update(None)
        mocks.py_install.assert_called_once()
        mocks.node.assert_called_once()
        mocks.lazy.assert_called_once()

    def test_interrupted_install_marker_forces_python_reinstall(self, gated_update):
        mocks = gated_update({"jarvis_cli/main.py"}, marker_exists=True)
        mocks.py_install.assert_called_once()

    def test_force_flag_reinstalls_everything(self, gated_update):
        mocks = gated_update({"jarvis_cli/main.py"}, force=True)
        mocks.py_install.assert_called_once()
        mocks.node.assert_called_once()


class TestNodeInstallStamp:
    def _project(self, tmp_path):
        root = tmp_path / "repo"
        root.mkdir()
        (root / "package.json").write_text('{"name": "x"}')
        (root / "package-lock.json").write_text('{"lockfileVersion": 3}')
        (root / "node_modules").mkdir()
        return root

    def test_fresh_after_write(self, tmp_path, monkeypatch):
        root = self._project(tmp_path)
        stamp = tmp_path / "stamp.json"
        monkeypatch.setattr(hm, "_node_install_stamp_path", lambda: stamp)

        assert hm._node_install_is_fresh(root, require_all=False) is False
        hm._write_node_install_stamp(root, workspaces="update")
        assert hm._node_install_is_fresh(root, require_all=False) is True
        # The light set does not satisfy a caller that needs the desktop.
        assert hm._node_install_is_fresh(root, require_all=True) is False

    def test_all_satisfies_both_sets(self, tmp_path, monkeypatch):
        root = self._project(tmp_path)
        stamp = tmp_path / "stamp.json"
        monkeypatch.setattr(hm, "_node_install_stamp_path", lambda: stamp)

        hm._write_node_install_stamp(root, workspaces="all")
        assert hm._node_install_is_fresh(root, require_all=False) is True
        assert hm._node_install_is_fresh(root, require_all=True) is True

    def test_manifest_change_invalidates(self, tmp_path, monkeypatch):
        root = self._project(tmp_path)
        stamp = tmp_path / "stamp.json"
        monkeypatch.setattr(hm, "_node_install_stamp_path", lambda: stamp)

        hm._write_node_install_stamp(root, workspaces="all")
        (root / "package-lock.json").write_text('{"lockfileVersion": 3, "x": 1}')
        assert hm._node_install_is_fresh(root, require_all=False) is False

    def test_missing_node_modules_invalidates(self, tmp_path, monkeypatch):
        root = self._project(tmp_path)
        stamp = tmp_path / "stamp.json"
        monkeypatch.setattr(hm, "_node_install_stamp_path", lambda: stamp)

        hm._write_node_install_stamp(root, workspaces="all")
        (root / "node_modules").rmdir()
        assert hm._node_install_is_fresh(root, require_all=False) is False


class TestFilesChangedBetween:
    def _init_repo(self, tmp_path):
        root = tmp_path / "repo"
        root.mkdir()
        env_cmds = [
            ["git", "init", "-q"],
            ["git", "config", "user.email", "t@example.com"],
            ["git", "config", "user.name", "t"],
        ]
        for cmd in env_cmds:
            subprocess.run(cmd, cwd=root, check=True, capture_output=True)
        (root / "a.txt").write_text("one\n")
        (root / "pyproject.toml").write_text("[project]\nname='x'\n")
        subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-qm", "init"], cwd=root, check=True, capture_output=True)
        sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True
        ).stdout.strip()
        return root, sha

    def test_detects_committed_and_dirty_changes(self, tmp_path):
        root, base = self._init_repo(tmp_path)
        (root / "a.txt").write_text("two\n")
        subprocess.run(["git", "commit", "-aqm", "edit"], cwd=root, check=True, capture_output=True)
        (root / "pyproject.toml").write_text("[project]\nname='y'\n")  # dirty, uncommitted

        changed = hm._files_changed_between(["git"], root, base)
        assert changed == {"a.txt", "pyproject.toml"}

    def test_no_changes_returns_empty_set(self, tmp_path):
        root, base = self._init_repo(tmp_path)
        assert hm._files_changed_between(["git"], root, base) == set()

    def test_missing_base_sha_returns_none(self, tmp_path):
        root, _ = self._init_repo(tmp_path)
        assert hm._files_changed_between(["git"], root, None) is None
        assert hm._files_changed_between(["git"], root, "") is None

    def test_bad_sha_returns_none(self, tmp_path):
        root, _ = self._init_repo(tmp_path)
        assert hm._files_changed_between(["git"], root, "f" * 40) is None
