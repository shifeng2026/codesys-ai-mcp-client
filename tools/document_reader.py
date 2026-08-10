#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
DC_NS = "{http://purl.org/dc/elements/1.1/}"


def emit(payload: dict, code: int = 0) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    return code


def fail(message: str) -> int:
    return emit({"ok": False, "error": str(message)}, 1)


def clean_text(value: str) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return re.sub(r"\n{4,}", "\n\n\n", text).strip()


def trim_result(text: str, max_chars: int) -> tuple[str, bool]:
    text = clean_text(text)
    if max_chars <= 0 or len(text) <= max_chars:
      return text, False
    marker = "\n\n[TRUNCATED]"
    return text[: max(0, max_chars - len(marker))].rstrip() + marker, True


def finish(kind: str, path: str, title: str, summary: str, text: str, max_chars: int, metadata: dict | None = None) -> dict:
    trimmed, truncated = trim_result(text, max_chars)
    meta = dict(metadata or {})
    meta["characters"] = len(clean_text(text))
    meta["truncated"] = truncated
    return {
        "ok": True,
        "kind": kind,
        "title": title or os.path.basename(path),
        "summary": summary,
        "text": trimmed,
        "metadata": meta,
    }


def zip_xml(root: zipfile.ZipFile, name: str) -> ET.Element | None:
    try:
        with root.open(name) as source:
            return ET.fromstring(source.read())
    except KeyError:
        return None


def core_title(root: zipfile.ZipFile, fallback: str) -> str:
    props = zip_xml(root, "docProps/core.xml")
    if props is None:
        return fallback
    title = props.find(f".//{DC_NS}title")
    if title is not None and title.text and title.text.strip():
        return title.text.strip()
    return fallback


def read_pdf(path: str, max_chars: int) -> dict:
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader
    except ImportError as exc:
        raise RuntimeError("PDF support requires pypdf or PyPDF2") from exc

    reader = PdfReader(path)
    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")
        except Exception:
            pass

    pages = []
    pages_with_text = 0
    total_pages = len(reader.pages)
    for index, page in enumerate(reader.pages, 1):
        try:
            page_text = clean_text(page.extract_text() or "")
        except Exception as exc:
            page_text = f"[Page {index} extraction failed: {exc}]"
        if page_text:
            pages_with_text += 1
            pages.append(f"[Page {index}]\n{page_text}")

    text = "\n\n".join(pages)
    summary = f"PDF document, {total_pages} pages, {pages_with_text} pages with extractable text"
    return finish("pdf", path, os.path.basename(path), summary, text, max_chars, {
        "pages": total_pages,
        "pagesWithText": pages_with_text,
    })


def paragraph_text(paragraph: ET.Element) -> str:
    fragments: list[str] = []
    for node in paragraph.iter():
        if node.tag == f"{WORD_NS}t" and node.text:
            fragments.append(node.text)
        elif node.tag == f"{WORD_NS}tab":
            fragments.append("\t")
        elif node.tag in (f"{WORD_NS}br", f"{WORD_NS}cr"):
            fragments.append("\n")
    return clean_text("".join(fragments))


def read_docx(path: str, max_chars: int) -> dict:
    with zipfile.ZipFile(path) as docx:
        root = zip_xml(docx, "word/document.xml")
        if root is None:
            raise RuntimeError("word/document.xml not found; this is not a valid .docx file")
        title = core_title(docx, os.path.basename(path))
        paragraphs = [paragraph_text(node) for node in root.iter(f"{WORD_NS}p")]
        paragraphs = [item for item in paragraphs if item]

    text = "\n\n".join(paragraphs)
    summary = f"Word document, {len(paragraphs)} text paragraphs"
    return finish("docx", path, title, summary, text, max_chars, {
        "paragraphs": len(paragraphs),
    })


def shared_strings(book: zipfile.ZipFile) -> list[str]:
    root = zip_xml(book, "xl/sharedStrings.xml")
    if root is None:
        return []
    values: list[str] = []
    for item in root.findall(f"{SHEET_NS}si"):
        text = "".join(node.text or "" for node in item.iter(f"{SHEET_NS}t"))
        values.append(clean_text(text))
    return values


def workbook_rels(book: zipfile.ZipFile) -> dict[str, str]:
    root = zip_xml(book, "xl/_rels/workbook.xml.rels")
    if root is None:
        return {}
    rels: dict[str, str] = {}
    for rel in root.findall(f"{PKG_REL_NS}Relationship"):
        rel_id = rel.attrib.get("Id", "")
        target = rel.attrib.get("Target", "")
        if rel_id and target:
            rels[rel_id] = target
    return rels


