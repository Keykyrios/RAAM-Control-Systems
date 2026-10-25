"""Real, local computer-vision evidence provider.

This service performs deterministic image analysis on the exact frame supplied by the
ERP: QR/barcode decoding, ArUco bin-tag recognition and Tesseract OCR. It does not
invent a part count or occupancy value. Those fields are null unless a calibrated
model is added, and the response states that limitation explicitly.
"""
from __future__ import annotations

import hashlib
import hmac
import math
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytesseract
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pytesseract import Output

MAX_BYTES = int(os.getenv("VISION_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
MAX_SIDE = int(os.getenv("VISION_MAX_PROCESS_SIDE", "1600"))
EVIDENCE_DIR = Path(os.getenv("VISION_EVIDENCE_DIR", "/data/evidence"))
API_KEY = os.getenv("VISION_PROVIDER_API_KEY", "").strip()
MODEL_VERSION = os.getenv("VISION_MODEL_VERSION", "raam-opencv-evidence-1.0.0")
MAX_DETECTIONS = 200
MAX_CANDIDATES = 60
MAX_OCR_WORDS = 60

SIGNATURES = {
    "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda b: len(b) >= 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP",
}
EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

app = FastAPI(title="RAAM Vision Evidence Provider", version="1.0.0")
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


def _authorize(authorization: str | None) -> None:
    if not API_KEY:
        return
    expected = f"Bearer {API_KEY}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Provider access key is invalid.")


def _clamp_box(points: np.ndarray, width: int, height: int) -> list[float] | None:
    points = np.asarray(points, dtype=float).reshape(-1, 2)
    if points.size < 8:
        return None
    x0 = max(0.0, float(points[:, 0].min()))
    y0 = max(0.0, float(points[:, 1].min()))
    x1 = min(float(width), float(points[:, 0].max()))
    y1 = min(float(height), float(points[:, 1].max()))
    if x1 <= x0 or y1 <= y0:
        return None
    return [
        round(x0 / width * 100.0, 3),
        round(y0 / height * 100.0, 3),
        round((x1 - x0) / width * 100.0, 3),
        round((y1 - y0) / height * 100.0, 3),
    ]


def _bbox_from_rect(x: int, y: int, w: int, h: int, width: int, height: int) -> list[float] | None:
    if w <= 0 or h <= 0:
        return None
    points = np.array([[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]], dtype=float)
    return _clamp_box(points, width, height)


def _dedupe(items: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        value = str(item.get(key) or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(item)
    return result


def decode_qr(image: np.ndarray, height: int, width: int) -> tuple[list[dict], list[dict], bool]:
    detections: list[dict] = []
    candidates: list[dict] = []
    detector = cv2.QRCodeDetector()
    try:
        ok, decoded, points, _ = detector.detectAndDecodeMulti(image)
    except cv2.error:
        return detections, candidates, False
    if not ok or points is None:
        return detections, candidates, True
    for index, payload in enumerate(decoded or []):
        if not payload or index >= len(points):
            continue
        box = _clamp_box(points[index], width, height)
        if box is None:
            continue
        payload = str(payload)[:240]
        detections.append({
            "label": "QR code",
            "sku": payload,
            "confidence": 0.98,
            "box": box,
            "source": "qr_decoder",
            "note": "Decoded with QR error correction and format validation.",
        })
        candidates.append({
            "identifier": payload,
            "sku": payload,
            "confidence": 0.98,
            "note": "QR decoder payload (validated symbol)",
        })
    return detections, candidates, True


def decode_barcodes(image: np.ndarray, height: int, width: int) -> tuple[list[dict], list[dict], bool]:
    detections: list[dict] = []
    candidates: list[dict] = []
    if not hasattr(cv2, "barcode"):
        return detections, candidates, False
    try:
        detector = cv2.barcode.BarcodeDetector()
        ok, decoded, types, points = detector.detectAndDecodeWithType(image)
    except (cv2.error, AttributeError):
        return detections, candidates, True
    if not ok or points is None:
        return detections, candidates, True
    for index, payload in enumerate(decoded or []):
        if not payload or index >= len(points):
            continue
        box = _clamp_box(points[index], width, height)
        if box is None:
            continue
        payload = str(payload)[:240]
        symbol = str(types[index]) if types is not None and index < len(types) else "barcode"
        detections.append({
            "label": f"Barcode ({symbol})",
            "sku": payload,
            "confidence": 0.96,
            "box": box,
            "source": "barcode_decoder",
            "note": "Decoded symbology with checksum validation where applicable.",
        })
        candidates.append({
            "identifier": payload,
            "sku": payload,
            "confidence": 0.96,
            "note": f"{symbol} decoder payload",
        })
    return detections, candidates, True


def decode_aruco(gray: np.ndarray, height: int, width: int) -> tuple[list[dict], list[dict], bool]:
    if not hasattr(cv2, "aruco"):
        return [], [], False
    detections: list[dict] = []
    candidates: list[dict] = []
    supported = ["DICT_4X4_50", "DICT_5X5_50", "DICT_6X6_50", "DICT_7X7_50"]
    for dictionary_name in supported:
        try:
            dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dictionary_name))
            detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
            corners, ids, _ = detector.detectMarkers(gray)
        except (cv2.error, AttributeError):
            return detections, candidates, True
        if ids is None:
            continue
        for marker_corners, marker_id in zip(corners, ids.flatten()):
            box = _clamp_box(marker_corners, width, height)
            if box is None:
                continue
            identifier = f"ARUCO:{dictionary_name}:{int(marker_id)}"
            detections.append({
                "label": f"ArUco marker {int(marker_id)}",
                "sku": identifier,
                "confidence": 0.99,
                "box": box,
                "source": "aruco_detector",
                "note": f"{dictionary_name} fiducial marker.",
            })
            candidates.append({
                "identifier": identifier,
                "sku": identifier,
                "confidence": 0.99,
                "note": f"{dictionary_name} fiducial marker id {int(marker_id)}",
            })
    return detections, candidates, True


def decode_ocr(image: np.ndarray, height: int, width: int) -> tuple[list[dict], list[dict], bool]:
    try:
        data = pytesseract.image_to_data(image, output_type=Output.DICT, config="--psm 11")
    except (pytesseract.TesseractNotFoundError, pytesseract.TesseractError, OSError):
        return [], [], False
    detections: list[dict] = []
    candidates: list[dict] = []
    count = len(data.get("text", []))
    for index in range(min(count, 1000)):
        text = str(data["text"][index] or "").strip()
        if len(text) < 4:
            continue
        try:
            score = float(data["conf"][index])
        except (TypeError, ValueError):
            continue
        if not math.isfinite(score) or score < 45:
            continue
        box = _bbox_from_rect(int(data["left"][index]), int(data["top"][index]),
                              int(data["width"][index]), int(data["height"][index]), width, height)
        if box is None:
            continue
        confidence = round(min(0.95, max(0.0, score / 100.0)), 4)
        detections.append({
            "label": text[:60],
            "sku": "",
            "confidence": confidence,
            "box": box,
            "source": "tesseract_ocr",
            "note": "OCR text region; not a verified part identifier.",
        })
        compact = "".join(ch for ch in text.upper() if ch.isalnum() or ch in "-_/.")
        if len(compact) >= 4:
            candidates.append({
                "identifier": compact[:80],
                "sku": "",
                "confidence": confidence,
                "note": "OCR token; requires human confirmation",
            })
        if len(detections) >= MAX_OCR_WORDS:
            break
    return detections, candidates, True


def _image_quality(gray: np.ndarray) -> dict[str, Any]:
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray))
    return {
        "sharpness_laplacian_variance": round(sharpness, 3),
        "brightness_mean": round(brightness, 3),
        "low_sharpness": sharpness < 80.0,
        "low_light": brightness < 45.0,
        "overexposed": brightness > 215.0,
    }


