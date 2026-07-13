"""
PDF Catalog Importer — extracts product listings from a PDF catalog.

Strategy (in order):
  1. Table extraction — if PDF has proper tables with headers, map columns directly
  2. Pattern matching — scan raw text for price signals (₹ or INR) + nearby text
  3. OCR fallback — if the PDF has no text layer (image-only catalog), render each
     page and run Tesseract, then re-run pattern matching on the OCR'd text
  4. Returns a list of extracted products for the merchant to review/confirm before saving
"""
import re
import io
import logging
from typing import IO

logger = logging.getLogger(__name__)

# Price patterns: ₹1,299 / Rs.1299 / INR 1299 / 1299/- / 1,299.00
PRICE_RE = re.compile(
    r"(?:₹|Rs\.?|INR|MRP:?|Price:?|Rate:?)\s*[\s]*([\d,]+(?:\.\d{1,2})?)"
    r"|(\d[\d,]+(?:\.\d{1,2})?)\s*(?:/[-–]|rupees?|INR)",
    re.IGNORECASE,
)
SKU_RE = re.compile(r"(?:SKU|Item\s*(?:No|Code|#)|Product\s*(?:No|Code|#))[\s:.-]*([A-Z0-9\-_]{3,20})", re.IGNORECASE)


def _clean_price(raw: str) -> float:
    try:
        return float(raw.replace(",", "").strip())
    except Exception:
        return 0.0


def _extract_from_tables(pdf_path_or_bytes) -> list[dict]:
    """Try to parse product tables. Returns [] if no usable tables found."""
    try:
        import pdfplumber
        products = []
        if isinstance(pdf_path_or_bytes, (bytes, bytearray)):
            f = io.BytesIO(pdf_path_or_bytes)
        else:
            f = pdf_path_or_bytes

        with pdfplumber.open(f) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    header_row = [str(h or "").strip().lower() for h in table[0]]
                    if not header_row or not any(h for h in header_row):
                        continue

                    # Map columns
                    col = {}
                    for i, h in enumerate(header_row):
                        if any(k in h for k in ("name", "product", "item", "description", "desc", "title")):
                            col.setdefault("name", i)
                        if any(k in h for k in ("price", "rate", "mrp", "cost", "amount", "₹")):
                            col.setdefault("price", i)
                        if any(k in h for k in ("sku", "code", "id", "item no", "product no", "hsn")):
                            col.setdefault("sku", i)
                        if any(k in h for k in ("qty", "stock", "quantity", "inventory")):
                            col.setdefault("stock", i)
                        if any(k in h for k in ("category", "cat", "type", "group")):
                            col.setdefault("category", i)
                        if any(k in h for k in ("mrp", "maximum", "max price")):
                            col.setdefault("mrp", i)

                    if "name" not in col and "price" not in col:
                        continue  # Not a product table

                    for row in table[1:]:
                        if not row or all(not c for c in row):
                            continue
                        def cell(key):
                            idx = col.get(key)
                            return str(row[idx] or "").strip() if idx is not None and idx < len(row) else ""

                        name = cell("name")
                        if not name or len(name) < 2:
                            continue

                        price_raw = cell("price")
                        price_m = PRICE_RE.search(price_raw) if price_raw else None
                        price_str = (price_m.group(1) or price_m.group(2)) if price_m else price_raw
                        price = _clean_price(price_str)

                        mrp_raw = cell("mrp")
                        mrp = _clean_price(PRICE_RE.search(mrp_raw).group(1) if PRICE_RE.search(mrp_raw) else mrp_raw) if mrp_raw else price

                        products.append({
                            "name": name[:120],
                            "sku": cell("sku") or "",
                            "price": price,
                            "mrp": mrp if mrp >= price else price,
                            "stock": int(cell("stock")) if cell("stock").isdigit() else 0,
                            "category": cell("category"),
                            "source": "pdf_table",
                        })

        return products
    except Exception as e:
        logger.debug(f"Table extraction failed: {e}")
        return []


