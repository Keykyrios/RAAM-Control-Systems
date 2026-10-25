import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  Camera, CameraSlash, Check, CircleNotch, CrosshairSimple, Image as ImageIcon, Pause,
  Play, Repeat, Stop, UploadSimple, VideoCamera, WarningCircle,
} from '@phosphor-icons/react';
import {
  analyzeVisionFrame, createObservation, getLocations, getObservations, getVisionStatus,
  type FrameCaptureMode, type ObservationRecord, type StorageLocationRecord, type VisionAnalysis,
  type VisionStatus,
} from './api';
import type { InventoryPart } from './data';

type Props = { parts: InventoryPart[]; onSaved?: (message: string) => void };
type CameraState = 'unsupported' | 'idle' | 'requesting' | 'active' | 'paused' | 'error';
type StageMode = 'live' | 'review' | 'upload';
type BinOption = { id: number; code: string; locationCode: string; siteCode: string };
type CapturedFrame = {
  url: string;
  width: number;
  height: number;
  capturedAt: string;
  sequence: number;
  captureMode: FrameCaptureMode;
  deviceId?: string;
  cameraLabel?: string;
};

const EMPTY_FIT = { left: 0, top: 0, width: 0, height: 0 };
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function useStageFit(stageRef: RefObject<HTMLDivElement | null>, frameWidth: number, frameHeight: number) {
  const [fit, setFit] = useState(EMPTY_FIT);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (!frameWidth || !frameHeight) {
        setFit({ left: 0, top: 0, width: rect.width, height: rect.height });
        return;
      }
      const scale = Math.min(rect.width / frameWidth, rect.height / frameHeight);
      const width = frameWidth * scale;
      const height = frameHeight * scale;
      setFit({ left: (rect.width - width) / 2, top: (rect.height - height) / 2, width, height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    window.addEventListener('orientationchange', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', update);
    };
  }, [stageRef, frameWidth, frameHeight]);
  return fit;
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Allow camera access in the browser address bar, then start the camera again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found. Connect a UVC camera or use the upload fallback for reviewed still evidence.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is busy or unavailable. Close other applications using it, then retry.';
  }
  if (name === 'OverconstrainedError') {
    return 'The selected camera cannot provide the requested video stream. Choose another camera.';
  }
  return error instanceof Error ? error.message : 'The browser could not start the camera.';
}