def _match_known_sku(candidates: list[dict], known_sku: str | None) -> list[dict]:
    target = (known_sku or "").strip().upper()
    if not target:
        return candidates
    matched = False
    for candidate in candidates:
        values = {str(candidate.get("identifier") or "").upper(), str(candidate.get("sku") or "").upper()}
        if target in values:
            candidate["sku"] = known_sku or candidate.get("sku") or ""
            candidate["note"] = f"{candidate.get('note', '')} Matches selected SKU {known_sku}."
            matched = True
    if not matched:
        candidates.append({
            "identifier": known_sku or "",
            "sku": known_sku or "",
            "confidence": 0.0,
            "note": "Selected SKU context supplied by the ERP; no decoded label matched it.",
        })
    return candidates


@app.get("/health")
def health() -> dict[str, Any]:
    capabilities = {
        "qr": hasattr(cv2, "QRCodeDetector"),
        "barcode": hasattr(cv2, "barcode"),
        "aruco": hasattr(cv2, "aruco"),
        "ocr": True,
    }
    try:
        version = str(pytesseract.get_tesseract_version())
    except Exception:  # pragma: no cover - only when tesseract is absent
        version = "unavailable"
        capabilities["ocr"] = False
    return {
        "status": "ok",
        "provider": "raam-opencv-evidence",
        "model_version": MODEL_VERSION,
        "opencv_version": cv2.__version__,
        "tesseract_version": version,
        "capabilities": capabilities,
        "count_model": "NOT_CONFIGURED",
        "occupancy_model": "NOT_CONFIGURED",
        "evidence_store": "private-local-volume",
        "max_image_bytes": MAX_BYTES,
    }


