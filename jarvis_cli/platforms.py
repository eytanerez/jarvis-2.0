"""
Shared platform registry for Jarvis.

Single source of truth for platform metadata consumed by both
skills_config (label display) and tools_config (default toolset
resolution).  Import ``PLATFORMS`` from here instead of maintaining
duplicate dicts in each module.
"""

from collections import OrderedDict
from typing import NamedTuple


class PlatformInfo(NamedTuple):
    """Metadata for a single platform entry."""
    label: str
    default_toolset: str


# Ordered so that TUI menus are deterministic.
PLATFORMS: OrderedDict[str, PlatformInfo] = OrderedDict([
    ("cli",            PlatformInfo(label="🖥️  CLI",            default_toolset="jarvis-cli")),
    ("telegram",       PlatformInfo(label="📱 Telegram",        default_toolset="jarvis-telegram")),
    ("discord",        PlatformInfo(label="💬 Discord",         default_toolset="jarvis-discord")),
    ("slack",          PlatformInfo(label="💼 Slack",           default_toolset="jarvis-slack")),
    ("whatsapp",       PlatformInfo(label="📱 WhatsApp",        default_toolset="jarvis-whatsapp")),
    ("whatsapp_cloud", PlatformInfo(label="📱 WhatsApp Business (Cloud)", default_toolset="jarvis-whatsapp")),
    ("signal",         PlatformInfo(label="📡 Signal",          default_toolset="jarvis-signal")),
    ("bluebubbles",    PlatformInfo(label="💙 BlueBubbles",     default_toolset="jarvis-bluebubbles")),
    ("email",          PlatformInfo(label="📧 Email",           default_toolset="jarvis-email")),
    ("homeassistant",  PlatformInfo(label="🏠 Home Assistant",  default_toolset="jarvis-homeassistant")),
    ("mattermost",     PlatformInfo(label="💬 Mattermost",      default_toolset="jarvis-mattermost")),
    ("matrix",         PlatformInfo(label="💬 Matrix",          default_toolset="jarvis-matrix")),
    ("dingtalk",       PlatformInfo(label="💬 DingTalk",        default_toolset="jarvis-dingtalk")),
    ("feishu",         PlatformInfo(label="🪽 Feishu",          default_toolset="jarvis-feishu")),
    ("wecom",          PlatformInfo(label="💬 WeCom",           default_toolset="jarvis-wecom")),
    ("wecom_callback", PlatformInfo(label="💬 WeCom Callback",  default_toolset="jarvis-wecom-callback")),
    ("weixin",         PlatformInfo(label="💬 Weixin",          default_toolset="jarvis-weixin")),
    ("qqbot",          PlatformInfo(label="💬 QQBot",           default_toolset="jarvis-qqbot")),
    ("yuanbao",        PlatformInfo(label="🤖 Yuanbao",         default_toolset="jarvis-yuanbao")),
    ("webhook",        PlatformInfo(label="🔗 Webhook",         default_toolset="jarvis-webhook")),
    ("api_server",     PlatformInfo(label="🌐 API Server",      default_toolset="jarvis-api-server")),
    ("cron",           PlatformInfo(label="⏰ Cron",            default_toolset="jarvis-cron")),
])


def platform_label(key: str, default: str = "") -> str:
    """Return the display label for a platform key, or *default*.

    Checks the static PLATFORMS dict first, then the plugin platform
    registry for dynamically registered platforms.
    """
    info = PLATFORMS.get(key)
    if info is not None:
        return info.label
    # Check plugin registry
    try:
        from gateway.platform_registry import platform_registry
        entry = platform_registry.get(key)
        if entry:
            return f"{entry.emoji}  {entry.label}" if entry.emoji else entry.label
    except Exception:
        pass
    return default


def get_all_platforms() -> "OrderedDict[str, PlatformInfo]":
    """Return PLATFORMS merged with any plugin-registered platforms.

    Plugin platforms are appended after builtins.  This is the function
    that tools_config and skills_config should use for platform menus.
    """
    merged = OrderedDict(PLATFORMS)
    try:
        from gateway.platform_registry import platform_registry
        for entry in platform_registry.plugin_entries():
            if entry.name not in merged:
                merged[entry.name] = PlatformInfo(
                    label=f"{entry.emoji}  {entry.label}" if entry.emoji else entry.label,
                    default_toolset=f"jarvis-{entry.name}",
                )
    except Exception:
        pass
    return merged
