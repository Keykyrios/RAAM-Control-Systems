import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { InventoryPart } from './data';

type Props = { parts: InventoryPart[]; dataMode: string; onOpenPart?: (part: InventoryPart) => void };
type BinHit = { mesh: THREE.Mesh; part: InventoryPart | null; binCode: string; index: number };
type ColorMode = 'state' | 'confidence' | 'variance';

const BURGUNDY = '#351319';
const ACCENT = '#B21E2B';

function colorFor(part: InventoryPart | null, mode: ColorMode, selected: boolean): THREE.Color {
  if (selected) return new THREE.Color(ACCENT);
  if (!part) return new THREE.Color('#D4CBC4');
  if (!Number.isFinite(part.ledger) || !Number.isFinite(part.physical)) return new THREE.Color('#C9C0B8');
  if (mode === 'confidence') {
    if (part.confidence >= 0.9) return new THREE.Color('#648675');
    if (part.confidence >= 0.75) return new THREE.Color('#C08A35');
    return new THREE.Color('#B21E2B');
  }
  if (mode === 'variance') {
    const variance = Math.abs(part.ledger - part.physical) / Math.max(1, part.ledger, part.physical);
    if (variance < 0.04) return new THREE.Color('#648675');
    if (variance < 0.15) return new THREE.Color('#C08A35');
    return new THREE.Color('#B21E2B');
  }
  if (/reconcile|audit|urgent|missing/i.test(part.status)) return new THREE.Color('#B21E2B');
  if (/review|order|variance/i.test(part.status) || part.confidence < 0.75) return new THREE.Color('#C08A35');
  return new THREE.Color('#648675');
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value);
}

/**
 * Interactive Three.js warehouse digital-twin view.
 * Every populated box is linked to a supplied InventoryPart record; demo records retain their source label.
 */
