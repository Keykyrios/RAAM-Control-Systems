export type InventoryPart = {
  partId?: number; sku: string; name: string; family: string; bin: string; ledger: number; physical: number;
  confidence: number; value: number; criticality: 'Critical' | 'High' | 'Standard'; status: string;
  demandClass: string; supplier: string; leadDays: number; reorderQty: number; source: string;
};

// This is intentionally synthetic UI training data. It must never be presented as Raam observed data.
export const demoParts: InventoryPart[] = [
  { sku: 'DEMO-BRK-014', name: 'Front brake pad kit', family: 'Urban SUV', bin: 'B-02-14', ledger: 18, physical: 14.6, confidence: 0.82, value: 1840, criticality: 'Critical', status: 'Reconcile', demandClass: 'Intermittent', supplier: 'Demo Supplier North', leadDays: 8, reorderQty: 12, source: 'SYNTHETIC_DEMO' },
  { sku: 'DEMO-FLT-027', name: 'Oil filter cartridge', family: 'Diesel utility', bin: 'A-01-08', ledger: 64, physical: 62.3, confidence: 0.96, value: 320, criticality: 'Standard', status: 'Healthy', demandClass: 'Smooth', supplier: 'Demo Supplier West', leadDays: 6, reorderQty: 0, source: 'SYNTHETIC_DEMO' },
  { sku: 'DEMO-SEN-103', name: 'Crankshaft position sensor', family: 'Passenger', bin: 'C-03-03', ledger: 7, physical: 4.2, confidence: 0.69, value: 2650, criticality: 'Critical', status: 'Audit required', demandClass: 'Lumpy', supplier: 'Demo Supplier North', leadDays: 12, reorderQty: 8, source: 'SYNTHETIC_DEMO' },
  { sku: 'DEMO-BLT-009', name: 'Accessory drive belt', family: 'Urban SUV', bin: 'B-01-04', ledger: 23, physical: 22.5, confidence: 0.98, value: 960, criticality: 'High', status: 'Healthy', demandClass: 'Intermittent', supplier: 'Demo Supplier West', leadDays: 7, reorderQty: 0, source: 'SYNTHETIC_DEMO' },
  { sku: 'DEMO-CLP-061', name: 'Retainer clip set', family: 'Cross-platform', bin: 'A-02-11', ledger: 110, physical: 102.1, confidence: 0.73, value: 85, criticality: 'Standard', status: 'Variance review', demandClass: 'Smooth', supplier: 'Demo Supplier West', leadDays: 5, reorderQty: 0, source: 'SYNTHETIC_DEMO' },
  { sku: 'DEMO-PMP-044', name: 'Coolant circulation pump', family: 'Diesel utility', bin: 'C-01-02', ledger: 4, physical: 3.4, confidence: 0.91, value: 4280, criticality: 'Critical', status: 'Order review', demandClass: 'Lumpy', supplier: 'Demo Supplier North', leadDays: 11, reorderQty: 6, source: 'SYNTHETIC_DEMO' },
  { sku: 'DEMO-ELC-208', name: 'Starter relay assembly', family: 'Passenger', bin: 'B-03-06', ledger: 13, physical: 13, confidence: 0.99, value: 1450, criticality: 'High', status: 'Healthy', demandClass: 'Intermittent', supplier: 'Demo Supplier West', leadDays: 9, reorderQty: 0, source: 'SYNTHETIC_DEMO' },
  { sku: 'DEMO-SUS-032', name: 'Stabilizer link', family: 'Urban SUV', bin: 'A-03-09', ledger: 9, physical: 6.8, confidence: 0.77, value: 730, criticality: 'High', status: 'Reconcile', demandClass: 'Smooth', supplier: 'Demo Supplier North', leadDays: 7, reorderQty: 10, source: 'SYNTHETIC_DEMO' },
];

