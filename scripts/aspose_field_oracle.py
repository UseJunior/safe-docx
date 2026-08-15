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
    "hyperlink-retarget": (' HYPERLINK "https://old.example" ', ' HYPERLINK "https://new.example" ', "link", "link"),
    "pageref-retarget": (" PAGEREF Old \\h ", " PAGEREF New \\h ", "3", "3"),
    "numpages-result-only": (" NUMPAGES ", " NUMPAGES ", "3", "4"),
}


def expected_projection(case_id: str, old_instruction: str, new_instruction: str, old_result: str, new_result: str) -> dict:
    if case_id == "numpages-result-only":
        return {
            "classification": "cached-result-only", "deletedFldChars": 0,
            "insertedFldChars": 0, "outsideRevisionFldChars": 3,
            "deletedInstruction": "", "insertedInstruction": "",
            "deletedText": old_result, "insertedText": new_result,
        }
    return {
        "classification": "whole-field-replacement", "deletedFldChars": 3,
        "insertedFldChars": 3, "outsideRevisionFldChars": 0,
        "deletedInstruction": old_instruction, "insertedInstruction": new_instruction,
        "deletedText": old_result, "insertedText": new_result,
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
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as archive:
        entries = {
            "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
            "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
            "word/document.xml": document_xml,
        }
        for name, content in entries.items():
            info = zipfile.ZipInfo(name, date_time=(2024, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o600 << 16
            archive.writestr(info, content.encode("utf-8"))


def compare_script() -> str:
    return """import aspose.words as aw, datetime, importlib.metadata, os, sys
aw.License().set_license(os.environ['SAFE_DOCX_ASPOSE_CHILD_LICENSE'])
original, revised = aw.Document(sys.argv[1]), aw.Document(sys.argv[2])
if original.revisions.count: original.accept_all_revisions()
if revised.revisions.count: revised.accept_all_revisions()
original.compare(revised, 'Aspose Oracle', datetime.datetime(2026, 8, 14), aw.comparing.CompareOptions())
original.save(sys.argv[3])
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
    deleted_text = "".join(node.text or "" for parent in deleted for node in parent.findall(".//w:delText", NS) + parent.findall(".//w:t", NS))
    inserted_text = "".join(node.text or "" for parent in inserted for node in parent.findall(".//w:t", NS))
    outside = sum(1 for node in root.findall(".//w:fldChar", NS) if not any(node in parent.iter() for parent in deleted + inserted))
    if fld(deleted) >= 3 and fld(inserted) >= 3:
        classification = "whole-field-replacement"
    elif fld(deleted) == 0 and fld(inserted) == 0 and outside == 3 and deleted_text and inserted_text:
        classification = "cached-result-only"
    else:
        classification = "unclassified"
    return {
        "deletedFldChars": fld(deleted),
        "insertedFldChars": fld(inserted),
        "outsideRevisionFldChars": outside,
        "deletedInstruction": instruction(deleted),
        "insertedInstruction": instruction(inserted),
        "deletedText": deleted_text,
        "insertedText": inserted_text,
        "classification": classification,
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def document_xml_sha256(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        return hashlib.sha256(archive.read("word/document.xml")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--check", action="store_true", help="verify deterministic fixture hashes without importing Aspose")
    parser.add_argument("--self-test", action="store_true", help="verify projection discriminates a no-op from result-only redlining")
    args = parser.parse_args()
    destination = Path(args.output)
    if args.self_test:
        no_revision = body_xml(" NUMPAGES ", "3")
        tracked_result = (
            f'<w:document xmlns:w="{W}"><w:body><w:p>'
            '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> NUMPAGES </w:instrText></w:r>'
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
            '<w:del><w:r><w:delText>3</w:delText></w:r></w:del><w:ins><w:r><w:t>4</w:t></w:r></w:ins>'
            '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:sectPr/></w:body></w:document>'
        )
        with tempfile.TemporaryDirectory(prefix="safe-docx-aspose-self-test-") as temp:
            whole_field = (
                f'<w:document xmlns:w="{W}"><w:body><w:p><w:del>'
                + body_xml(" FORMCHECKBOX ", "☐").split("<w:p>", 1)[1].split("</w:p>", 1)[0].replace("w:instrText", "w:delInstrText").replace("<w:t>", "<w:delText>").replace("</w:t>", "</w:delText>")
                + '</w:del><w:ins>'
                + body_xml(" FORMTEXT ", "value").split("<w:p>", 1)[1].split("</w:p>", 1)[0]
                + '</w:ins></w:p><w:sectPr/></w:body></w:document>'
            )
            no_revision_path, tracked_path, whole_path = Path(temp) / "no-op.docx", Path(temp) / "tracked.docx", Path(temp) / "whole.docx"
            pack_docx(no_revision_path, no_revision)
            pack_docx(tracked_path, tracked_result)
            pack_docx(whole_path, whole_field)
            if project(no_revision_path)["classification"] != "unclassified":
                raise AssertionError("no-op output must not classify as cached-result-only")
            tracked = project(tracked_path)
            if tracked["classification"] != "cached-result-only" or tracked["deletedText"] != "3" or tracked["insertedText"] != "4":
                raise AssertionError("tracked cached-result projection is incomplete")
            whole = project(whole_path)
            if whole != expected_projection("formcheckbox-to-formtext", " FORMCHECKBOX ", " FORMTEXT ", "☐", "value"):
                raise AssertionError("whole-field projection is incomplete")
        print("Aspose projection self-test passed without importing Aspose")
        return 0
    if args.check:
        snapshot = json.loads(destination.read_text())
        with tempfile.TemporaryDirectory(prefix="safe-docx-aspose-check-") as temp:
            work = Path(temp)
            if len(snapshot.get("fieldCases", [])) != len(CASES):
                raise ValueError("snapshot case count changed")
            for case, stored in zip(CASES.items(), snapshot["fieldCases"]):
                case_id, (old_instruction, new_instruction, old_result, new_result) = case
                if stored["id"] != case_id:
                    raise ValueError("snapshot case order or identity changed")
                original, revised = work / "original.docx", work / "revised.docx"
                pack_docx(original, body_xml(old_instruction, old_result))
                pack_docx(revised, body_xml(new_instruction, new_result))
                if stored["originalSha256"] != sha256(original) or stored["revisedSha256"] != sha256(revised):
                    raise ValueError(f"fixture hash mismatch for {case_id}")
                expected = expected_projection(case_id, old_instruction, new_instruction, old_result, new_result)
                if any(stored.get(key) != value for key, value in expected.items()):
                    raise ValueError(f"snapshot verdict mismatch for {case_id}")
                output_hash = stored.get("outputDocumentXmlSha256", "")
                if len(output_hash) != 64 or any(char not in "0123456789abcdef" for char in output_hash):
                    raise ValueError(f"Aspose output provenance is missing for {case_id}")
        print("Aspose snapshot fixture hashes verified without importing Aspose")
        return 0
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
            child_env = {**os.environ, "SAFE_DOCX_ASPOSE_CHILD_LICENSE": license_path}
            completed = subprocess.run([python, str(runner), str(original), str(revised), str(output)], capture_output=True, text=True, env=child_env)
            if completed.returncode:
                print(f"ERROR: Aspose comparison failed with exit {completed.returncode}; verify the configured runtime and license", file=sys.stderr)
                return 2
            output_lines = completed.stdout.strip().splitlines()
            if not output_lines or not output.is_file():
                print("ERROR: Aspose comparison produced incomplete output; verify the configured runtime", file=sys.stderr)
                return 2
            version = output_lines[-1]
            if version not in ("25.10.0", "25.10"):
                print("ERROR: oracle must run with aspose-words==25.10", file=sys.stderr)
                return 2
            projected = project(output)
            expected = expected_projection(case_id, old_instruction, new_instruction, old_result, new_result)
            if any(projected.get(key) != value for key, value in expected.items()):
                raise ValueError(f"Aspose produced an invalid verdict for {case_id}")
            verdicts.append({"id": case_id, "originalSha256": sha256(original), "revisedSha256": sha256(revised), "outputDocumentXmlSha256": document_xml_sha256(output), **projected})

    snapshot = {
        "schemaVersion": 1,
        "generatedOn": datetime.date.today().isoformat(),
        "oracle": {"name": "Aspose.Words for Python via .NET", "package": "aspose-words", "version": "25.10"},
        "fieldCases": verdicts,
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    temporary.replace(destination)
    print(f"Wrote {destination}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except (ValueError, AssertionError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2)
    except Exception as error:
        print(f"ERROR: oracle operation failed safely ({type(error).__name__})", file=sys.stderr)
        raise SystemExit(2)