export default function WarehouseTwin({ parts, dataMode, onOpenPart }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const binHitsRef = useRef<BinHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('state');
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const colorModeRef = useRef<ColorMode>(colorMode);
  const selectedIndexRef = useRef(selectedIndex);
  const displayedParts = useMemo(() => parts.slice(0, 36), [parts]);
  const selectedPart = displayedParts[selectedIndex] ?? null;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setWebglUnavailable(true);
      return;
    }
    setWebglUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(mount.clientWidth || 800, mount.clientHeight || 520, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    mount.replaceChildren(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D warehouse. Drag to orbit, scroll to zoom, select a bin to inspect its inventory record. Use arrow keys to move selection between bins, then Tab to the inspector action.');
    renderer.domElement.tabIndex = 0;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#F6F2EE');
    scene.fog = new THREE.Fog('#F6F2EE', 17, 34);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(42, Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight), 0.1, 100);
    camera.position.set(10.8, 9.3, 13.2);
    cameraRef.current = camera;

    scene.add(new THREE.HemisphereLight('#FFFFFF', '#8D7770', 2.0));
    const keyLight = new THREE.DirectionalLight('#FFFFFF', 2.7);
    keyLight.position.set(6, 12, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -12;
    keyLight.shadow.camera.right = 12;
    keyLight.shadow.camera.top = 12;
    keyLight.shadow.camera.bottom = -12;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight('#D8B7B0', 0.65);
    fillLight.position.set(-8, 6, -6);
    scene.add(fillLight);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), new THREE.MeshStandardMaterial({ color: '#E9E2DC', roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.y = -0.1;
    scene.add(floor);
    const grid = new THREE.GridHelper(16, 16, '#C5B8B0', '#DED5CF');
    grid.position.y = -0.075;
    scene.add(grid);

    const rackMaterial = new THREE.MeshStandardMaterial({ color: '#6D5B58', metalness: 0.25, roughness: 0.58 });
    const beamMaterial = new THREE.MeshStandardMaterial({ color: '#BBAAA1', metalness: 0.1, roughness: 0.7 });
    const postGeometry = new THREE.BoxGeometry(0.11, 3.45, 0.12);
    const beamGeometry = new THREE.BoxGeometry(9.0, 0.09, 0.12);
    const rowZs = [-3.2, 0, 3.2];
    rowZs.forEach((z) => {
      [-4.45, -2.2, 0, 2.2, 4.45].forEach((x) => {
        const post = new THREE.Mesh(postGeometry, rackMaterial);
        post.position.set(x, 1.68, z);
        post.castShadow = true;
        scene.add(post);
      });
      [0.32, 1.28, 2.24, 3.2].forEach((y) => {
        const frontBeam = new THREE.Mesh(beamGeometry, beamMaterial);
        frontBeam.position.set(0, y, z + 0.43);
        frontBeam.castShadow = true;
        scene.add(frontBeam);
      });
    });

    const geometry = new THREE.BoxGeometry(1.42, 0.68, 0.78);
    const bins: BinHit[] = [];
    const columns = [-3.35, -1.12, 1.12, 3.35];
    const levels = [0.77, 1.73, 2.69];
    let slot = 0;
    rowZs.forEach((z, row) => {
      levels.forEach((y, level) => {
        columns.forEach((x, col) => {
          const part = displayedParts[slot] ?? null;
          const material = new THREE.MeshStandardMaterial({
            color: colorFor(part, colorModeRef.current, slot === selectedIndexRef.current),
            roughness: 0.62,
            metalness: 0.04,
            transparent: !part,
            opacity: part ? 0.96 : 0.38,
            emissive: new THREE.Color(part && /reconcile|audit|urgent|missing/i.test(part.status) ? '#32050A' : '#000000'),
            emissiveIntensity: 0.2,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(x, y, z);
          mesh.castShadow = Boolean(part);
          mesh.receiveShadow = true;
          mesh.userData.binIndex = slot;
          mesh.userData.part = part;
          mesh.userData.binCode = part?.bin ?? `R${row + 1}-L${level + 1}-S${col + 1}`;
          scene.add(mesh);
          const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: part ? '#FBF7F3' : '#B7A9A0', transparent: true, opacity: part ? 0.7 : 0.42 }));
          edge.position.copy(mesh.position);
          scene.add(edge);
          bins.push({ mesh, part, binCode: mesh.userData.binCode as string, index: slot });
          slot += 1;
        });
      });
    });
    binHitsRef.current = bins;

    // Subtle facility markers make orientation easier without turning the scene into decoration.
    const dock = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.08, 1.15), new THREE.MeshStandardMaterial({ color: BURGUNDY }));
    dock.position.set(-6.5, 0.02, 4.5);
    scene.add(dock);
    const dockStripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 1.45), new THREE.MeshBasicMaterial({ color: ACCENT }));
    dockStripe.position.set(-6.5, 0.08, 4.5);
    scene.add(dockStripe);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 8;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(0, 1.45, 0);
    controlsRef.current = controls;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const found = raycaster.intersectObjects(bins.map((bin) => bin.mesh), false)[0];
      if (!found) return;
      const record = found.object.userData.part as InventoryPart | null;
      const index = Number(found.object.userData.binIndex ?? 0);
      setSelectedIndex(index);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    const onCanvasKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((current) => (current + 1) % bins.length);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((current) => (current - 1 + bins.length) % bins.length);
      }
    };
    renderer.domElement.addEventListener('keydown', onCanvasKeyDown);

    const resizeObserver = new ResizeObserver(() => {
      if (!mount.isConnected) return;
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resizeObserver.observe(mount);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('keydown', onCanvasKeyDown);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      binHitsRef.current = [];
    };
    // Rebuild only when the supplied inventory records change, never on selection state.
    }, [displayedParts, dataMode]);

  useEffect(() => {
    colorModeRef.current = colorMode;
    selectedIndexRef.current = selectedIndex;
    binHitsRef.current.forEach(({ mesh, part, index }) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(colorFor(part, colorMode, index === selectedIndex));
      material.emissive.set(part && /reconcile|audit|urgent|missing/i.test(part.status) && index !== selectedIndex ? '#32050A' : '#000000');
    });
  }, [colorMode, selectedIndex]);

  const resetCamera = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(10.8, 9.3, 13.2);
    controls.target.set(0, 1.45, 0);
    controls.update();
  };

  return <div className="twin-workbench">
    <div className="twin-toolbar">
      <div className="twin-toolbar__modes" role="group" aria-label="Warehouse color overlay">
        <button type="button" className={colorMode === 'state' ? 'is-active' : ''} onClick={() => setColorMode('state')}>Inventory state</button>
        <button type="button" className={colorMode === 'variance' ? 'is-active' : ''} onClick={() => setColorMode('variance')}>Ledger variance</button>
        <button type="button" className={colorMode === 'confidence' ? 'is-active' : ''} onClick={() => setColorMode('confidence')}>Vision confidence</button>
      </div>
      <button type="button" className="twin-reset" onClick={resetCamera}>Reset view ↺</button>
    </div>
    <div className="twin-stage-grid">
      <div className="twin-scene-wrap">
        <div className="twin-scene-badge"><span>3D FACILITY TWIN</span><b>{dataMode === 'connected-empty' ? 'NO STOCK BASELINE' : 'STATE-BOUND VIEW'}</b></div>
        <div ref={mountRef} className="twin-canvas" />
        {webglUnavailable && <div className="twin-fallback"><strong>3D rendering is unavailable in this browser.</strong><p>Enable WebGL or use the accessible inventory table to inspect state.</p></div>}
        <div className="twin-scene-hint">Drag to orbit · Scroll to zoom · Select a bin for detail</div>
        <div className="twin-legend"><span><i className="twin-legend__ok" />Within tolerance</span><span><i className="twin-legend__warn" />Review required</span><span><i className="twin-legend__risk" />Selected / reconciliation priority</span><span><i className="twin-legend__empty" />Unmapped or baseline missing</span></div>
      </div>
      <aside className="twin-inspector">
        <div className="twin-inspector__head"><div><p className="eyebrow">SELECTED STATE OBJECT</p><h3>{selectedPart?.bin ?? 'Facility overview'}</h3></div><span className="twin-object-code">BIN / PART</span></div>
        {selectedPart ? <>
          <div className="twin-part-name"><strong>{selectedPart.name}</strong><span>{selectedPart.sku}</span></div>
          <div className="twin-stock-pair"><div><span>Ledger state</span><strong>{Number.isFinite(selectedPart.ledger) ? formatNumber(selectedPart.ledger) : '—'}</strong><small>{Number.isFinite(selectedPart.ledger) ? 'units recorded' : 'baseline required'}</small></div><div><span>Physical posterior</span><strong>{Number.isFinite(selectedPart.physical) ? formatNumber(selectedPart.physical) : '—'}</strong><small>{Number.isFinite(selectedPart.physical) ? 'mean estimate' : 'baseline required'}</small></div></div>
          <div className="twin-confidence"><div><span>Vision confidence</span><strong>{Number.isFinite(selectedPart.physical) ? `${Math.round(selectedPart.confidence * 100)}%` : 'No baseline'}</strong></div><div className="twin-confidence__track"><span style={{ width: `${Number.isFinite(selectedPart.physical) ? Math.max(0, Math.min(100, selectedPart.confidence * 100)) : 0}%` }} /></div></div>
          <div className="twin-inspector__row"><span>Current status</span><strong>{selectedPart.status}</strong></div>
          <div className="twin-inspector__row"><span>Criticality</span><strong>{selectedPart.criticality}</strong></div>
          <div className="twin-inspector__row"><span>Data provenance</span><strong>{selectedPart.source}</strong></div>
          <button type="button" className="twin-open-part" onClick={() => onOpenPart?.(selectedPart)}>Open part record <span>↗</span></button>
        </> : <div className="twin-empty-detail"><div className="twin-empty-glyph">◎</div><strong>{dataMode === 'connected-empty' ? 'Awaiting a physical baseline' : 'Select a populated bin'}</strong><p>Click a colored inventory box in the scene. The inspector reads from the same supplied part state as the inventory register.</p><span>{displayedParts.length} / 36 mapped slots</span></div>}
        <div className="twin-integrity-note"><span>STATE BINDING</span><p>Each populated object maps to the displayed part/bin record. This preview uses a schematic facility layout, not surveyed facility coordinates.</p></div>
      </aside>
    </div>
  </div>;
}
