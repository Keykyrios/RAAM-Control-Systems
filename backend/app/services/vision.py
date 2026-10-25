from __future__ import annotations

import asyncio
import math
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import httpx

from app.core.config import settings

_LIMITER = threading.BoundedSemaphore(max(1, settings.vision_max_concurrent_requests))
_ALLOWED_EVIDENCE_SCHEMES = {"evidence", "s3", "gs", "az", "azure", "file"}


class VisionProviderNotConfigured(RuntimeError):
    """Raised when no approved inference endpoint is configured."""


class VisionProviderError(RuntimeError):
    """Raised for transport failures or invalid provider output."""


class VisionProviderBusy(RuntimeError):
    """Raised when the bounded inference queue is saturated."""


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _bounded_probability(value: Any, name: str) -> float:
    if not _is_number(value) or not 0 <= float(value) <= 1:
        raise VisionProviderError(f"Vision provider returned invalid {name}; expected a number from 0 to 1.")
    return float(value)


def _validate_image_signature(content: bytes, content_type: str) -> None:
    signatures = {
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP",
    }
    if content_type not in signatures:
        raise VisionProviderError("Upload must be JPEG, PNG or WebP.")
    if not signatures[content_type]:
        raise VisionProviderError("The file signature does not match its declared image type.")


def _validate_evidence_uri(value: Any) -> str | None:
    """Require durable, access-controlled evidence lineage.

    Public HTTP(S) URLs are refused unless an operator explicitly enables them. The
    provider must not hand the ERP a publicly readable image URL under the default policy.
    """
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise VisionProviderError("evidence_uri must be a non-empty string or null.")
    uri = value.strip()[:2000]
    scheme = urlparse(uri).scheme.lower()
    if scheme == "https" and settings.vision_allow_https_evidence:
        return uri
    if scheme not in _ALLOWED_EVIDENCE_SCHEMES:
        raise VisionProviderError(
            "Vision provider returned a non-durable or public evidence_uri. "
            "Use an access-controlled evidence://, s3://, gs:// or az:// reference."
        )
    return uri


