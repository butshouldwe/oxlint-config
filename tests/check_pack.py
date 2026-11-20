"""Check a real npm artifact for accidental disclosure, not crafted evasion."""

import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

from pack_ips import addresses

ROOT = Path(__file__).resolve().parents[1]
FILES = {"LICENSE", "README.md", "index.d.ts", "index.js", "package.json"}
CGNAT = ipaddress.ip_network("100.64.0.0/10")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs)


# Parses: npm's JSON pack report and tar archive, then UTF-8 package text.
# The tokenizer canonicalizes decimal IPv4 octets; ipaddress classifies scope.
with tempfile.TemporaryDirectory(prefix="pack-", dir=os.environ.get("TMPDIR", ROOT / "tests")) as tmp:
    tmp = Path(tmp)
    report = json.loads(run("npm", "pack", "--json", "--pack-destination", str(tmp), cwd=ROOT).stdout)
    # npm 12 keys reports by package name; npm 11 returns an array.
    reports = list(report.values()) if isinstance(report, dict) else report
    require(len(reports) == 1, "expected one npm artifact")
    report = reports[0]
    require({f["path"] for f in report["files"]} == FILES, "npm file allowlist differs")
    package = tmp / "extracted"
    package.mkdir()
    with tarfile.open(tmp / report["filename"], "r:gz") as archive:
        members = archive.getmembers()
        require(len(members) == len(FILES), "tar member count differs")
        require({m.name for m in members} == {"package/" + f for f in FILES}, "tar file allowlist differs")
        require(all(m.isfile() for m in members), "tar must contain only regular files")
        # Exact names and regular-file types above make extraction safe on Python 3.11.
        archive.extractall(package)
    package = package / "package"
    manifest = json.loads((package / "package.json").read_text())
    require(manifest["version"] == "0.2.1", "version must be 0.2.1")
    require(manifest.get("license") == "MIT", "license must be MIT")
    require(manifest["repository"] == {
        "type": "git", "url": "git+https://github.com/butshouldwe/oxlint-config.git"
    }, "repository must name the public home")
    require(manifest["publishConfig"].get("access") == "public", "npm access must be public")
    require(manifest["publishConfig"].get("registry", "https://registry.npmjs.org/") ==
            "https://registry.npmjs.org/", "registry must be public npm")
    # Exact MIT text from cypher's LICENSE, with the card's approved holder.
    require(hashlib.sha256((package / "LICENSE").read_bytes()).hexdigest() ==
            "da98d8aea294a4005957e31f1466e6a92cb6a1e1e5b4d491b3dbd432fd70becb",
            "MIT LICENSE text or holder differs")
    for name in sorted(FILES):
        text = (package / name).read_text(encoding="utf-8")
        require(not re.search(r"ts\.net|/home/|/srv/|/Users/", text, re.IGNORECASE),
                "internal host or path in packed " + name)
        for address in addresses(text):
            require(not (address.is_private or address.is_loopback or
                         (address.version == 4 and address in CGNAT)),
                    "internal IP in packed " + name)
    config = tmp / "gitleaks.toml"
    config.write_text("[extend]\nuseDefault = true\n")
    result = run("gitleaks", "dir", str(package), "--redact", "--no-banner",
                 "--config", str(config), "--gitleaks-ignore-path", str(tmp / "no-ignores"),
                 "--ignore-gitleaks-allow", cwd=tmp)
    print(result.stderr, end="")
    print("PASS: five files, public 0.2.1 metadata, MIT LICENSE, no internal references or secrets")
    print("integrity:", report["integrity"])