def normalize_xlsx_path(target: str) -> str:
    if target.startswith("/"):
        raw = target.lstrip("/")
    elif target.startswith("xl/"):
        raw = target
    else:
        raw = "xl/" + target
    parts: list[str] = []
    for part in raw.replace("\\", "/").split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def workbook_sheets(book: zipfile.ZipFile) -> list[dict[str, str]]:
    root = zip_xml(book, "xl/workbook.xml")
    if root is None:
        raise RuntimeError("xl/workbook.xml not found; this is not a valid .xlsx file")
    rels = workbook_rels(book)
    sheets: list[dict[str, str]] = []
    for sheet in root.findall(f".//{SHEET_NS}sheet"):
        name = sheet.attrib.get("name", "Sheet")
        rel_id = sheet.attrib.get(f"{REL_NS}id", "")
        target = rels.get(rel_id, "")
        if target:
            sheets.append({"name": name, "path": normalize_xlsx_path(target)})
    return sheets


def cell_text(cell: ET.Element, strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        return clean_text("".join(node.text or "" for node in cell.iter(f"{SHEET_NS}t")))

    value = cell.find(f"{SHEET_NS}v")
    raw = value.text if value is not None and value.text is not None else ""
    raw = raw.strip()
    if not raw:
        return ""
    if cell_type == "s":
        try:
            return strings[int(raw)]
        except (ValueError, IndexError):
            return raw
    if cell_type == "b":
        return "TRUE" if raw == "1" else "FALSE"
    return raw


def read_xlsx(path: str, max_chars: int) -> dict:
    with zipfile.ZipFile(path) as book:
        title = core_title(book, os.path.basename(path))
        strings = shared_strings(book)
        sheets = workbook_sheets(book)
        sections: list[str] = []
        row_count = 0
        cell_count = 0
        for sheet in sheets:
            root = zip_xml(book, sheet["path"])
            if root is None:
                continue
            sections.append(f"[Sheet: {sheet['name']}]")
            for row in root.findall(f".//{SHEET_NS}sheetData/{SHEET_NS}row"):
                cells: list[str] = []
                row_label = row.attrib.get("r", "")
                for cell in row.findall(f"{SHEET_NS}c"):
                    value = cell_text(cell, strings)
                    if not value:
                        continue
                    ref = cell.attrib.get("r", "")
                    column = re.sub(r"\d+", "", ref) or "?"
                    cells.append(f"{column}={value}")
                if cells:
                    row_count += 1
                    cell_count += len(cells)
                    label = f"Row {row_label}" if row_label else "Row"
                    sections.append(f"{label}: " + " | ".join(cells))
            sections.append("")

    text = "\n".join(sections).strip()
    summary = f"Excel workbook, {len(sheets)} sheets, {row_count} non-empty rows, {cell_count} non-empty cells"
    return finish("xlsx", path, title, summary, text, max_chars, {
        "sheets": len(sheets),
        "rows": row_count,
        "cells": cell_count,
    })


def read_text(path: str, max_chars: int) -> dict:
    data = None
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            with open(path, "r", encoding=encoding) as source:
                data = source.read()
            break
        except UnicodeDecodeError:
            continue
    if data is None:
        with open(path, "rb") as source:
            data = source.read().decode("utf-8", errors="replace")
    return finish("text", path, os.path.basename(path), "Text document", data, max_chars, {})


def read_document(path: str, max_chars: int) -> dict:
    extension = os.path.splitext(path)[1].lower()
    if extension == ".pdf":
        return read_pdf(path, max_chars)
    if extension in (".docx", ".docm"):
        return read_docx(path, max_chars)
    if extension in (".xlsx", ".xlsm"):
        return read_xlsx(path, max_chars)
    if extension in (".txt", ".md", ".csv", ".log"):
        return read_text(path, max_chars)
    if extension in (".doc", ".xls"):
        raise RuntimeError("Legacy binary Word/Excel files are not supported; please save as .docx or .xlsx")
    raise RuntimeError(f"Unsupported document type: {extension or 'unknown'}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Read PDF, Word, and Excel documents as JSON text previews.")
    parser.add_argument("--max-chars", type=int, default=120000)
    parser.add_argument("file_path")
    args = parser.parse_args(argv)

    path = os.path.abspath(args.file_path)
    if not os.path.isfile(path):
        return fail(f"File not found: {path}")

    try:
        return emit(read_document(path, args.max_chars), 0)
    except Exception as exc:
        return fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))