def _normalise_response(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise VisionProviderError("Vision provider must return a JSON object.")
    confidence = _bounded_probability(payload.get("confidence"), "confidence")
    observed_quantity = payload.get("observed_quantity")
    if observed_quantity is not None and (not isinstance(observed_quantity, int) or isinstance(observed_quantity, bool) or observed_quantity < 0):
        raise VisionProviderError("Vision provider returned invalid observed_quantity; expected a non-negative integer or null.")
    occupancy_ratio = payload.get("occupancy_ratio")
    if occupancy_ratio is not None:
        occupancy_ratio = _bounded_probability(occupancy_ratio, "occupancy_ratio")

    candidates = payload.get("identifier_candidates", [])
    count_distribution = payload.get("count_distribution", [])
    detections = payload.get("detections", [])
    if not isinstance(candidates, list) or not isinstance(count_distribution, list) or not isinstance(detections, list):
        raise VisionProviderError("identifier_candidates, count_distribution and detections must be arrays.")

    clean_candidates = []
    for item in candidates[:100]:
        if not isinstance(item, dict):
            continue
        raw_score = item.get("confidence", 0)
        clean_candidates.append({
            "sku": str(item.get("sku") or "")[:120],
            "identifier": str(item.get("identifier") or "")[:160],
            "confidence": _bounded_probability(raw_score, "candidate confidence"),
            "note": str(item.get("note") or "")[:240],
        })

    clean_distribution = []
    for item in count_distribution[:200]:
        if not isinstance(item, dict):
            continue
        count = item.get("count")
        probability = item.get("probability")
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise VisionProviderError("Count posterior entries must contain a non-negative integer count.")
        clean_distribution.append({"count": count, "probability": _bounded_probability(probability, "count probability")})
    if clean_distribution:
        total_probability = sum(point["probability"] for point in clean_distribution)
        if not 0.97 <= total_probability <= 1.03:
            raise VisionProviderError("Count distribution probabilities must sum to approximately 1.0.")

    clean_detections = []
    for item in detections[:500]:
        if not isinstance(item, dict):
            continue
        box = item.get("box")
        if not isinstance(box, list) or len(box) != 4 or not all(_is_number(v) for v in box):
            continue
        x, y, width, height = [float(v) for v in box]
        if min(x, y, width, height) < 0 or x > 100 or y > 100 or width > 100 or height > 100 or x + width > 100.5 or y + height > 100.5:
            continue
        clean_detections.append({
            "label": str(item.get("label") or item.get("sku") or "Detected region")[:160],
            "sku": str(item.get("sku") or "")[:120],
            "confidence": _bounded_probability(item.get("confidence", 0), "detection confidence"),
            "box": [x, y, width, height],
            "source": str(item.get("source") or "provider")[:60],
            "note": str(item.get("note") or "")[:200],
        })

    model_version = str(payload.get("model_version") or "")[:160] or "UNVERSIONED_PROVIDER"
    evidence_uri = _validate_evidence_uri(payload.get("evidence_uri"))

    processor = payload.get("processing_ms")
    if processor is not None and (not _is_number(processor) or float(processor) < 0):
        processor = None

    limitations = payload.get("limitations", [])
    if not isinstance(limitations, list):
        limitations = []
    capabilities = payload.get("capabilities", {})
    if not isinstance(capabilities, dict):
        capabilities = {}
    frame_context = payload.get("frame_context", {})
    if not isinstance(frame_context, dict):
        frame_context = {}

    return {
        "sensor_type": "CAMERA",
        "observed_quantity": observed_quantity,
        "occupancy_ratio": occupancy_ratio,
        "identifier_candidates": clean_candidates,
        "count_distribution": clean_distribution,
        "detections": clean_detections,
        "confidence": confidence,
        "model_version": model_version,
        "evidence_uri": evidence_uri,
        "provider_status": "INFERENCE_COMPLETE",
        "provider_name": str(payload.get("provider_name") or "configured-provider")[:120],
        "capabilities": {str(key)[:60]: bool(value) for key, value in list(capabilities.items())[:20]},
        "image_quality": payload.get("image_quality") if isinstance(payload.get("image_quality"), dict) else None,
        "image_width": int(payload["image_width"]) if isinstance(payload.get("image_width"), int) else None,
        "image_height": int(payload["image_height"]) if isinstance(payload.get("image_height"), int) else None,
        "provider_processing_ms": float(processor) if processor is not None else None,
        "limitations": [str(item)[:400] for item in limitations[:12]],
        "evidence_sha256": str(payload.get("evidence_sha256") or "")[:128] or None,
        "evidence_retained_at": str(payload.get("evidence_retained_at") or "")[:80] or None,
        "provider_frame_context": {str(key)[:40]: str(value)[:120] for key, value in list(frame_context.items())[:20]},
        "evidence_policy": "Review the model output. Saving records evidence only; it never changes stock or places an order.",
    }


def _semaphore_acquire() -> bool:
    return _LIMITER.acquire(blocking=True, timeout=4.0)


async def analyze_image(
    *,
    filename: str,
    content_type: str,
    content: bytes,
    part_id: int | None,
    bin_id: int | None,
    known_sku: str | None = None,
    known_bin_code: str | None = None,
    capture_mode: str = "SNAPSHOT",
    device_id: str | None = None,
    camera_label: str | None = None,
    frame_sequence: int | None = None,
    captured_at: str | None = None,
) -> dict[str, Any]:
    if not settings.vision_provider_url:
        raise VisionProviderNotConfigured(
            "Computer-vision inference is not configured. Set VISION_PROVIDER_URL to an approved model-service endpoint; no synthetic output was generated."
        )
    _validate_image_signature(content, content_type)
    headers = {"Accept": "application/json"}
    if settings.vision_provider_api_key:
        headers["Authorization"] = f"Bearer {settings.vision_provider_api_key}"
    safe_filename = os.path.basename(filename.replace("\\", "/"))[:160] or "inventory-evidence"
    request_id = f"vis_{uuid4().hex[:16]}"
    started = time.perf_counter()

    acquired = await asyncio.to_thread(_semaphore_acquire)
    if not acquired:
        raise VisionProviderBusy("Vision inference is at capacity. Retry after the current frame completes.")
    try:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(settings.vision_provider_timeout_seconds, connect=4.0)) as client:
                response = await client.post(
                    settings.vision_provider_url,
                    headers=headers,
                    files={"image": (safe_filename, content, content_type)},
                    data={
                        "part_id": "" if part_id is None else str(part_id),
                        "bin_id": "" if bin_id is None else str(bin_id),
                        "known_sku": known_sku or "",
                        "known_bin_code": known_bin_code or "",
                        "capture_mode": capture_mode,
                        "device_id": device_id or "",
                        "camera_label": camera_label or "",
                        "frame_sequence": "" if frame_sequence is None else str(frame_sequence),
                        "captured_at": captured_at or "",
                    },
                )
        except httpx.TimeoutException as exc:
            raise VisionProviderError("Vision provider timed out before returning a frame result.") from exc
        except httpx.HTTPError as exc:
            raise VisionProviderError("Could not reach the configured vision provider.") from exc
        if response.status_code >= 400:
            raise VisionProviderError(f"Vision provider returned HTTP {response.status_code} for inference.")
        try:
            payload = response.json()
        except ValueError as exc:
            raise VisionProviderError("Vision provider returned invalid JSON.") from exc
        result = _normalise_response(payload)
        latency_ms = round((time.perf_counter() - started) * 1000.0, 1)
        result["analysis_meta"] = {
            "request_id": request_id,
            "capture_mode": capture_mode,
            "device_id": device_id,
            "camera_label": camera_label,
            "frame_sequence": frame_sequence,
            "captured_at": captured_at,
            "received_at": datetime.now(timezone.utc).isoformat(),
            "latency_ms": latency_ms,
            "provider_configured": True,
        }
        return result
    finally:
        _LIMITER.release()


def status() -> dict[str, Any]:
    return {
        "provider_configured": bool(settings.vision_provider_url),
        "provider_health": "configured" if settings.vision_provider_url else "not_configured",
        "max_image_bytes": settings.vision_max_image_bytes,
        "max_concurrent_requests": settings.vision_max_concurrent_requests,
        "provider_timeout_seconds": settings.vision_provider_timeout_seconds,
        "evidence_public_https_allowed": settings.vision_allow_https_evidence,
        "live_camera": {
            "supported": True,
            "requires_secure_context": True,
            "default_interval_ms": settings.live_camera_default_interval_ms,
            "min_interval_ms": settings.live_camera_min_interval_ms,
            "max_interval_ms": settings.live_camera_max_interval_ms,
            "max_frame_side": settings.live_camera_max_frame_side,
            "transport": "per-frame multipart HTTP with client-side backpressure",
        },
        "count_model": "NOT_CONFIGURED",
        "occupancy_model": "NOT_CONFIGURED",
        "note": "Live frames are analyzed only when an approved provider is configured. Count and occupancy remain null without calibrated models.",
    }