function formatTime(value: string | Date | null): string {
  if (!value) return 'Not yet';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatStamp(value: string | Date | null): string {
  if (!value) return 'Not captured';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `${date.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

export default function VisionWorkbench({ parts, onSaved }: Props) {
  const [mode, setMode] = useState<'live' | 'upload'>('live');
  const [cameraState, setCameraState] = useState<CameraState>(() => (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'idle' : 'unsupported'
  ));
  const [cameraError, setCameraError] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 });
  const [autoSample, setAutoSample] = useState(false);
  const [sampleInterval, setSampleInterval] = useState(4000);
  const [samplesTaken, setSamplesTaken] = useState(0);
  const [lastAnalysisAt, setLastAnalysisAt] = useState<Date | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [notice, setNotice] = useState('');

  const [visionStatus, setVisionStatus] = useState<VisionStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [analysis, setAnalysis] = useState<VisionAnalysis | null>(null);
  const [analysisFrame, setAnalysisFrame] = useState<CapturedFrame | null>(null);
  const [stageMode, setStageMode] = useState<StageMode>('live');
  const [busy, setBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [savedId, setSavedId] = useState('');
  const [saving, setSaving] = useState(false);

  const [partId, setPartId] = useState('');
  const [binId, setBinId] = useState('');
  const [locations, setLocations] = useState<StorageLocationRecord[]>([]);
  const [locationsError, setLocationsError] = useState('');
  const [observations, setObservations] = useState<ObservationRecord[]>([]);
  const [observationsError, setObservationsError] = useState('');

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadSize, setUploadSize] = useState({ width: 0, height: 0 });
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameUrlRef = useRef<string>('');
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const frameSeqRef = useRef(0);
  const targetKeyRef = useRef('');
  const mountedRef = useRef(true);

  const identifiableParts = useMemo(() => parts.filter((part) => Number.isInteger(part.partId) && (part.partId ?? 0) > 0), [parts]);
  const bins = useMemo<BinOption[]>(() => locations.flatMap((location) => location.bins.map((bin) => ({
    id: bin.id, code: bin.code, locationCode: location.code, siteCode: location.site_code,
  }))), [locations]);
  const selectedPart = identifiableParts.find((part) => String(part.partId) === partId) || null;
  const selectedBin = bins.find((bin) => String(bin.id) === binId) || null;
  const targetKey = `${partId}|${binId}|${deviceId}`;
  targetKeyRef.current = targetKey;

  const activeFrame = analysisFrame;
  const displayFrame = mode === 'upload'
    ? (activeFrame ?? (uploadSize.width ? { url: uploadUrl, width: uploadSize.width, height: uploadSize.height } : null))
    : stageMode === 'review'
      ? activeFrame
      : (videoSize.width ? { url: '', width: videoSize.width, height: videoSize.height } : null);
  const fit = useStageFit(stageRef, displayFrame?.width ?? 16, displayFrame?.height ?? 9);

  const detections = stageMode === 'live' ? [] : (analysis?.detections ?? []);
  const visibleDetections = useMemo(() => [...detections]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 40), [detections]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      if (mountedRef.current) setDevices(list.filter((device) => device.kind === 'videoinput'));
    } catch {
      // Device labels can be unavailable before permission. Start still works.
    }
  }, []);

  const refreshObservations = useCallback(async () => {
    try {
      const response = await getObservations(6);
      if (mountedRef.current) { setObservations(response.items ?? []); setObservationsError(''); }
    } catch (error) {
      if (mountedRef.current) setObservationsError(error instanceof Error ? error.message : 'Observation history is unavailable.');
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await getVisionStatus();
      if (!mountedRef.current) return;
      setVisionStatus(response);
      setStatusError('');
      const limits = response.live_camera;
      setSampleInterval((current) => Math.max(limits.min_interval_ms, Math.min(limits.max_interval_ms, current)));
    } catch (error) {
      if (mountedRef.current) setStatusError(error instanceof Error ? error.message : 'Could not read the vision provider status.');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.all([refreshDevices(), refreshStatus(), refreshObservations()]);
    getLocations().then((response) => {
      if (mountedRef.current) { setLocations(response.items ?? []); setLocationsError(''); }
    }).catch((error: unknown) => {
      if (mountedRef.current) setLocationsError(error instanceof Error ? error.message : 'Storage locations are unavailable.');
    });
    const handleDeviceChange = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, [refreshDevices, refreshStatus, refreshObservations]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    abortRef.current?.abort();
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
  }, []);

  useEffect(() => {
    if (!uploadFile) { setUploadUrl(''); return; }
    const url = URL.createObjectURL(uploadFile);
    setUploadUrl(url);
    const image = new Image();
    image.onload = () => setUploadSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [uploadFile]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState('idle');
    setAutoSample(false);
  }, []);

  const clearAnalysis = useCallback((nextStage: StageMode) => {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setBusy(false);
    setAnalysis(null);
    setAnalysisError('');
    setAnalysisFrame(null);
    setReviewConfirmed(false);
    setSavedId('');
    setNotice('');
    setStageMode(nextStage);
    if (frameUrlRef.current) { URL.revokeObjectURL(frameUrlRef.current); frameUrlRef.current = ''; }
  }, []);

  const changeTarget = (nextPart: string, nextBin: string) => {
    const nextKey = `${nextPart}|${nextBin}|${deviceId}`;
    if (nextKey !== targetKeyRef.current) {
      targetKeyRef.current = nextKey;
      clearAnalysis(mode === 'upload' ? 'upload' : 'live');
    }
    setPartId(nextPart);
    setBinId(nextBin);
  };

  const startCamera = useCallback(async (requestedDeviceId?: string) => {
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setCameraState('unsupported');
      setCameraError('This browser does not expose a camera API. Use a current browser over HTTPS or localhost.');
      return;
    }
    if (!window.isSecureContext) {
      setCameraState('error');
      setCameraError('Camera access requires HTTPS or a loopback address such as localhost. The current page origin is not secure.');
      return;
    }
    setCameraError('');
    setNotice('');
    setCameraState('requesting');
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: requestedDeviceId
          ? { deviceId: { exact: requestedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        if (!requestedDeviceId && error instanceof DOMException && error.name === 'OverconstrainedError') {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        } else {
          throw error;
        }
      }
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const resolvedDeviceId = settings.deviceId || requestedDeviceId || '';
      if (resolvedDeviceId) setDeviceId(resolvedDeviceId);
      const label = track.label || devices.find((device) => device.deviceId === resolvedDeviceId)?.label || 'Browser camera';
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (video.videoWidth) setVideoSize({ width: video.videoWidth, height: video.videoHeight });
      }
      track.addEventListener('ended', () => {
        if (!mountedRef.current) return;
        setCameraState('error');
        setCameraError(`Camera "${label}" disconnected. Reconnect it and start the camera again.`);
        setAutoSample(false);
      }, { once: true });
      setCameraState('active');
      setStageMode('live');
      setAnalysisError('');
      await refreshDevices();
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (!mountedRef.current) return;
      setCameraState('error');
      setCameraError(cameraErrorMessage(error));
    }
  }, [devices, refreshDevices]);

  const pauseCamera = useCallback(() => {
    videoRef.current?.pause();
    setAutoSample(false);
    setCameraState((current) => current === 'active' ? 'paused' : current);
  }, []);

  const resumeCamera = useCallback(async () => {
    if (!streamRef.current) { await startCamera(deviceId || undefined); return; }
    try {
      await videoRef.current?.play();
      setCameraState('active');
      setCameraError('');
    } catch (error) {
      setCameraState('error');
      setCameraError(cameraErrorMessage(error));
    }
  }, [deviceId, startCamera]);

  const stopCameraAndClear = useCallback(() => {
    stopCamera();
    clearAnalysis('live');
  }, [stopCamera, clearAnalysis]);

  const switchDevice = async (nextDeviceId: string) => {
    setDeviceId(nextDeviceId);
    targetKeyRef.current = `${partId}|${binId}|${nextDeviceId}`;
    clearAnalysis('live');
    if (cameraState === 'active' || cameraState === 'paused' || cameraState === 'requesting') {
      await startCamera(nextDeviceId);
    }
  };

  const switchMode = (nextMode: 'live' | 'upload') => {
    if (nextMode === mode) return;
    stopCamera();
    clearAnalysis(nextMode === 'upload' ? 'upload' : 'live');
    setMode(nextMode);
    setNotice(nextMode === 'upload' ? 'Upload mode uses a reviewed still image. No synthetic overlays are available.' : '');
  };

  const captureVideoFrame = useCallback(async (): Promise<{ blob: Blob; width: number; height: number }> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      throw new Error('The camera has no decodable frame yet. Wait for the preview to render, then retry.');
    }
    const maxSide = visionStatus?.live_camera.max_frame_side ?? 1280;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create a canvas for the captured frame.');
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The captured frame could not be encoded as JPEG.')), 'image/jpeg', 0.9);
    });
    return { blob, width, height };
  }, [visionStatus]);

  const presentFrame = useCallback((source: { url?: string; blob?: Blob; width: number; height: number }, meta: Omit<CapturedFrame, 'url' | 'width' | 'height'>) => {
    if (frameUrlRef.current) { URL.revokeObjectURL(frameUrlRef.current); frameUrlRef.current = ''; }
    const url = source.url ?? URL.createObjectURL(source.blob as Blob);
    if (!source.url) frameUrlRef.current = url;
    const frame: CapturedFrame = { ...meta, url, width: source.width, height: source.height };
    setAnalysis(null);
    setReviewConfirmed(false);
    setSavedId('');
    setAnalysisFrame(frame);
    return frame;
  }, []);

  const runAnalysis = useCallback(async (blob: Blob, frame: CapturedFrame, captureMode: FrameCaptureMode) => {
    if (visionStatus && !visionStatus.provider_configured) {
      setAnalysisError('No approved vision provider is configured. The frame was captured locally, but no detection result was invented. Set VISION_PROVIDER_URL on the API to enable analysis.');
      return;
    }
    const requestId = ++requestSeqRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = true;
    setBusy(true);
    setAnalysisError('');
    setNotice('');
    setSavedId('');
    setReviewConfirmed(false);
    const started = performance.now();
    const timeout = window.setTimeout(() => controller.abort(), 36_000);
    const requestTargetKey = targetKeyRef.current;
    const requestPartId = partId ? Number(partId) : undefined;
    const requestBinId = binId ? Number(binId) : undefined;
    try {
      const result = await analyzeVisionFrame(blob, {
        partId: requestPartId,
        binId: requestBinId,
        captureMode,
        deviceId: frame.deviceId,
        cameraLabel: frame.cameraLabel,
        frameSequence: frame.sequence,
        capturedAt: frame.capturedAt,
      }, controller.signal);
      if (!mountedRef.current || requestId !== requestSeqRef.current || requestTargetKey !== targetKeyRef.current) return;
      const clientLatency = Math.round(performance.now() - started);
      setAnalysis(result);
      setLastLatencyMs(clientLatency);
      setLastAnalysisAt(new Date());
      setSamplesTaken((count) => count + 1);
      setStageMode(captureMode === 'UPLOAD' ? 'upload' : 'review');
    } catch (error) {
      if (!mountedRef.current || requestId !== requestSeqRef.current) return;
      if (controller.signal.aborted) {
        setAnalysisError('Frame analysis was cancelled or exceeded the 36 second client timeout. The captured frame remains available for inspection. No result was inferred.');
      } else {
        setAnalysisError(error instanceof Error ? error.message : 'Vision inference failed. The captured frame remains available for inspection.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestId === requestSeqRef.current) {
        inFlightRef.current = false;
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [binId, partId, visionStatus]);

  const captureAndAnalyze = useCallback(async (captureMode: 'LIVE_CAMERA' | 'SNAPSHOT') => {
    if (mode !== 'live') return;
    if (cameraState !== 'active') {
      setNotice('Start the camera before analyzing a live frame.');
      return;
    }
    if (inFlightRef.current) {
      setNotice('The previous frame is still being analyzed. Backpressure is active, so this sample was skipped rather than queued.');
      return;
    }
    setAnalysisError('');
    try {
      const captured = await captureVideoFrame();
      const sequence = ++frameSeqRef.current;
      const track = streamRef.current?.getVideoTracks()[0];
      const label = track?.label || devices.find((device) => device.deviceId === deviceId)?.label || 'Browser camera';
      const meta: Omit<CapturedFrame, 'url' | 'width' | 'height'> = {
        capturedAt: new Date().toISOString(), sequence, captureMode,
        deviceId: deviceId || track?.getSettings().deviceId || undefined,
        cameraLabel: label,
      };
      const frame = presentFrame({ blob: captured.blob, width: captured.width, height: captured.height }, meta);
      setStageMode('review');
      await runAnalysis(captured.blob, frame, captureMode);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Could not capture a camera frame.');
    }
  }, [cameraState, captureVideoFrame, deviceId, devices, mode, presentFrame, runAnalysis]);

  const captureAndAnalyzeRef = useRef(captureAndAnalyze);
  useEffect(() => { captureAndAnalyzeRef.current = captureAndAnalyze; }, [captureAndAnalyze]);

  useEffect(() => {
    if (!autoSample || cameraState !== 'active' || mode !== 'live' || !visionStatus?.provider_configured) return;
    let cancelled = false;
    let lastRun = 0;
    // Poll a stable wall clock instead of restarting a timeout after every render.
    // Backpressure skips a sample whenever the previous frame is still in flight.
    const timer = window.setInterval(() => {
      if (cancelled || document.hidden || inFlightRef.current) return;
      const now = Date.now();
      if (now - lastRun < Math.max(1000, sampleInterval)) return;
      lastRun = now;
      void captureAndAnalyzeRef.current('LIVE_CAMERA');
    }, 500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [autoSample, cameraState, mode, sampleInterval, visionStatus?.provider_configured]);

  const acceptFile = (next: File | undefined) => {
    if (!next) return;
    setUploadError('');
    if (!ACCEPTED_TYPES.includes(next.type)) {
      setUploadError('Choose a JPEG, PNG or WebP image. The previous valid image was preserved.');
      return;
    }
    const maxBytes = visionStatus?.max_image_bytes ?? MAX_UPLOAD_BYTES;
    if (next.size > maxBytes) {
      setUploadError(`Image exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit. The previous valid image was preserved.`);
      return;
    }
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setBusy(false);
    setAnalysis(null);
    setAnalysisError('');
    setReviewConfirmed(false);
    setSavedId('');
    if (frameUrlRef.current) { URL.revokeObjectURL(frameUrlRef.current); frameUrlRef.current = ''; }
    setAnalysisFrame(null);
    setUploadFile(next);
    setStageMode('upload');
  };

  const analyzeUpload = async () => {
    if (!uploadFile || !uploadUrl) return;
    if (inFlightRef.current) return;
    if (!uploadSize.width || !uploadSize.height) {
      setAnalysisError('The image is still loading. Retry after its dimensions are available.');
      return;
    }
    if (visionStatus && !visionStatus.provider_configured) {
      setAnalysisError('No approved vision provider is configured. Set VISION_PROVIDER_URL on the API; no detection result was invented.');
      return;
    }
    const sequence = ++frameSeqRef.current;
    const meta: Omit<CapturedFrame, 'url' | 'width' | 'height'> = {
      capturedAt: new Date().toISOString(), sequence, captureMode: 'UPLOAD', cameraLabel: 'Uploaded still image',
    };
    const frame = presentFrame({ url: uploadUrl, width: uploadSize.width, height: uploadSize.height }, meta);
    setStageMode('upload');
    await runAnalysis(uploadFile, frame, 'UPLOAD');
  };

  const saveObservation = async () => {
    if (!analysis || !analysisFrame || !analysis.evidence_uri || !reviewConfirmed) return;
    setSaving(true);
    setAnalysisError('');
    try {
      const response = await createObservation({
        part_id: partId ? Number(partId) : null,
        bin_id: binId ? Number(binId) : null,
        sensor_type: 'CAMERA',
        observed_quantity: analysis.observed_quantity,
        occupancy_ratio: analysis.occupancy_ratio,
        identifier_candidates: analysis.identifier_candidates,
        count_distribution: analysis.count_distribution,
        detections: analysis.detections,
        confidence: analysis.confidence,
        evidence_uri: analysis.evidence_uri,
        capture_mode: analysisFrame.captureMode,
        device_id: analysisFrame.deviceId,
        camera_label: analysisFrame.cameraLabel,
        captured_at: analysisFrame.capturedAt,
        frame_sequence: analysisFrame.sequence,
        inference_latency_ms: analysis.analysis_meta?.latency_ms ?? lastLatencyMs ?? undefined,
        model_version: analysis.model_version,
        provider_request_id: analysis.analysis_meta?.request_id,
        metadata: {
          provider_name: analysis.provider_name,
          provider_status: analysis.provider_status,
          capabilities: analysis.capabilities,
          image_quality: analysis.image_quality,
          limitations: analysis.limitations,
          image_width: analysisFrame.width,
          image_height: analysisFrame.height,
          evidence_sha256: analysis.evidence_sha256,
          captured_from: analysisFrame.captureMode,
          input_channel: mode,
          transport: 'sampled_frame_multipart',
          stock_changed: false,
        },
        source_class: 'RAAM_OBSERVED',
      });
      setSavedId(response.observation_id);
      await refreshObservations();
      onSaved?.(`Observation ${response.observation_id} saved as reviewed camera evidence. Stock and purchasing were not changed.`);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Could not save the reviewed observation.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeviceChange = async (nextDeviceId: string) => {
    await switchDevice(nextDeviceId);
  };

  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  const providerConfigured = visionStatus?.provider_configured === true;
  const analysisEnabled = visionStatus ? providerConfigured : !statusError;
  const cameraStatusText = cameraState === 'active' ? 'Live stream' : cameraState === 'paused' ? 'Paused' : cameraState === 'requesting' ? 'Requesting permission' : cameraState === 'error' ? 'Camera error' : cameraState === 'unsupported' ? 'Unsupported' : 'Camera idle';
  const mediaStyle: CSSProperties = { position: 'absolute', left: fit.left, top: fit.top, width: fit.width, height: fit.height };
  const overlayStyle: CSSProperties = { position: 'absolute', left: fit.left, top: fit.top, width: fit.width, height: fit.height };
  const currentCameraLabel = devices.find((device) => device.deviceId === deviceId)?.label || (cameraState === 'active' ? 'Active browser camera' : 'No camera selected');
  const intervalOptions = useMemo(() => {
    const limits = visionStatus?.live_camera;
    const values = [2000, 4000, 8000, 15000, 30000];
    return values.filter((value) => value >= (limits?.min_interval_ms ?? 1500) && value <= (limits?.max_interval_ms ?? 30000));
  }, [visionStatus]);

  return <div className="vision-workbench">
    <section className="vision-camera-shell" aria-label="Live camera evidence">
      <div className="vision-camera-toolbar">
        <div className="vision-mode-tabs" role="tablist" aria-label="Evidence input">
          <button type="button" role="tab" aria-selected={mode === 'live'} className={mode === 'live' ? 'is-active' : ''} onClick={() => switchMode('live')}><VideoCamera size={15} />Live camera</button>
          <button type="button" role="tab" aria-selected={mode === 'upload'} className={mode === 'upload' ? 'is-active' : ''} onClick={() => switchMode('upload')}><UploadSimple size={15} />Still image</button>
        </div>
        <div className="vision-camera-state">
          <span className={`vision-camera-state__badge vision-camera-state__badge--${cameraState}`}>{cameraStatusText}</span>
          {mode === 'live' && devices.length > 0 && <label className="vision-device-select">
            <span className="visually-hidden">Camera device</span>
            <select value={deviceId} onChange={(event) => void handleDeviceChange(event.target.value)} disabled={cameraState === 'requesting'}>
              {!deviceId && <option value="">Choose a camera</option>}
              {devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
            </select>
          </label>}
        </div>
      </div>

      <div className="vision-camera-stage" ref={stageRef} data-stage-mode={stageMode} aria-live="polite">
        {mode === 'live' ? <>
          <video
            ref={videoRef}
            className="vision-camera-media"
            style={{ ...mediaStyle, visibility: stageMode === 'live' ? 'visible' : 'hidden' }}
            autoPlay
            playsInline
            muted
            aria-label="Live camera preview"
            onLoadedMetadata={(event) => setVideoSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
          />
          {stageMode === 'review' && analysisFrame && <img className="vision-camera-media vision-camera-media--review" style={mediaStyle} src={analysisFrame.url} alt="Exact camera frame submitted for analysis" />}
          {stageMode === 'live' && cameraState !== 'active' && cameraState !== 'paused' && <div className="vision-camera-idle">
            <div className="vision-camera-idle__icon">{cameraState === 'unsupported' ? <CameraSlash size={25} /> : <Camera size={25} />}</div>
            <strong>{cameraState === 'requesting' ? 'Waiting for camera permission' : cameraState === 'error' ? 'Camera not available' : 'Start the browser camera'}</strong>
            <p>{cameraState === 'error' ? cameraError : cameraState === 'unsupported' ? 'This browser does not expose a camera API. Use a current browser over HTTPS or localhost.' : 'Grant camera permission to see a live preview. Frames are sent to the configured vision provider only when you analyze or enable sampling.'}</p>
            {cameraState === 'requesting' && <span className="vision-camera-requesting"><CircleNotch className="spin" size={17} />Requesting device access</span>}
          </div>}
          {stageMode === 'review' && analysisFrame && <div className="vision-frame-stamp">ANALYZED FRAME · #{analysisFrame.sequence} · {formatTime(analysisFrame.capturedAt)}</div>}
          {stageMode === 'live' && cameraState === 'active' && <div className="vision-live-stamp"><span />LIVE PREVIEW</div>}
        </> : <>
          {!uploadUrl ? <div
            className={`vision-upload-stage ${dragging ? 'vision-upload-stage--dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files[0]); }}
          >
            <div className="vision-camera-idle__icon"><ImageIcon size={25} /></div>
            <strong>Upload a captured still</strong>
            <p>Use this fallback when a browser camera is unavailable. JPEG, PNG or WebP up to {Math.round((visionStatus?.max_image_bytes ?? MAX_UPLOAD_BYTES) / 1024 / 1024)} MB. Only a real provider response is displayed.</p>
            <button type="button" className="vision-inline-button" onClick={() => inputRef.current?.click()}>Choose image</button>
            <input ref={inputRef} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => acceptFile(event.target.files?.[0])} aria-label="Upload an inventory still image" />
          </div> : <>
            <img className="vision-camera-media vision-camera-media--review" style={mediaStyle} src={uploadUrl} alt="Uploaded still image submitted for analysis" onLoad={(event) => setUploadSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
            <div className="vision-frame-stamp">STILL IMAGE · {uploadFile?.name}</div>
            <button type="button" className="vision-replace-image" onClick={() => inputRef.current?.click()}>Replace image</button>
            <input ref={inputRef} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => acceptFile(event.target.files?.[0])} aria-label="Replace the still image" />
          </>}
        </>}

        {stageMode !== 'live' && visibleDetections.length > 0 && <div className="vision-overlay" style={overlayStyle} aria-hidden="true">
          {visibleDetections.map((detection, index) => {
            const [x, y, width, height] = detection.box;
            const left = Math.max(0, Math.min(100, x));
            const top = Math.max(0, Math.min(100, y));
            const boxWidth = Math.max(0.4, Math.min(100 - left, width));
            const boxHeight = Math.max(0.4, Math.min(100 - top, height));
            return <div key={`${detection.label}-${index}`} className="vision-bbox" style={{ left: `${left}%`, top: `${top}%`, width: `${boxWidth}%`, height: `${boxHeight}%` }}>
              <span>{detection.label} {Math.round(detection.confidence * 100)}%</span>
            </div>;
          })}
        </div>}

        {analysisError && <div className="vision-stage-error" role="alert"><WarningCircle size={17} /><span>{analysisError}</span></div>}
        {busy && <div className="vision-inference-state"><CircleNotch className="spin" size={16} />Analyzing this exact frame. No result is shown until the provider responds.</div>}
      </div>

      <div className="vision-camera-controls">
        {mode === 'live' ? <>
          {cameraState === 'idle' || cameraState === 'error' || cameraState === 'unsupported'
            ? <button type="button" className="vision-control vision-control--primary" onClick={() => void startCamera(deviceId || undefined)} disabled={!secureContext || cameraState === 'unsupported'}><Play size={15} />Start camera</button>
            : cameraState === 'requesting'
              ? <button type="button" className="vision-control" disabled><CircleNotch className="spin" size={15} />Requesting</button>
              : <><button type="button" className="vision-control" onClick={pauseCamera} disabled={cameraState !== 'active'}><Pause size={15} />Pause</button><button type="button" className="vision-control" onClick={() => void resumeCamera()} disabled={cameraState !== 'paused'}><Play size={15} />Resume</button><button type="button" className="vision-control" onClick={stopCameraAndClear}><Stop size={15} />Stop</button></>}
          <button type="button" className="vision-control vision-control--primary" onClick={() => void captureAndAnalyze('LIVE_CAMERA')} disabled={cameraState !== 'active' || busy || !analysisEnabled}><CrosshairSimple size={15} />Analyze now</button>
          <button type="button" className="vision-control" onClick={() => void captureAndAnalyze('SNAPSHOT')} disabled={cameraState !== 'active' || busy || !analysisEnabled}><Camera size={15} />Capture snapshot</button>
          <label className="vision-sampling-toggle"><input type="checkbox" checked={autoSample} onChange={(event) => setAutoSample(event.target.checked)} disabled={cameraState !== 'active' || !providerConfigured} /><span>Auto sample</span></label>
          <label className="vision-sampling-interval"><span>Every</span><select value={sampleInterval} onChange={(event) => setSampleInterval(Number(event.target.value))} disabled={cameraState !== 'active' || !autoSample}>
            {(intervalOptions.length ? intervalOptions : [4000]).map((value) => <option key={value} value={value}>{value / 1000}s</option>)}
          </select></label>
          {stageMode === 'review' && analysisFrame && <button type="button" className="vision-control vision-control--quiet" onClick={() => setStageMode('live')}>Return to live</button>}
          {stageMode === 'live' && analysisFrame && <button type="button" className="vision-control vision-control--quiet" onClick={() => setStageMode('review')}>Show analyzed frame</button>}
        </> : <>
          <button type="button" className="vision-control vision-control--primary" onClick={() => inputRef.current?.click()}><UploadSimple size={15} />{uploadUrl ? 'Replace image' : 'Choose image'}</button>
          <button type="button" className="vision-control" onClick={() => void analyzeUpload()} disabled={!uploadFile || busy || !analysisEnabled}><CrosshairSimple size={15} />Analyze image</button>
          {stageMode !== 'live' && analysisFrame && <button type="button" className="vision-control vision-control--quiet" onClick={() => { setAnalysis(null); setAnalysisFrame(null); setReviewConfirmed(false); setSavedId(''); }}>Clear result</button>}
        </>}
      </div>

      <div className="vision-camera-meta">
        <span><VideoCamera size={14} />{mode === 'live' ? currentCameraLabel : (uploadFile?.name || 'No still selected')}</span>
        <span>{mode === 'live' ? `${videoSize.width}×${videoSize.height}` : uploadSize.width ? `${uploadSize.width}×${uploadSize.height}` : 'Awaiting image'}</span>
        <span>Last analysis {lastAnalysisAt ? formatTime(lastAnalysisAt) : 'not yet'}{lastLatencyMs != null ? ` · ${lastLatencyMs} ms round trip` : ''}</span>
        <span>{samplesTaken} frame{samplesTaken === 1 ? '' : 's'} analyzed</span>
      </div>
      {mode === 'live' && cameraError && <div className="vision-camera-alert"><WarningCircle size={16} /><span>{cameraError}</span></div>}
      {mode === 'live' && !secureContext && <div className="vision-camera-alert"><WarningCircle size={16} /><span>Camera access requires HTTPS or localhost. This origin cannot request a camera stream.</span></div>}
      {uploadError && <div className="vision-camera-alert" role="alert"><WarningCircle size={16} /><span>{uploadError}</span></div>}
      {notice && <div className="vision-camera-note">{notice}</div>}
      <p className="vision-camera-disclosure"><Camera size={14} />Browser camera frames stay local until you analyze or enable sampling. Sampling sends the displayed frame to the configured provider; it never streams every video frame. IP/RTSP cameras require a separately authorized ingestion gateway.</p>
    </section>

    <aside className="vision-run-panel">
      <div className="vision-panel-head">
        <div><p className="eyebrow">LIVE COMPUTER-VISION EVIDENCE</p><h3>Camera observation review</h3><p>Real frame in. Provider evidence out. Human review before persistence.</p></div>
        <span className={`vision-engine-status ${providerConfigured ? 'vision-engine-status--connected' : ''}`}>{providerConfigured ? (analysis ? 'INFERENCE VERIFIED' : 'PROVIDER CONFIGURED') : statusError ? 'STATUS UNKNOWN' : visionStatus ? 'NOT CONFIGURED' : 'CHECKING PROVIDER'}</span>
      </div>

      <div className="vision-context-fields">
        <label className="field"><span>Known part (optional)</span><select value={partId} disabled={busy || saving} onChange={(event) => changeTarget(event.target.value, binId)}><option value="">Unidentified / collection-level</option>{identifiableParts.map((part) => <option key={part.partId} value={part.partId}>{part.sku} · {part.name}</option>)}</select><small>Changing this target invalidates the previous model result so evidence cannot be reassigned.</small></label>
        <label className="field"><span>Storage bin (optional)</span><select value={binId} disabled={busy || saving} onChange={(event) => changeTarget(partId, event.target.value)}><option value="">Unassigned bin</option>{bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.code} · {bin.siteCode} / {bin.locationCode}</option>)}</select><small>{locationsError ? 'Location registry unavailable. Refresh after connecting the API.' : bins.length ? `${bins.length} bins from the connected spatial registry.` : 'No bin registry is available yet.'}</small></label>
        {identifiableParts.length === 0 && <p className="vision-context-note">No database-backed part IDs are available. Synthetic preview rows are not selectable as production records.</p>}
      </div>

      <div className="vision-capabilities">
        <span>01 <b>Live camera</b></span><span>02 <b>QR / barcode</b></span><span>03 <b>ArUco tags</b></span><span>04 <b>Tesseract OCR</b></span>
      </div>

      {statusError && <div className="vision-inline-error">{statusError}. Camera preview still works, but inference cannot be verified.</div>}
      {!providerConfigured && visionStatus && <div className="vision-no-model"><strong>Provider not configured</strong><p>Set <code>VISION_PROVIDER_URL</code> on the API. Live frames can be captured and inspected locally, but this ERP will not invent detections. The Docker Compose stack wires a real OpenCV and Tesseract provider.</p></div>}
      {visionStatus && <div className="vision-provider-facts"><span>Provider configured: <b>{providerConfigured ? 'yes' : 'no'}</b></span><span>Count model: <b>{visionStatus.count_model.replace('_', ' ').toLowerCase()}</b></span><span>Occupancy model: <b>{visionStatus.occupancy_model.replace('_', ' ').toLowerCase()}</b></span><span>Concurrency cap: <b>{visionStatus.max_concurrent_requests}</b></span></div>}

      {!analysis && !analysisError && <div className="vision-no-model vision-result-empty"><strong>Waiting for a real frame</strong><p>Start the camera, choose a target, then analyze. The result panel will show only what the provider returned, including uncertainty and any unsupported fields.</p></div>}

      {analysisFrame && <div className="vision-evidence-frame">
        <div className="vision-evidence-frame__image"><img src={analysisFrame.url} alt="Frame retained for review" /></div>
        <div><span>Reviewed frame</span><strong>#{analysisFrame.sequence} · {analysisFrame.captureMode.replace('_', ' ').toLowerCase()}</strong><small>{formatStamp(analysisFrame.capturedAt)} · {analysisFrame.width}×{analysisFrame.height}</small><small>{analysisFrame.cameraLabel || 'Browser camera'}</small></div>
      </div>}

      {analysis && <div className="vision-result-card">
        <div className="vision-result-card__title"><strong>{analysis.provider_name}</strong><span>{analysis.model_version}</span></div>
        <div className="vision-result-stats">
          <div><span>Observed quantity</span><strong>{analysis.observed_quantity ?? 'Not supported'}</strong></div>
          <div><span>Confidence</span><strong>{Math.round(analysis.confidence * 100)}%</strong></div>
          <div><span>Occupancy</span><strong>{analysis.occupancy_ratio == null ? 'Not supported' : `${Math.round(analysis.occupancy_ratio * 100)}%`}</strong></div>
          <div><span>Round trip</span><strong>{lastLatencyMs ?? Math.round(analysis.analysis_meta.latency_ms)}<small> ms</small></strong></div>
        </div>
        <div className="vision-result-context"><span>{analysis.analysis_meta.capture_mode.replace('_', ' ')}</span><span>{analysis.analysis_meta.device_id || 'No device id'}</span><span>{analysis.analysis_meta.request_id}</span></div>

        <div className="vision-posterior-list">
          <span>Count posterior</span>
          {(analysis.count_distribution ?? []).length === 0 ? <p className="vision-unsupported-copy">No calibrated count distribution was returned. The live camera does not guess a unit count.</p> : analysis.count_distribution.slice(0, 8).map((point) => <div key={`${point.count}-${point.probability}`}><span>{point.count} units</span><i><b style={{ width: `${Math.max(0, Math.min(100, point.probability * 100))}%` }} /></i><strong>{Math.round(point.probability * 100)}%</strong></div>)}
        </div>

        <div className="vision-candidates">
          <span>Decoded identifier candidates</span>
          {analysis.identifier_candidates.length === 0 ? <p className="vision-unsupported-copy">No QR, barcode, ArUco tag or OCR token was decoded in this frame.</p> : analysis.identifier_candidates.slice(0, 8).map((candidate, index) => <div key={`${candidate.identifier || candidate.sku || 'candidate'}-${index}`}><div><strong>{candidate.identifier || candidate.sku || 'Unidentified candidate'}</strong>{candidate.note && <small>{candidate.note}</small>}</div><span>{Math.round(Number(candidate.confidence ?? 0) * 100)}%</span></div>)}
        </div>

        <div className="vision-detections">
          <span>Frame detections</span>
          {analysis.detections.length === 0 ? <p className="vision-unsupported-copy">No evidence regions were detected. The image was still analyzed; no detections were fabricated.</p> : analysis.detections.slice(0, 8).map((detection, index) => <div key={`${detection.label}-${index}`}><div><strong>{detection.label}</strong><small>{detection.source || 'provider'} · {detection.box.map((value) => value.toFixed(0)).join(', ')}%{detection.note ? ` · ${detection.note}` : ''}</small></div><span>{Math.round(detection.confidence * 100)}%</span></div>)}
          {analysis.detections.length > 8 && <p className="vision-unsupported-copy">+{analysis.detections.length - 8} more regions are drawn on the frame.</p>}
        </div>

        <div className="vision-evidence-line">
          <div><span>Evidence retention</span><strong>{analysis.evidence_uri ? 'Private evidence reference issued' : 'No durable evidence reference'}</strong><small>{analysis.evidence_uri || 'Saving is disabled until a provider returns durable evidence.'}</small>{analysis.evidence_sha256 && <small>SHA-256 {analysis.evidence_sha256.slice(0, 24)}…</small>}</div>
          <div><span>Image quality</span><strong>{analysis.image_quality ? (analysis.image_quality.low_sharpness ? 'Low sharpness' : analysis.image_quality.low_light ? 'Low light' : 'Usable frame') : 'Not reported'}</strong><small>{analysis.image_quality?.sharpness_laplacian_variance != null ? `Laplacian ${analysis.image_quality.sharpness_laplacian_variance}` : 'Provider did not return quality metrics.'}</small></div>
        </div>

        {analysis.limitations.length > 0 && <div className="vision-limitations"><span>Provider limitations</span>{analysis.limitations.map((item) => <p key={item}>{item}</p>)}</div>}

        <label className="vision-review-check"><input type="checkbox" checked={reviewConfirmed} disabled={!analysis.evidence_uri || saving} onChange={(event) => setReviewConfirmed(event.target.checked)} /><span>I reviewed this exact frame, its decoded identifiers and the evidence reference.</span></label>
        <button className="vision-save-action" type="button" onClick={() => void saveObservation()} disabled={saving || !reviewConfirmed || !analysis.evidence_uri}>{saving ? 'Saving observation…' : 'Save as reviewed physical evidence'}</button>
        <p className="vision-safe-copy">Saving records observation evidence only. It does not change the ledger, collapse the physical posterior, authorize replenishment or imply misconduct.</p>
        {savedId && <div className="vision-saved-receipt"><Check size={16} /><div><strong>{savedId} recorded</strong><span>Evidence only. Stock and purchasing remain unchanged.</span></div></div>}
      </div>}

      <div className="vision-history">
        <div className="vision-history__head"><span>Recent saved observations</span><button type="button" onClick={() => void refreshObservations()}>Refresh</button></div>
        {observationsError ? <p className="vision-unsupported-copy">{observationsError}</p> : observations.length === 0 ? <p className="vision-unsupported-copy">No reviewed camera observations have been saved yet. Live detections are not persisted automatically.</p> : observations.slice(0, 4).map((observation) => <div className="vision-history__row" key={observation.observation_id}>
          <div><strong>{observation.observation_id}</strong><span>{observation.capture?.capture_mode?.replace('_', ' ') || observation.sensor_type} · {observation.capture?.camera_label || observation.capture?.device_id || 'camera'}</span></div>
          <div><strong>{Math.round(Number(observation.confidence) * 100)}%</strong><span>{formatTime(observation.observed_at)}</span></div>
        </div>)}
      </div>

      <div className="vision-pipeline-footer"><span>FRAME</span><i /><span>PROVIDER</span><i /><span>REVIEW</span><i /><span>EVIDENCE</span></div>
    </aside>
  </div>;
}
