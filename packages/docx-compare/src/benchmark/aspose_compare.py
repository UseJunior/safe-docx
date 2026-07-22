#!/usr/bin/env python3
"""Standalone Aspose Words comparison CLI for benchmark oracle generation.

Usage:
    python aspose_compare.py --original a.docx --revised b.docx --output result.docx [--author "Name"]

Produces:
    result.docx         — The comparison result with track changes
    result.manifest.json — Metadata: hashes, version, revision count
"""

import argparse
import glob
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

WRAPPER_VERSION = "1.0.0"


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Aspose Words document comparison CLI")
    parser.add_argument("--original", required=True, help="Path to original document")
    parser.add_argument("--revised", required=True, help="Path to revised document")
    parser.add_argument("--output", required=True, help="Path to output comparison result")
    parser.add_argument("--author", default="Aspose Oracle", help="Author name for revisions")
    args = parser.parse_args()

    try:
        import aspose.words as aw
    except ImportError:
        print("ERROR: aspose-words not installed. Install with: pip install aspose-words", file=sys.stderr)
        sys.exit(2)

    # Apply license if .lic file exists (standalone, no external import)
    for lic in glob.glob("*.lic") + glob.glob("**/*.lic", recursive=True):
        try:
            aw.License().set_license(lic)
            break
        except Exception:
            pass

    original = aw.Document(args.original)
    revised = aw.Document(args.revised)
    original.accept_all_revisions()
    revised.accept_all_revisions()

    options = aw.comparing.CompareOptions()
    options.ignore_formatting = False
    options.compare_moves = True

    original.compare(revised, args.author, datetime.now(), options)
    original.save(args.output)

    # Count revisions in result
    revision_count = original.revisions.count if hasattr(original, "revisions") else 0

    # Compute cache key from content hashes
    original_hash = sha256_file(args.original)
    revised_hash = sha256_file(args.revised)
    aspose_version = getattr(aw, "__version__", "unknown")

    manifest = {
        "wrapper_version": WRAPPER_VERSION,
        "aspose_version": aspose_version,
        "original_hash": original_hash,
        "revised_hash": revised_hash,
        "cache_key": hashlib.sha256(
            f"{original_hash}:{revised_hash}:{aspose_version}:{WRAPPER_VERSION}".encode()
        ).hexdigest(),
        "original_path": args.original,
        "revised_path": args.revised,
        "output_path": args.output,
        "author": args.author,
        "revision_count": revision_count,
        "timestamp": datetime.now().isoformat(),
    }

    manifest_path = args.output.replace(".docx", ".manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Comparison complete: {revision_count} revisions", file=sys.stderr)
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