def _ocr_pages(pdf_path_or_bytes) -> str:
    """
    OCR fallback for image-only PDFs. Renders each page at 300 DPI and runs
    Tesseract. Returns the concatenated OCR text (empty string on failure).
    """
    try:
        import fitz  # pymupdf
        import pytesseract
        from PIL import Image
    except Exception as e:
        logger.info("OCR skipped — pymupdf/pytesseract/Pillow not available: %s", e)
        return ""

    try:
        data = pdf_path_or_bytes
        if isinstance(data, (bytes, bytearray)):
            doc = fitz.open(stream=bytes(data), filetype="pdf")
        else:
            doc = fitz.open(data)
    except Exception as e:
        logger.warning("OCR: pymupdf failed to open PDF: %s", e)
        return ""

    ocr_text: list[str] = []
    zoom = 300 / 72  # 300 DPI for OCR-friendly render
    matrix = fitz.Matrix(zoom, zoom)
    try:
        for page_idx, page in enumerate(doc):
            try:
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                # config: assume a page of text with default English + Hindi
                text = pytesseract.image_to_string(
                    img, lang="eng", config="--psm 6 --oem 3"
                )
                if text and text.strip():
                    ocr_text.append(text)
                logger.info("OCR page %d → %d chars", page_idx + 1, len(text or ""))
            except pytesseract.TesseractNotFoundError:
                logger.warning("OCR aborted — tesseract binary not installed on host")
                return ""
            except Exception as e:
                logger.warning("OCR: page %d failed: %s", page_idx + 1, e)
    finally:
        try:
            doc.close()
        except Exception:
            pass

    return "\n\n".join(ocr_text)


def _products_from_raw_text(full_text: str, source: str) -> list[dict]:
    """
    Shared block-scanner used by both text-layer and OCR paths. Splits `full_text`
    into paragraph blocks, finds a price in each, treats the first substantial line
    as the product name.
    """
    products: list[dict] = []
    blocks = re.split(r"\n{2,}", full_text)
    for block in blocks:
        block = block.strip()
        if len(block) < 5:
            continue
        price_match = PRICE_RE.search(block)
        if not price_match:
            continue
        price = _clean_price(price_match.group(1) or price_match.group(2) or "0")
        if price <= 0:
            continue

        lines = [l.strip() for l in block.splitlines() if l.strip()]
        # First line that isn't just a price → product name
        name = ""
        for l in lines:
            if not PRICE_RE.fullmatch(l) and len(l) >= 3:
                name = l
                break
        if not name:
            name = lines[0] if lines else block[:80]
        if len(name) < 3 or name.lower() in ("page", "total", "subtotal", "grand total", "amount"):
            continue

        desc_lines = [l for l in lines[1:] if not PRICE_RE.search(l)]
        description = " ".join(desc_lines[:3])[:200]

        sku_m = SKU_RE.search(block)
        sku = sku_m.group(1) if sku_m else ""

        products.append({
            "name": name[:120],
            "sku": sku,
            "price": price,
            "mrp": price,
            "stock": 0,
            "category": "",
            "description": description,
            "source": source,
        })
    return products


def _extract_from_text(pdf_path_or_bytes) -> list[dict]:
    """Scan raw text for product name + price patterns."""
    try:
        import pdfplumber
        if isinstance(pdf_path_or_bytes, (bytes, bytearray)):
            f = io.BytesIO(pdf_path_or_bytes)
        else:
            f = pdf_path_or_bytes

        with pdfplumber.open(f) as pdf:
            full_text = "\n".join(
                (page.extract_text() or "") for page in pdf.pages
            )

        return _products_from_raw_text(full_text, source="pdf_text")
    except Exception as e:
        logger.debug(f"Text extraction failed: {e}")
        return []


def _extract_from_ocr(pdf_path_or_bytes) -> list[dict]:
    """OCR the PDF pages, then run the same block scanner as text extraction."""
    ocr_text = _ocr_pages(pdf_path_or_bytes)
    if not ocr_text.strip():
        return []
    return _products_from_raw_text(ocr_text, source="pdf_ocr")


def parse_pdf_catalog(file_bytes: bytes) -> list[dict]:
    """
    Main entry point. Returns a list of product dicts for merchant review.
    Each product: {name, sku, price, mrp, stock, category, description, source}

    Fallback order:
      1. Table extraction (fastest, best structured PDFs)
      2. Text-layer pattern matching
      3. OCR pattern matching (image-only PDFs — needs tesseract on host)
    """
    products = _extract_from_tables(file_bytes)
    if not products:
        products = _extract_from_text(file_bytes)
    if not products:
        # OCR fallback — slow (~5-15s), only invoked if the PDF has no text layer
        logger.info("Text extraction yielded 0 products; falling back to OCR")
        products = _extract_from_ocr(file_bytes)

    # Deduplicate by name (case-insensitive)
    seen = set()
    unique = []
    for p in products:
        key = p["name"].lower().strip()
        if key not in seen and p.get("price", 0) > 0:
            seen.add(key)
            unique.append(p)

    return unique
