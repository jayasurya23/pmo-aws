"""Outbound-network guard: the demo must never reach a live company system.

Installed at app start-up and at the start of every pipeline run. It wraps
``socket.create_connection`` / ``socket.socket.connect`` and refuses any
destination that is not loopback or a private Docker-network address. The
production hosts PMO 360 talks to are named explicitly so a refusal reads
clearly in a log.

This is a belt-and-braces control: no code path in the demo calls these hosts
in the first place (the Monday and Graph integrations run against local
synthetic files through the same interfaces), and tests/test_offline.py
proves it by running the whole pipeline with the guard installed.
"""
from __future__ import annotations

import ipaddress
import socket

BLOCKED_HOSTS = {
    "api.monday.com",
    "graph.microsoft.com",
    "login.microsoftonline.com",
    "api.openai.com",
}

_ALLOWED_NAMES = {"localhost", "db", "postgres", "backend", "frontend"}
_installed = False
_orig_create_connection = socket.create_connection
_orig_connect = socket.socket.connect


class ExternalNetworkBlocked(RuntimeError):
    pass


def _host_allowed(host: str) -> bool:
    if host is None:
        return True
    host = str(host).strip("[]").lower()
    if host in BLOCKED_HOSTS:
        return False
    if host in _ALLOWED_NAMES:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        # A hostname we do not recognise: resolve it and judge the address, so
        # a DNS alias cannot smuggle a public destination past the check.
        try:
            infos = socket.getaddrinfo(host, None)
        except OSError:
            return False
        return all(_host_allowed(i[4][0]) for i in infos)
    return ip.is_loopback or ip.is_private or ip.is_link_local


def _check(address) -> None:
    host = address[0] if isinstance(address, tuple) else None
    if isinstance(address, (str, bytes)):  # AF_UNIX socket path
        return
    if not _host_allowed(host):
        raise ExternalNetworkBlocked(
            f"Demo network guard: outbound connection to {host!r} refused. "
            "The PMO 360 demo runs on synthetic local data only."
        )


def _guarded_create_connection(address, *args, **kwargs):
    _check(address)
    return _orig_create_connection(address, *args, **kwargs)


def _guarded_connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        _check(address)
    return _orig_connect(self, address)


def install() -> None:
    global _installed
    if _installed:
        return
    socket.create_connection = _guarded_create_connection
    socket.socket.connect = _guarded_connect
    _installed = True


def uninstall() -> None:
    global _installed
    socket.create_connection = _orig_create_connection
    socket.socket.connect = _orig_connect
    _installed = False
