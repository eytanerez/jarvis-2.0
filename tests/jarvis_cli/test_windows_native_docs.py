from pathlib import Path


def test_windows_native_install_path_docs_match_installer() -> None:
    doc = Path("website/docs/user-guide/windows-native.md").read_text()
    install = Path("scripts/install.ps1").read_text()

    assert "%LOCALAPPDATA%\\jarvis\\jarvis-agent\\venv\\Scripts" in doc
    assert "Get-Command jarvis        # should print C:\\Users\\<you>\\AppData\\Local\\jarvis\\jarvis-agent\\venv\\Scripts\\jarvis.exe" in doc
    assert '$jarvisBin = "$InstallDir\\venv\\Scripts"' in install