export const movementRows = [
  { id: 'EV-DEMO-842', action: 'Issue posted', sku: 'DEMO-BRK-014', qty: '−2 units', path: 'B-02-14 → JOB-4820', actor: 'Storekeeper 07', time: '09:42:18', state: 'Conforming' },
  { id: 'EV-DEMO-841', action: 'Physical observation', sku: 'DEMO-SEN-103', qty: '4 units seen', path: 'CAM-03 → C-03-03', actor: 'Vision gateway 03', time: '09:39:51', state: 'Review' },
  { id: 'EV-DEMO-840', action: 'Goods received', sku: 'DEMO-FLT-027', qty: '+24 units', path: 'DOCK-02 → QC', actor: 'Receiving 02', time: '09:34:09', state: 'Conforming' },
  { id: 'EV-DEMO-839', action: 'Transfer posted', sku: 'DEMO-BLT-009', qty: '6 units', path: 'A-02-02 → B-01-04', actor: 'Storekeeper 03', time: '09:27:44', state: 'Conforming' },
  { id: 'EV-DEMO-838', action: 'Job completion', sku: 'DEMO-PMP-044', qty: '1 unit', path: 'JOB-4817 → INVOICE', actor: 'Service desk 01', time: '09:14:03', state: 'Missing edge' },
];

export const exceptionRows = [
  { id: 'RC-DEMO-1042', sku: 'DEMO-SEN-103', name: 'Crankshaft position sensor', reason: 'Ledger exceeds visual posterior', likelihood: 0.84, exposure: 18550, owner: 'Unassigned', priority: 'Urgent' },
  { id: 'RC-DEMO-1041', sku: 'DEMO-BRK-014', name: 'Front brake pad kit', reason: 'Issue → job-card edge missing', likelihood: 0.71, exposure: 12880, owner: 'Storekeeper 07', priority: 'High' },
  { id: 'RC-DEMO-1039', sku: 'DEMO-CLP-061', name: 'Retainer clip set', reason: 'Count uncertainty above tolerance', likelihood: 0.65, exposure: 850, owner: 'Unassigned', priority: 'Normal' },
  { id: 'RC-DEMO-1038', sku: 'DEMO-SUS-032', name: 'Stabilizer link', reason: 'Transfer destination not confirmed', likelihood: 0.58, exposure: 4380, owner: 'Storekeeper 03', priority: 'High' },
];

export const trendData = [
  { label: 'May 04', ledger: 89, physical: 85 }, { label: 'May 08', ledger: 91, physical: 88 },
  { label: 'May 12', ledger: 87, physical: 82 }, { label: 'May 16', ledger: 92, physical: 87 },
  { label: 'May 20', ledger: 94, physical: 89 }, { label: 'May 24', ledger: 91, physical: 86 },
  { label: 'May 28', ledger: 96, physical: 92 }, { label: 'Jun 01', ledger: 95, physical: 90 },
  { label: 'Jun 05', ledger: 98, physical: 93 }, { label: 'Jun 09', ledger: 97, physical: 95 },
  { label: 'Jun 13', ledger: 96, physical: 92 }, { label: 'Jun 17', ledger: 99, physical: 94 },
];

export const forecastData = [
  { period: 'W1', actual: 19, forecast: 16 }, { period: 'W2', actual: 12, forecast: 14 },
  { period: 'W3', actual: 22, forecast: 20 }, { period: 'W4', actual: 14, forecast: 18 },
  { period: 'W5', actual: 27, forecast: 23 }, { period: 'W6', actual: 21, forecast: 25 },
  { period: 'W7', actual: 29, forecast: 26 }, { period: 'W8', actual: 25, forecast: 28 },
];

export const navigation = [
  { label: 'Overview', icon: 'Gauge', section: 'OPERATIONS' },
  { label: 'Inventory', icon: 'Package', section: 'OPERATIONS' },
  { label: 'Reconciliation', icon: 'GitBranch', section: 'OPERATIONS' },
  { label: 'Movement ledger', icon: 'ArrowsLeftRight', section: 'OPERATIONS' },
  { label: 'Vision observations', icon: 'Scan', section: 'SENSING' },
  { label: 'Demand & lead time', icon: 'ChartLineUp', section: 'PLANNING' },
  { label: 'Replenishment', icon: 'ShoppingCart', section: 'PLANNING' },
  { label: 'Inspection plan', icon: 'ClipboardText', section: 'PLANNING' },
  { label: 'Spatial twin', icon: 'BoundingBox', section: 'FACILITY' },
  { label: 'Scenarios', icon: 'SlidersHorizontal', section: 'ANALYSIS' },
  { label: 'Evaluation', icon: 'ChartBar', section: 'ANALYSIS' },
  { label: 'Settings', icon: 'GearSix', section: 'SYSTEM' },
];