@app.post("/analyze")
async def analyze(
    image: UploadFile = File(...),
    part_id: str | None = Form(default=None),
    bin_id: str | None = Form(default=None),
    known_sku: str | None = Form(default=None),
    known_bin_code: str | None = Form(default=None),
    capture_mode: str | None = Form(default=None),
    device_id: str | None = Form(default=None),
    frame_sequence: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _authorize(authorization)
    started = time.perf_counter()
    content_type = (image.content_type or "").lower()
    signature = SIGNATURES.get(content_type)
    if signature is None:
        raise HTTPException(status_code=415, detail="Frame must be JPEG, PNG or WebP.")
    content = await image.read(MAX_BYTES + 1)
    await image.close()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Frame exceeds the {MAX_BYTES}-byte limit.")
    if not content or not signature(content):
        raise HTTPException(status_code=415, detail="Frame signature does not match its declared image type.")

    raw = np.frombuffer(content, dtype=np.uint8)
    decoded = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if decoded is None:
        raise HTTPException(status_code=422, detail="Frame could not be decoded as an image.")
    height, width = decoded.shape[:2]
    if width < 16 or height < 16:
        raise HTTPException(status_code=422, detail="Frame is too small for evidence analysis.")
    if width * height > 40_000_000:
        raise HTTPException(status_code=422, detail="Frame pixel dimensions exceed the analysis limit.")

    work = decoded
    longest = max(width, height)
    if longest > MAX_SIDE:
        scale = MAX_SIDE / longest
        work = cv2.resize(decoded, (max(1, int(width * scale)), max(1, int(height * scale))),
                          interpolation=cv2.INTER_AREA)
    work_height, work_width = work.shape[:2]
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)

    detections: list[dict] = []
    candidates: list[dict] = []
    capabilities: dict[str, bool] = {}
    for name, decoder, arguments in (
        ("qr", decode_qr, (work, work_height, work_width)),
        ("barcode", decode_barcodes, (work, work_height, work_width)),
        ("aruco", decode_aruco, (gray, work_height, work_width)),
        ("ocr", decode_ocr, (work, work_height, work_width)),
    ):
        try:
            found, identifiers, available = decoder(*arguments)
        except Exception:  # A single detector failure must not fabricate or crash the response.
            found, identifiers, available = [], [], False
        capabilities[name] = available
        detections.extend(found)
        candidates.extend(identifiers)

    detections = _dedupe(detections, "label")[:MAX_DETECTIONS]
    candidates = _dedupe(candidates, "identifier")[:MAX_CANDIDATES]
    candidates = _match_known_sku(candidates, known_sku)
    quality = _image_quality(gray)

    evidence_id = f"{uuid.uuid4().hex}{EXTENSIONS[content_type]}"
    evidence_path = EVIDENCE_DIR / evidence_id
    evidence_path.write_bytes(content)
    evidence_uri = f"evidence://raam-vision/{evidence_id}"
    digest = hashlib.sha256(content).hexdigest()

    decode_scores = [float(item["confidence"]) for item in detections if item.get("source") in {"qr_decoder", "barcode_decoder", "aruco_detector"}]
    confidence = round(max(decode_scores), 4) if decode_scores else 0.0
    processing_ms = round((time.perf_counter() - started) * 1000.0, 1)
    limitations = [
        "No calibrated part-count model is configured. observed_quantity is null and count_distribution is empty.",
        "No calibrated volume model is configured. occupancy_ratio is null.",
        "OCR candidates require human confirmation and are not verified SKUs.",
        "Fiducial and barcode identifiers are evidence, not inventory adjustments.",
    ]
    return {
        "observed_quantity": None,
        "occupancy_ratio": None,
        "identifier_candidates": candidates,
        "count_distribution": [],
        "detections": detections,
        "confidence": confidence,
        "model_version": f"{MODEL_VERSION}+opencv-{cv2.__version__}",
        "evidence_uri": evidence_uri,
        "provider_name": "raam-opencv-evidence",
        "capabilities": capabilities,
        "image_quality": quality,
        "image_width": width,
        "image_height": height,
        "processing_ms": processing_ms,
        "frame_context": {
            "part_id": part_id,
            "bin_id": bin_id,
            "known_sku": known_sku,
            "known_bin_code": known_bin_code,
            "capture_mode": capture_mode,
            "device_id": device_id,
            "frame_sequence": frame_sequence,
        },
        "evidence_sha256": digest,
        "evidence_retained_at": datetime.now(timezone.utc).isoformat(),
        "limitations": limitations,
    }


@app.get("/evidence/{evidence_id}")
def evidence(evidence_id: str, authorization: str | None = Header(default=None)) -> FileResponse:
    """Access-controlled evidence read. Requires the provider key when configured."""
    _authorize(authorization)
    safe_name = Path(evidence_id).name
    if safe_name != evidence_id or "." not in safe_name:
        raise HTTPException(status_code=400, detail="Invalid evidence identifier.")
    path = EVIDENCE_DIR / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Evidence is not retained.")
    return FileResponse(path, filename=safe_name)
