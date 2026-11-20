"""Hashed denylist of real names that must never appear in this demo.

The demo is built next to a proprietary codebase; its client, project and people
names must not leak into this repository. Storing the terms in plain text here
would itself leak them, so only SHA-256 hashes of lower-cased 1-2 word terms are
kept. `find_denied()` hashes every 1- and 2-word window of a text and reports
matches; the generator uses it to refuse colliding synthetic names, and
tests/test_rules_and_safety.py scans the whole repository and generated data.
"""
from __future__ import annotations

import hashlib
import re

DENIED_SHA256 = frozenset({
    "0da393f47441171fca0466e8617585312c2973235c5aabb6f7646447eb7d2a28",
    "0feee4bfca3047f26b90fd273de55f7d7a48f064d4312444138c9e84bc5da892",
    "210f4fc3043c43209f49d648b26703c56f97911584b3eeef04ea317a9776334c",
    "225e49b7240e2e55772fca7da36f77c99d59b3f8e535d9fae44b6f0095a1391a",
    "2f433b4fdbceaf41a5e460ec8266b46d353615687a8c2c21bdc5eb9fe897c71a",
    "3594ced783cbd69607a03834bee7bd633ae6b349d4ad49d6923c30e2735f9e2b",
    "4fb3d5ef0617cf27d667c881a0697439cd0b61a1258f504aa786dddb6c1a0736",
    "590df38aa7e89099f7b77d3bd1fdb374202c9a56c6e7e24256761035d5dee649",
    "5ac1b37687f2359a390220f3bfecf9a007dc2a34975998b932050972fa439f61",
    "63535950cc930805743ab97ecffeab133554f5c1c47f122f4768c1efd3af2190",
    "78d53d4c9c93b0d266e6224ff3ceedb547d248a0127daec258cbbd9f723e84bb",
    "8a0436b5f528d357d0f5a4b039f894606980e02f03f35e07dda382e27bacc507",
    "9b0b230cf72739237f01655f0795ac75574192511a25cd434fc36c6d9ba469cf",
    "af29296395cc3fd0c74348d8038efcc0c7b1a3e006bf8eaa72d7be79c697dae3",
    "b0160c6be2b3aa1e65766232f01764923e9018100474b7322f88e04ab64dd3ec",
    "eed32d054a260421ce85b3ed8b34a7a67ff4485756e367ea11943671148c7788",
})

_TOKEN = re.compile(r"[a-z0-9][a-z0-9.@_]*[a-z0-9]|[a-z0-9]")


def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def find_denied(text: str) -> list[str]:
    """Return the (lower-cased) 1-2 word windows of `text` whose hash is denied."""
    toks = _TOKEN.findall(text.lower())
    hits = []
    for i, t in enumerate(toks):
        cands = [t] + ([f"{t} {toks[i + 1]}"] if i + 1 < len(toks) else [])
        if "@" in t:
            cands.append(t.split("@", 1)[1])
            cands.append(t.split("@", 1)[0])
        for c in cands:
            if _h(c) in DENIED_SHA256:
                hits.append(c)
    return hits


def is_denied(text: str) -> bool:
    return bool(find_denied(text))
