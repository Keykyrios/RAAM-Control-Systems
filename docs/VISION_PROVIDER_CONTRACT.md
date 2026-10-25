# Computer-vision provider contract

## Status

The ERP contains an upload and review workbench and a FastAPI adapter. It does **not** include a trained SKU detector, OCR engine, barcode recognizer or physical-count model. The adapter refuses inference when the provider URL is absent. Synthetic overlays are front-end-only and cannot be saved as observations.

## Configure

Set in the API environment:

```dotenv
VISION_PROVIDER_URL=https://your-approved-private-model-service.example/inventory/analyze
VISION_PROVIDER_API_KEY=replace-with-a-secret-if-required
VISION_MAX_IMAGE_BYTES=10485760
```

`VISION_PROVIDER_URL` must point to an approved service endpoint that stores original evidence in access-controlled object storage. It should accept `multipart/form-data`, with fields:

- `image`: JPEG, PNG or WebP bytes;
- `part_id`: optional numeric database ID as a string;
- `bin_id`: optional numeric database ID as a string.

The ERP validates MIME type, common file signature and upload size, uses a 30-second provider timeout, optionally forwards the bearer key, and normalizes the response. Do not expose provider credentials to the browser.

## Provider JSON response

```json
{
  "observed_quantity": 14,
  "occupancy_ratio": 0.72,
  "identifier_candidates": [
    { "sku": "BRK-014", "identifier": "BRK-014", "confidence": 0.91, "note": "OCR label match" }
  ],
  "count_distribution": [
    { "count": 13, "probability": 0.15 },
    { "count": 14, "probability": 0.65 },
    { "count": 15, "probability": 0.20 }
  ],
  "detections": [
    { "label": "brake pad package", "sku": "BRK-014", "confidence": 0.91, "box": [12, 18, 22, 30] }
  ],
  "confidence": 0.87,
  "model_version": "inventory-vision-1.3.0",
  "evidence_uri": "s3://restricted-bucket/site-04/observations/obs-unique-id.jpg"
}
```

Contract notes:

- `observed_quantity` is a non-negative integer or `null` when the model cannot justify a single count.
- `occupancy_ratio` is a number in `[0, 1]` or `null`.
- all confidence/probability values must be finite numbers in `[0, 1]`.
- a non-empty `count_distribution` must sum to approximately `1.0` (tolerance ±0.03). Preserve the distribution instead of replacing it with its most likely count.
- detection `box` is `[x, y, width, height]` in normalized **percentage** coordinates, each bounded to the image canvas `[0,100]`.
- the response must be JSON. Candidate/detection arrays are bounded by the adapter.
- `evidence_uri` must be durable and access-controlled. The ERP does not fetch/render this URI directly; it is retained as evidence lineage. The provider must not return public object URLs by default.

## Interaction path

1. The operator uploads an image; browser-side validation accepts JPEG, PNG or WebP up to 10 MB. They can associate it with a part from `GET /api/v1/parts` and a storage bin from `GET /api/v1/locations`; either association may remain blank for collection-level identification. Changing the selected target clears any stale inference result.
2. `POST /api/v1/vision/analyze` forwards the image and selected part/bin context to the provider. Without `VISION_PROVIDER_URL`, the API returns HTTP 503 and generates no prediction.
3. The operator reviews bounding boxes, identifier candidates, confidence and count posterior.
4. The operator explicitly chooses **Save as physical evidence**. The frontend posts the reviewed normalized values, selected part/bin IDs and model version/detections/count distribution metadata to `POST /api/v1/observations`. A durable provider `evidence_uri` is required before save is enabled.
5. That operation records an observation only. It does not adjust stock, automatically collapse the physical posterior, create a reconciliation accusation or place a purchase order.

## Required production hardening

Authenticate the operator; verify part/bin permissions; apply rate limits; store images in encrypted, private object storage; set retention and deletion/hold behavior; record every image read/export; add request IDs and safe logs; monitor provider latency and quality; evaluate model calibration on labeled counts; and test image/metadata redaction. The API starter currently provides only the provider adapter's transport/input checks, not the full production security layer.
