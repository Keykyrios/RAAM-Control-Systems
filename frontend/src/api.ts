export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export type Health = { status: string; environment: string; demo_mode: boolean };
export type Overview = { parts: number; events: number; observations: number; open_reconciliation_cases: number; active_sites: number; unit_iri?: number | null; snapshots_with_physical_estimate?: number; data_source: string; source_class: string; note: string };

export async function getHealth(): Promise<Health> {
  const response = await fetch(`${API_BASE}/api/v1/health`, { signal: AbortSignal.timeout(1800) });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}
export async function getOverview(): Promise<Overview> {
  const response = await fetch(`${API_BASE}/api/v1/overview`, { signal: AbortSignal.timeout(1800) });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}
export async function postEvent(payload: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}/api/v1/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `API ${response.status}`);
  return data;
}

export type StorageLocationRecord = {
  id: number; code: string; name: string; site_code: string; capacity_volume: number;
  bins: { id: number; code: string; capacity_volume: number; coordinates: [number | null, number | null, number | null] }[];
};
export async function getLocations(): Promise<{ items: StorageLocationRecord[] }> {
  const response = await fetch(`${API_BASE}/api/v1/locations`, { signal: AbortSignal.timeout(3500) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Could not load storage locations (${response.status})`);
  return data as { items: StorageLocationRecord[] };
}

export type VisionCandidate = { sku?: string; identifier?: string; confidence: number; note?: string };
export type VisionCountProbability = { count: number; probability: number };
export type VisionDetection = {
  label: string;
  sku?: string;
  confidence: number;
  box: [number, number, number, number];
  source?: string;
  note?: string;
};
export type VisionImageQuality = {
  sharpness_laplacian_variance?: number;
  brightness_mean?: number;
  low_sharpness?: boolean;
  low_light?: boolean;
  overexposed?: boolean;
};
export type VisionAnalysisMeta = {
  request_id: string;
  capture_mode: string;
  device_id: string | null;
  camera_label: string | null;
  frame_sequence: number | null;
  captured_at: string | null;
  received_at: string;
  latency_ms: number;
  provider_configured: boolean;
};
export type VisionAnalysis = {
  sensor_type: 'CAMERA';
  observed_quantity: number | null;
  occupancy_ratio: number | null;
  identifier_candidates: VisionCandidate[];
  count_distribution: VisionCountProbability[];
  detections: VisionDetection[];
  confidence: number;
  model_version: string;
  evidence_uri: string | null;
  provider_status: string;
  provider_name: string;
  capabilities: Record<string, boolean>;
  image_quality: VisionImageQuality | null;
  image_width: number | null;
  image_height: number | null;
  provider_processing_ms: number | null;
  limitations: string[];
  evidence_sha256: string | null;
  analysis_meta: VisionAnalysisMeta;
  evidence_policy: string;
};

export type LiveCameraStatus = {
  supported: boolean;
  requires_secure_context: boolean;
  default_interval_ms: number;
  min_interval_ms: number;
  max_interval_ms: number;
  max_frame_side: number;
  transport: string;
};
export type VisionStatus = {
  provider_configured: boolean;
  provider_health: string;
  max_image_bytes: number;
  max_concurrent_requests: number;
  provider_timeout_seconds: number;
  evidence_public_https_allowed: boolean;
  live_camera: LiveCameraStatus;
  count_model: string;
  occupancy_model: string;
  note: string;
};

export async function getVisionStatus(): Promise<VisionStatus> {
  const response = await fetch(`${API_BASE}/api/v1/vision/status`, { signal: AbortSignal.timeout(4000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Could not read vision status (${response.status})`);
  return data as VisionStatus;
}

export type FrameCaptureMode = 'LIVE_CAMERA' | 'SNAPSHOT' | 'UPLOAD' | 'AUDIT';
export type FrameAnalysisContext = {
  partId?: number;
  binId?: number;
  captureMode: FrameCaptureMode;
  deviceId?: string;
  cameraLabel?: string;
  frameSequence?: number;
  capturedAt: string;
};

export async function analyzeVisionFrame(blob: Blob, context: FrameAnalysisContext, signal?: AbortSignal): Promise<VisionAnalysis> {
  const form = new FormData();
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  form.append('image', new File([blob], `camera-frame-${Date.now()}.${extension}`, { type: blob.type || 'image/jpeg' }));
  if (context.partId !== undefined) form.append('part_id', String(context.partId));
  if (context.binId !== undefined) form.append('bin_id', String(context.binId));
  form.append('capture_mode', context.captureMode);
  if (context.deviceId) form.append('device_id', context.deviceId);
  if (context.cameraLabel) form.append('camera_label', context.cameraLabel);
  if (context.frameSequence !== undefined) form.append('frame_sequence', String(context.frameSequence));
  form.append('captured_at', context.capturedAt);
  const response = await fetch(`${API_BASE}/api/v1/vision/analyze`, { method: 'POST', body: form, signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || `Vision inference failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as VisionAnalysis;
}

export type ObservationCreatePayload = {
  part_id: number | null;
  bin_id: number | null;
  sensor_type: 'CAMERA';
  observed_quantity: number | null;
  occupancy_ratio: number | null;
  identifier_candidates: VisionCandidate[];
  count_distribution: VisionCountProbability[];
  detections: VisionDetection[];
  confidence: number;
  evidence_uri: string;
  capture_mode: FrameCaptureMode;
  device_id?: string;
  camera_label?: string;
  captured_at?: string;
  frame_sequence?: number;
  inference_latency_ms?: number;
  model_version?: string;
  provider_request_id?: string;
  metadata: Record<string, unknown>;
  source_class?: 'RAAM_OBSERVED';
};

export async function createObservation(payload: ObservationCreatePayload): Promise<{ observation_id: string; status: string; message: string; stock_changed: boolean }> {
  const response = await fetch(`${API_BASE}/api/v1/observations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((item: { msg?: string }) => item.msg || 'Invalid value').join('. ') : data.detail;
    throw new Error(detail || `Could not save observation (${response.status})`);
  }
  return data;
}

export type ReconciliationCaseRecord = {
  case_id: string;
  part_id: number | null;
  event_id: string | null;
  case_type: string;
  expected_quantity: number | null;
  observed_quantity: number | null;
  posterior_unresolved_probability: number;
  economic_exposure: number;
  priority_score: number;
  status: string;
  assigned_to: string | null;
  evidence_path: Record<string, unknown>[];
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  source_class: string;
};
export async function getReconciliationCases(status = 'OPEN'): Promise<{ items: ReconciliationCaseRecord[] }> {
  const query = status && status !== 'All' ? `?status=${encodeURIComponent(status.toUpperCase())}` : '';
  const response = await fetch(`${API_BASE}/api/v1/reconciliation/cases${query}`, { signal: AbortSignal.timeout(4000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Could not load reconciliation cases (${response.status})`);
  return data as { items: ReconciliationCaseRecord[] };
}
export async function assignReconciliationCase(caseId: string, assignedTo: string, actorId: string) {
  const response = await fetch(`${API_BASE}/api/v1/reconciliation/cases/${encodeURIComponent(caseId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assigned_to: assignedTo, actor_id: actorId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Could not assign the case (${response.status})`);
  return data;
}
export async function resolveReconciliationCase(caseId: string, resolution: string, actorId: string, evidence: Record<string, unknown>[] = []) {
  const response = await fetch(`${API_BASE}/api/v1/reconciliation/cases/${encodeURIComponent(caseId)}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution, actor_id: actorId, evidence }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Could not resolve the case (${response.status})`);
  return data;
}

export type LedgerEventRecord = {
  event_id: string;
  part_id: number;
  event_type: string;
  quantity: number;
  actor_id: string;
  source_location: string | null;
  destination_location: string | null;
  job_id: string | null;
  vehicle_id: string | null;
  document_id: string | null;
  dock: string | null;
  occurred_at: string;
  recorded_at: string;
  idempotency_key: string | null;
  corrects_event_id: string | null;
  metadata: Record<string, unknown>;
  event_hash: string;
  previous_hash: string | null;
  source_class: string;
};
export async function getEvents(limit = 200): Promise<{ items: LedgerEventRecord[] }> {
  const response = await fetch(`${API_BASE}/api/v1/events?limit=${limit}`, { signal: AbortSignal.timeout(4000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Could not load the movement ledger (${response.status})`);
  return data as { items: LedgerEventRecord[] };
}
export type IntegrityResult = { valid: boolean; checked_events: number; error: string | null; interpretation: string };
export async function getLedgerIntegrity(): Promise<IntegrityResult> {
  const response = await fetch(`${API_BASE}/api/v1/events/integrity`, { signal: AbortSignal.timeout(4000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Could not verify ledger integrity (${response.status})`);
  return data as IntegrityResult;
}

export type ObservationRecord = {
  observation_id: string;
  part_id: number | null;
  bin_id: number | null;
  observed_at: string;
  sensor_type: string;
  observed_quantity: number | null;
  occupancy_ratio: number | null;
  confidence: number;
  evidence_uri: string | null;
  status: string;
  source_class: string;
  model_version?: string | null;
  capture?: {
    capture_mode?: string | null;
    device_id?: string | null;
    camera_label?: string | null;
    captured_at?: string | null;
    frame_sequence?: number | null;
    inference_latency_ms?: number | null;
  };
};
export async function getObservations(limit = 8): Promise<{ items: ObservationRecord[] }> {
  const response = await fetch(`${API_BASE}/api/v1/observations?limit=${limit}`, { signal: AbortSignal.timeout(4000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Could not load observations (${response.status})`);
  return data as { items: ObservationRecord[] };
}
