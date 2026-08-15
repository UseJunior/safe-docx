#!/usr/bin/env python3
"""Refresh the local-only Aspose field-comparison verdict snapshot.

Set SAFE_DOCX_ASPOSE_PYTHON to a Python executable containing aspose-words==25.10
and SAFE_DOCX_ASPOSE_LICENSE to the local license path. With neither configured,
the command skips without touching the snapshot. Invalid explicit configuration
fails before replacing the snapshot and never prints license contents or paths.
"""

import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
CASES = {
    "formcheckbox-to-formtext": (" FORMCHECKBOX ", " FORMTEXT ", "☐", "value"),
    "hyperlink-retarget": (" HYPERLINK \\\"https://old.example\\\" ", " HYPERLINK \\\"https://new.example\\\" ", "link", "link"),
    "pageref-retarget": (" PAGEREF Old \\h ", " PAGEREF New \\h ", "3", "3"),
    "numpages-result-only": (" NUMPAGES ", " NUMPAGES ", "3", "4"),
}


def xml_escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def body_xml(instruction: str, result: str) -> str:
    return (
        '<w:document xmlns:w="%s"><w:body><w:p>' % W
        + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        + '<w:r><w:instrText xml:space="preserve">%s</w:instrText></w:r>' % xml_escape(instruction)
        + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        + '<w:r><w:t>%s</w:t></w:r>' % xml_escape(result)
        + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
        + '</w:p><w:sectPr/></w:body></w:document>'
    )


def pack_docx(path: Path, document_xml: str) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr("word/document.xml", document_xml)


def compare_script() -> str:
    return """import aspose.words as aw, datetime, importlib.metadata, sys
aw.License().set_license(sys.argv[3])
original, revised = aw.Document(sys.argv[1]), aw.Document(sys.argv[2])
if original.revisions.count: original.accept_all_revisions()
if revised.revisions.count: revised.accept_all_revisions()
original.compare(revised, 'Aspose Oracle', datetime.datetime(2026, 8, 14), aw.comparing.CompareOptions())
original.save(sys.argv[4])
print(importlib.metadata.version('aspose-words'))
"""


def project(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        raw = archive.read("word/document.xml")
    root = ET.fromstring(raw)
    deleted = root.findall(".//w:del", NS)
    inserted = root.findall(".//w:ins", NS)
    fld = lambda nodes: sum(len(node.findall(".//w:fldChar", NS)) for node in nodes)
    instruction = lambda nodes: "".join((node.text or "") for parent in nodes for node in parent.findall(".//w:instrText", NS) + parent.findall(".//w:delInstrText", NS))
    outside = sum(1 for node in root.findall(".//w:fldChar", NS) if not any(node in parent.iter() for parent in deleted + inserted))
    return {
        "deletedFldChars": fld(deleted),
        "insertedFldChars": fld(inserted),
        "outsideRevisionFldChars": outside,
        "deletedInstruction": instruction(deleted),
        "insertedInstruction": instruction(inserted),
        "classification": "whole-field-replacement" if fld(deleted) >= 3 and fld(inserted) >= 3 else "cached-result-only",
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    python = os.environ.get("SAFE_DOCX_ASPOSE_PYTHON")
    license_path = os.environ.get("SAFE_DOCX_ASPOSE_LICENSE")
    if not python and not license_path:
        print("SKIP: set SAFE_DOCX_ASPOSE_PYTHON and SAFE_DOCX_ASPOSE_LICENSE to refresh the Aspose snapshot")
        return 0
    if not python or not license_path:
        print("ERROR: both SAFE_DOCX_ASPOSE_PYTHON and SAFE_DOCX_ASPOSE_LICENSE are required", file=sys.stderr)
        return 2
    if not Path(python).is_file() or not Path(license_path).is_file():
        print("ERROR: configured Aspose runtime or license is unavailable", file=sys.stderr)
        return 2

    verdicts = []
    with tempfile.TemporaryDirectory(prefix="safe-docx-aspose-") as temp:
        work = Path(temp)
        runner = work / "compare.py"
        runner.write_text(compare_script())
        version = None
        for case_id, (old_instruction, new_instruction, old_result, new_result) in CASES.items():
            original, revised, output = work / f"{case_id}-original.docx", work / f"{case_id}-revised.docx", work / f"{case_id}-output.docx"
            pack_docx(original, body_xml(old_instruction, old_result))
            pack_docx(revised, body_xml(new_instruction, new_result))
            completed = subprocess.run([python, str(runner), str(original), str(revised), license_path, str(output)], capture_output=True, text=True)
            if completed.returncode:
                detail = (completed.stderr or completed.stdout or "unknown error").strip().splitlines()[-1]
                detail = detail.replace(python, "<runtime>").replace(license_path, "<license>").replace(str(work), "<temp>")
                print(f"ERROR: Aspose comparison failed: {detail}", file=sys.stderr)
                return completed.returncode
            version = completed.stdout.strip().splitlines()[-1]
            verdicts.append({"id": case_id, "originalSha256": sha256(original), "revisedSha256": sha256(revised), **project(output)})
        if version not in ("25.10.0", "25.10"):
            print("ERROR: oracle must run with aspose-words==25.10", file=sys.stderr)
            return 2

    repo = Path(__file__).resolve().parents[1]
    ilpa_original = repo / "tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx"
    ilpa_revised = repo / "tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx"
    snapshot = {
        "schemaVersion": 1,
        "generatedOn": "2026-08-14",
        "oracle": {"name": "Aspose.Words for Python via .NET", "package": "aspose-words", "version": "25.10"},
        "fieldCases": verdicts,
        "ilpa": {
            "originalSha256": sha256(ilpa_original), "revisedSha256": sha256(ilpa_revised),
            "measured": {
                "wordVersion": "16.112", "asposeVersion": "25.10",
                "wholeFieldDeletion": {"agreement": True, "wordFldCharsInsideDeletion": 174, "asposeFldCharsInsideDeletion": 45},
                "parentheticalEnumerator1471": {"agreement": True, "word": "delete-old-whole-enumerator-and-insert-(i", "aspose": "delete-old-whole-enumerator-and-insert-(i"},
                "boldToNotBold1555": {"agreement": True, "shape": "rPrChange", "documentCounts": {"safeDocx": 17, "word": 34, "aspose": 31}},
                "givebackBoundary": {"agreement": False, "authority": "word", "wordAndSafeDocx": "delete-and-reinsert-closing-punctuation", "aspose": "preserve-closing-punctuation-and-insert-middle"},
            },
        },
    }
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    temporary.replace(destination)
    print(f"Wrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
