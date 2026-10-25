import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  Pulse, ArrowDownRight, ArrowRight, ArrowUpRight, ArrowsLeftRight, Bell, BoundingBox,
  CalendarBlank, Camera, CaretDown, ChartBar, ChartLineUp, Check, CheckCircle, ClipboardText,
  ClockCounterClockwise, Database, DownloadSimple, Eye, FileCsv, FunnelSimple, GearSix,
  GitBranch, Gauge, MagnifyingGlass, Package, Plus, Scan, ShieldCheck, ShoppingCart,
  SlidersHorizontal, WarningCircle, X, Lightning, CircleNotch, TrendDown, TrendUp,
  Wrench, MapPin, ListChecks, Cube, Clipboard, ArrowCounterClockwise, DotsThree,
} from '@phosphor-icons/react';
import type { IconProps } from '@phosphor-icons/react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { demoParts, exceptionRows, forecastData, movementRows, navigation, trendData, type InventoryPart } from './data';
import {
  API_BASE, assignReconciliationCase, getEvents, getHealth, getLedgerIntegrity, getOverview,
  getReconciliationCases, postEvent, resolveReconciliationCase, type IntegrityResult,
  type LedgerEventRecord, type Overview, type ReconciliationCaseRecord,
} from './api';
import WarehouseTwin from './WarehouseTwin';
import VisionWorkbench from './VisionWorkbench';

type IconComponent = ComponentType<IconProps>;
const iconMap: Record<string, IconComponent> = {
  Gauge, Package, GitBranch, ArrowsLeftRight, Scan, ChartLineUp, ShoppingCart, ClipboardText,
  BoundingBox, SlidersHorizontal, ChartBar, GearSix,
};

type DataMode = 'demo' | 'connected-empty' | 'connected' | 'connected-synthetic';
type Toast = { title: string; detail?: string; kind?: 'success' | 'error' } | null;
type ExceptionView = {
  id: string; partId: number | null; sku: string; name: string; reason: string; likelihood: number;
  exposure: number; owner: string; priority: 'Urgent' | 'High' | 'Normal'; status: string;
  record?: ReconciliationCaseRecord;
};
type MovementView = {
  id: string; action: string; sku: string; qty: string; path: string; actor: string; time: string;
  state: string; source: string;
};

function priorityFor(exposure: number, score: number): 'Urgent' | 'High' | 'Normal' {
  if (score >= 12_000 || exposure >= 15_000) return 'Urgent';
  if (score >= 3_000 || exposure >= 4_000) return 'High';
  return 'Normal';
}

function actionFor(eventType: string): string {
  const labels: Record<string, string> = {
    RECEIPT: 'Goods received', ISSUE: 'Issue posted', RETURN: 'Return posted', TRANSFER: 'Transfer posted',
    TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', SCRAP: 'Scrap posted',
    VENDOR_RETURN: 'Vendor return', ADJUSTMENT_IN: 'Adjustment in', ADJUSTMENT_OUT: 'Adjustment out',
    JOB_POSTED: 'Job completion', INVOICE_POSTED: 'Invoice posted', QC_PASS: 'Quality check passed',
    PUT_AWAY: 'Put away', REVERSAL_IN: 'Reversal in', REVERSAL_OUT: 'Reversal out',
  };
  return labels[eventType.toUpperCase()] || eventType.replaceAll('_', ' ').toLowerCase();
}

function quantityFor(eventType: string, quantity: number): string {
  const outbound = ['ISSUE', 'SCRAP', 'VENDOR_RETURN', 'TRANSFER_OUT', 'ADJUSTMENT_OUT', 'REVERSAL_OUT'];
  const inbound = ['RECEIPT', 'RETURN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'REVERSAL_IN'];
  if (outbound.includes(eventType.toUpperCase())) return `−${quantity} units`;
  if (inbound.includes(eventType.toUpperCase())) return `+${quantity} units`;
  return `${quantity} units`;
}

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const number = (value: number) => new Intl.NumberFormat('en-IN').format(value);

function StatusDot({ tone = 'green' }: { tone?: 'green' | 'red' | 'amber' | 'gray' }) {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}

function Button({ children, onClick, variant = 'secondary', icon: Icon, disabled = false }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'quiet'; icon?: IconComponent; disabled?: boolean;
}) {
  return <button className={`button button--${variant}`} onClick={onClick} disabled={disabled} type="button">
    {Icon && <Icon size={16} weight="regular" />}{children}
  </button>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-state__icon"><Database size={22} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{detail}</p></div>{action && <div className="section-heading__actions">{action}</div>}</div>;
}

function Sidebar({ active, onNavigate, reconciliationCount }: { active: string; onNavigate: (value: string) => void; reconciliationCount: number }) {
  const sections = [...new Set(navigation.map((item) => item.section))];
  return <aside className="sidebar">
    <div className="brand-lockup">
      <div className="brand-mark"><span /><span /><span /></div>
      <div className="brand-name"><strong>RAAM</strong><span>CONTROL SYSTEMS</span></div>
    </div>
    <div className="site-switcher" role="button" tabIndex={0} onClick={() => onNavigate('Settings')} onKeyDown={(e) => e.key === 'Enter' && onNavigate('Settings')}>
      <div className="site-avatar">RM</div><div className="site-switcher__copy"><strong>Service network</strong><span>Demo site · Mumbai</span></div><CaretDown size={15} />
    </div>
    <nav className="navigation" aria-label="Main navigation">
      {sections.map((section) => <div className="nav-section" key={section}>
        <p className="nav-section__label">{section}</p>
        {navigation.filter((item) => item.section === section).map((item) => {
          const Icon = iconMap[item.icon] || Package;
          return <button key={item.label} type="button" onClick={() => onNavigate(item.label)} className={`nav-item ${active === item.label ? 'nav-item--active' : ''}`}>
            <Icon size={18} weight={active === item.label ? 'fill' : 'regular'} />
            <span>{item.label}</span>
            {item.label === 'Reconciliation' && reconciliationCount > 0 && <span className="nav-count">{reconciliationCount}</span>}
          </button>;
        })}
      </div>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="system-status"><div className="system-status__top"><StatusDot tone="green" /><span>Control loop</span><strong>Ready</strong></div><div className="system-status__bar"><span /></div><p>Models connected · actions require approval</p></div>
      <button className="profile-row" type="button" onClick={() => onNavigate('Settings')}><div className="profile-avatar">OP</div><div><strong>Operations planner</strong><span>Inventory control</span></div><DotsThree size={18} /></button>
    </div>
  </aside>;
}

function Header({ active, onSearch, query, connected, onRefresh, refreshing, onNotifications }: {
  active: string; onSearch: (value: string) => void; query: string; connected: boolean; onRefresh: () => void; refreshing: boolean; onNotifications: () => void;
}) {
  return <header className="topbar">
    <div className="breadcrumbs"><span>RAAM</span><span className="breadcrumbs__slash">/</span><strong>{active}</strong></div>
    <div className="topbar__actions">
      <label className="global-search"><MagnifyingGlass size={17} /><input value={query} onChange={(e) => onSearch(e.target.value)} placeholder="Search parts, jobs, events..." aria-label="Search the application" /><kbd>⌘ K</kbd></label>
      <button className="icon-button topbar-refresh" onClick={onRefresh} aria-label="Refresh data" title="Refresh data">{refreshing ? <CircleNotch className="spin" size={18} /> : <ArrowCounterClockwise size={18} />}</button>
      <button className="icon-button notification-button" aria-label="Notifications" onClick={onNotifications}><Bell size={18} /><i /></button>
      <div className="connection-state"><StatusDot tone={connected ? 'green' : 'amber'} /><span>{connected ? 'API connected' : 'Local preview'}</span></div>
    </div>
  </header>;
}

function Kpi({ label, value, delta, detail, tone = 'neutral', icon: Icon }: {
  label: string; value: string; delta?: string; detail: string; tone?: string; icon: IconComponent;
}) {
  return <div className="kpi"><div className="kpi__head"><span>{label}</span><Icon size={17} /></div><div className="kpi__value">{value}</div><div className="kpi__foot"><span className={`kpi__delta kpi__delta--${tone}`}>{delta}</span><span>{detail}</span></div></div>;
}

function InventoryTable({ parts, onOpen, query, dataMode }: { parts: InventoryPart[]; onOpen: (part: InventoryPart) => void; query: string; dataMode: DataMode }) {
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [criticalFilter, setCriticalFilter] = useState('All criticality');
  const filtered = useMemo(() => parts.filter((part) => {
    const q = query.toLowerCase();
    const searchHit = !q || [part.sku, part.name, part.family, part.bin, part.supplier].some((x) => x.toLowerCase().includes(q));
    const statusHit = statusFilter === 'All statuses' || part.status.toLowerCase().includes(statusFilter.toLowerCase());
    const criticalHit = criticalFilter === 'All criticality' || part.criticality === criticalFilter;
    return searchHit && statusHit && criticalHit;
  }), [parts, query, statusFilter, criticalFilter]);
  return <div className="table-shell">
    <div className="table-toolbar"><div><strong>Part register</strong><span>{filtered.length} records · physical and ledger state kept separate</span></div>
      <div className="table-toolbar__controls"><label className="select-wrap"><FunnelSimple size={15} /><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option>All statuses</option><option>Reconcile</option><option>Audit required</option><option>Physical baseline required</option><option>Baseline required</option><option>Healthy</option><option>Order review</option><option>Variance review</option></select>
</label>
      <label className="select-wrap"><select value={criticalFilter} onChange={(e) => setCriticalFilter(e.target.value)} aria-label="Filter by criticality"><option>All criticality</option><option>Critical</option><option>High</option><option>Standard</option></select></label></div>
    </div>
    {dataMode === 'connected-empty' ? <EmptyState title="No inventory records yet" detail="Connect master data and create a baseline stock snapshot. This view will not substitute sample quantities for operational records." /> :
      <div className="table-scroll"><table className="data-table"><thead><tr><th>PART / SKU</th><th>LOCATION</th><th>LEDGER</th><th>PHYSICAL EST.</th><th>CONFIDENCE</th><th>UNIT VALUE</th><th>STATUS</th><th /></tr></thead><tbody>
        {filtered.map((part) => <tr key={part.sku} onClick={() => onOpen(part)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(part)}>
          <td><div className="part-cell"><div className="part-glyph">{part.criticality === 'Critical' ? <Lightning size={17} /> : <Package size={17} />}</div><div><strong>{part.name}</strong><span>{part.sku}</span><span className={part.source === 'SYNTHETIC_DEMO' ? 'source-mini source-mini--demo' : 'source-mini'}>{part.source}</span></div></div></td>
          <td><span className="mono">{part.bin}</span><small>{part.family}</small></td><td><span className="qty">{Number.isFinite(part.ledger) ? part.ledger : '—'}</span></td>
          <td><span className="qty">{Number.isFinite(part.physical) ? part.physical.toFixed(1) : '—'}</span>{Number.isFinite(part.physical) && <small className={part.ledger - part.physical > 2 ? 'text-red' : ''}>{part.ledger - part.physical > 0 ? '−' : '+'}{Math.abs(part.ledger - part.physical).toFixed(1)} from ledger</small>}</td>
          <td><div className="confidence-cell"><div className="confidence-track"><span style={{ width: `${part.confidence * 100}%` }} className={part.confidence < 0.75 ? 'confidence-track__fill--warn' : ''} /></div><span>{Math.round(part.confidence * 100)}%</span></div></td>
          <td className="money-cell">{money(part.value)}</td><td><Tag tone={statusTone(part.status)}><StatusDot tone={statusTone(part.status) === 'critical' ? 'red' : statusTone(part.status) === 'warning' ? 'amber' : 'green'} />{part.status}</Tag></td><td><button className="table-more" aria-label={`Open ${part.sku}`} onClick={(e) => { e.stopPropagation(); onOpen(part); }}><ArrowRight size={16} /></button></td>
        </tr>)}
      </tbody></table>{filtered.length === 0 && <EmptyState title="No matching parts" detail="Try a different part number or clear one of the filters." />}</div>}
    <div className="table-footer"><span>Source classification: {dataMode === 'demo' ? 'SYNTHETIC_DEMO' : 'DATABASE RECORDS'}</span><span>{dataMode === 'demo' ? 'Preview values only' : 'Quantities require a recorded snapshot'}</span></div>
  </div>;
}

function statusTone(status: string): string {
  if (/reconcile|audit|missing|urgent/i.test(status)) return 'critical';
  if (/variance|review|order/i.test(status)) return 'warning';
  if (/healthy|conforming|closed|ready/i.test(status)) return 'success';
  return 'neutral';
}

function Dashboard({ onNavigate, query, parts, dataMode, apiOverview, cases, events, lastRefreshed, ledgerIntegrity }: {
  onNavigate: (page: string) => void; query: string; parts: InventoryPart[]; dataMode: DataMode; apiOverview: Overview | null;
  cases: ExceptionView[]; events: MovementView[]; lastRefreshed: Date | null; ledgerIntegrity: IntegrityResult | null;
}) {
  const [selectedRange, setSelectedRange] = useState('30 days');
  const [showAllExceptions, setShowAllExceptions] = useState(false);
  const openCases = cases.filter((row) => row.status !== 'RESOLVED');
  const visibleExceptions = openCases.filter((row) => !query || `${row.sku} ${row.name} ${row.reason} ${row.owner}`.toLowerCase().includes(query.toLowerCase())).slice(0, showAllExceptions ? 10 : 3);
  const visibleTrendData = selectedRange === '30 days' ? trendData.slice(-8) : selectedRange === '90 days' ? trendData.slice(-10) : trendData;
  const syntheticTrend = dataMode === 'demo' || dataMode === 'connected-synthetic';
  const reconciliationCount = openCases.length;
  const visibleEvents = events.filter((row) => !query || `${row.id} ${row.sku} ${row.action} ${row.path} ${row.actor}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4);
  return <div className="page-content">
    <SectionHeading eyebrow="INTEGRATED INVENTORY CONTROL" title="Spare-parts control" detail="Physical stock, transaction history and replenishment policy, reconciled in one operating view."
      action={<><Button variant="secondary" icon={ClockCounterClockwise} onClick={() => onNavigate('Movement ledger')}>Movement ledger</Button><Button variant="primary" icon={Pulse} onClick={() => onNavigate('Replenishment')}>Run control cycle</Button></>} />
    <div className="kpi-grid">
      <Kpi label="Parts under control" value={dataMode === 'demo' ? '1,284' : number(apiOverview?.parts ?? 0)} delta={dataMode === 'demo' ? '+18 this month' : 'database'} detail="active SKUs" tone="neutral" icon={Package} />
      <Kpi label="Physical / ledger gap" value={dataMode === 'demo' ? '3.8%' : apiOverview?.unit_iri == null ? '—' : `${(apiOverview.unit_iri * 100).toFixed(1)}%`} delta={dataMode === 'demo' ? '−0.6 pp' : apiOverview?.snapshots_with_physical_estimate ? `${apiOverview.snapshots_with_physical_estimate} snapshots` : 'awaiting baseline'} detail="unit-state discrepancy" tone="good" icon={GitBranch} />
      <Kpi label="Open reconciliation" value={number(reconciliationCount)} delta={reconciliationCount ? `${reconciliationCount} open` : 'no open cases'} detail="ranked by expected exposure" tone={reconciliationCount ? 'bad' : 'neutral'} icon={WarningCircle} />
      <Kpi label="Service at risk" value={dataMode === 'demo' ? '27 SKUs' : '—'} delta={dataMode === 'demo' ? '9 critical parts' : 'awaiting policy run'} detail="lead-time demand exposure" tone="warn" icon={Pulse} />
    </div>
    <div className="overview-grid">
      <section className="panel discrepancy-panel">
        <div className="panel-heading"><div><p className="eyebrow">INVENTORY INTEGRITY</p><h2>Physical state vs. ledger</h2><p>Indexed agreement across active parts</p></div>
          <label className="simple-select"><select value={selectedRange} onChange={(e) => setSelectedRange(e.target.value)}><option>30 days</option><option>90 days</option><option>12 months</option></select><CaretDown size={14} /></label></div>
        {!syntheticTrend ? <EmptyState title={dataMode === 'connected-empty' ? 'Baseline not established' : 'Historical trend not available'} detail={dataMode === 'connected-empty' ? 'A trend requires dated physical snapshots and ledger states. The system will not infer history from a single count.' : 'This database has current inventory state but no recorded time series. Import dated snapshots and ledger evidence before plotting a trend. No synthetic history is substituted.'} /> : <>
          <div className="chart-legend"><span><i className="legend-dot legend-dot--ledger" />Ledger match</span><span><i className="legend-dot legend-dot--physical" />Physical confidence index</span><Tag tone="warning">SYNTHETIC DEMO</Tag><span className="chart-legend__value">Illustrative <small>not an operating metric</small></span></div>
          <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><AreaChart data={visibleTrendData} margin={{ top: 6, right: 4, left: -22, bottom: 0 }}>
            <defs><linearGradient id="ledgerFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#B21E2B" stopOpacity={0.12} /><stop offset="100%" stopColor="#B21E2B" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#E9E5E1" strokeDasharray="3 4" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#88817E', fontSize: 10 }} interval={2} /><YAxis domain={[70, 100]} tickLine={false} axisLine={false} tick={{ fill: '#88817E', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#e7e2de', boxShadow: 'none', fontSize: 12 }} />
            <Area type="monotone" dataKey="ledger" name="Ledger match" stroke="#B21E2B" strokeWidth={2.2} fill="url(#ledgerFill)" activeDot={{ r: 4, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="physical" name="Physical confidence" stroke="#4B191F" strokeWidth={2} fill="transparent" activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart></ResponsiveContainer></div>
          <div className="chart-insight"><span className="chart-insight__mark"><WarningCircle size={16} /></span><p><strong>Synthetic sample history.</strong> This series exercises the chart only. It is not a Raam operating result and must not be used to set targets.</p><button onClick={() => onNavigate('Reconciliation')}>Inspect exceptions <ArrowRight size={15} /></button></div>
        </>}
      </section>
      <section className="panel loop-panel">          <div className="panel-heading"><div><p className="eyebrow">CLOSED CONTROL LOOP</p><h2>State synchronization</h2><p>Evidence updates policy, not just the screen</p></div><button className="dots-button" aria-label="Open control settings" onClick={() => onNavigate('Settings')}><DotsThree size={20} /></button></div>

        <div className="control-loop">
          <div className="loop-step"><div className="loop-step__icon loop-step__icon--vision"><Camera size={18} /></div><div><strong>Physical observation</strong><span>Camera evidence · audit</span></div><Tag tone="neutral">Evidence</Tag></div>
          <div className="loop-connector"><span /></div>
          <div className="loop-step"><div className="loop-step__icon loop-step__icon--state"><GitBranch size={18} /></div><div><strong>State estimation</strong><span>Posterior over on-hand stock</span></div><Tag tone="neutral">Filter</Tag></div>
          <div className="loop-connector"><span /></div>
          <div className="loop-step"><div className="loop-step__icon loop-step__icon--forecast"><ChartLineUp size={18} /></div><div><strong>Demand & lead time</strong><span>Empirical distribution</span></div><Tag tone="neutral">Rolling</Tag></div>
          <div className="loop-connector"><span /></div>
          <div className="loop-step"><div className="loop-step__icon loop-step__icon--action"><SlidersHorizontal size={18} /></div><div><strong>Feasible policy</strong><span>Budget · capacity · service</span></div><Tag tone="warning">Approval</Tag></div>
        </div>
        <div className="loop-panel__foot"><ShieldCheck size={16} /><span>Actions are proposals until approved. Overrides remain in the audit trail.</span></div>
      </section>
    </div>
    <div className="lower-grid">
      <section className="panel exceptions-panel">
        <div className="panel-heading"><div><p className="eyebrow">RECONCILIATION QUEUE</p><h2>Needs a decision</h2><p>Priority = unresolved probability × economic exposure</p></div><button className="text-action" onClick={() => setShowAllExceptions((s) => !s)}>{showAllExceptions ? 'Show less' : 'View queue'} <ArrowRight size={15} /></button></div>
        {visibleExceptions.length === 0 ? <EmptyState title="No exceptions to display" detail="Reconciliation cases appear when observations, event chains or audits indicate a discrepancy. This list is empty because no evidence-backed case is open in the connected database." /> :
          <div className="exception-list">{visibleExceptions.map((row) => <button className="exception-row" type="button" key={row.id} onClick={() => onNavigate('Reconciliation')}>
            <span className={`exception-priority exception-priority--${row.priority.toLowerCase()}`}>{row.priority === 'Urgent' ? <WarningCircle size={17} /> : row.priority === 'High' ? <TrendUp size={17} /> : <Eye size={17} />}</span>
            <span className="exception-main"><strong>{row.name}</strong><span>{row.sku} · {row.reason}</span></span>
            <span className="exception-exposure"><strong>{money(row.exposure)}</strong><span>{Math.round(row.likelihood * 100)}% probability</span></span><ArrowRight size={15} className="exception-arrow" />
          </button>)}</div>}
        <div className="panel-footer"><span><StatusDot tone={reconciliationCount ? 'red' : 'gray'} /> {reconciliationCount} open cases</span><span>{lastRefreshed ? `Refreshed ${lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not refreshed'}</span></div>
      </section>
      <section className="panel movement-panel">
        <div className="panel-heading"><div><p className="eyebrow">EVENT LINEAGE</p><h2>Recent movement</h2><p>Immutable transaction sequence</p></div><button className="text-action" onClick={() => onNavigate('Movement ledger')}>Full ledger <ArrowRight size={15} /></button></div>
        {visibleEvents.length === 0 ? <EmptyState title="No events recorded" detail="Receipts, issues, returns, transfers and verified adjustments will appear here after import." /> : <div className="movement-list">{visibleEvents.map((row) => <div className="movement-row" key={row.id}>
          <div className={`movement-symbol ${row.state === 'Review' ? 'movement-symbol--review' : ''}`}>{row.state === 'Review' ? <WarningCircle size={16} /> : row.action === 'Physical observation' ? <Scan size={16} /> : <ArrowsLeftRight size={16} />}</div>
          <div className="movement-copy"><strong>{row.action}</strong><span>{row.sku} · {row.path}</span></div><div className="movement-meta"><strong>{row.qty}</strong><span>{row.time}</span></div>
        </div>)}</div>}
        <div className="movement-foot"><span>Chain integrity</span>{ledgerIntegrity ? <Tag tone={ledgerIntegrity.valid ? 'success' : 'critical'}>{ledgerIntegrity.valid ? <CheckCircle size={13} /> : <WarningCircle size={13} />}{ledgerIntegrity.valid ? `Verified · ${ledgerIntegrity.checked_events} events` : 'Verification failed'}</Tag> : <Tag tone="neutral">Not checked</Tag>}</div>
      </section>
    </div>
    <div className="bottom-note"><ShieldCheck size={16} /><span>Reference policy only. Service targets, empirical lead times, unit costs and shrinkage assumptions must come from approved operational records.</span><button onClick={() => onNavigate('Evaluation')}>Evaluation rules <ArrowRight size={14} /></button></div>
  </div>;
}

function InventoryPage({ parts, query, dataMode, onOpen, onNavigate }: {
  parts: InventoryPart[]; query: string; dataMode: DataMode; onOpen: (part: InventoryPart) => void; onNavigate: (page: string) => void;
}) {
  const [showNewModal, setShowNewModal] = useState(false);
  return <div className="page-content">
    <SectionHeading eyebrow="MASTER DATA + STATE ESTIMATION" title="Inventory register" detail="One part master, multiple evidence sources. Ledger quantity and physical posterior stay separate until the evidence supports reconciliation."
      action={<><Button icon={DownloadSimple} onClick={() => exportCsv(dataMode === 'demo' ? 'inventory-register-synthetic.csv' : 'inventory-register.csv', ['sku','name','family','bin','ledger','physical','confidence','status','source_class'], parts.map((p) => [p.sku, p.name, p.family, p.bin, Number.isFinite(p.ledger) ? p.ledger : '', Number.isFinite(p.physical) ? p.physical : '', p.confidence, p.status, p.source]))}>Export register</Button><Button variant="primary" icon={Plus} onClick={() => setShowNewModal(true)}>Record movement</Button></>} />
    <div className="inventory-summary-strip"><div><span>Active SKUs</span><strong>{dataMode === 'connected-empty' ? '0' : number(parts.length)}</strong></div><div><span>Needs reconciliation</span><strong className="text-red">{dataMode === 'connected-empty' ? '0' : parts.filter((p) => /reconcile|audit|variance/i.test(p.status)).length}</strong></div><div><span>Critical parts</span><strong>{dataMode === 'connected-empty' ? '0' : parts.filter((p) => p.criticality === 'Critical').length}</strong></div><div><span>Physical baseline</span><strong className="subdued-value">{dataMode === 'connected-empty' ? 'Not set' : `${parts.filter((p) => Number.isFinite(p.physical)).length} of ${parts.length} located`}</strong></div></div>
    <InventoryTable parts={parts} query={query} dataMode={dataMode} onOpen={onOpen} />
    {showNewModal && <TransactionModal onClose={() => setShowNewModal(false)} onSaved={() => setShowNewModal(false)} parts={parts} dataMode={dataMode} />}
  </div>;
}

function ReconciliationPage({ dataMode, cases, onNavigate, onToast, onRefresh }: {
  dataMode: DataMode; cases: ExceptionView[]; onNavigate: (page: string) => void;
  onToast: (toast: Toast) => void; onRefresh: () => Promise<void>;
}) {
  const [status, setStatus] = useState('Open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [actor, setActor] = useState('Operations planner');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const visibleCases = cases.filter((row) => status === 'All' || (status === 'Open' ? row.status !== 'RESOLVED' : row.status === 'RESOLVED'));
  const selected = cases.find((row) => row.id === selectedId) || null;
  const openCase = (row: ExceptionView) => {
    setSelectedId(row.id);
    setAssignee(row.owner === 'Unassigned' ? '' : row.owner);
    setResolution(row.record?.resolution || '');
    setActionError('');
  };
  const closeDrawer = () => { setSelectedId(null); setActionError(''); };
  const assign = async () => {
    if (!selected?.record) { setActionError('This case is not backed by a connected reconciliation record. Demo cases cannot be changed.'); return; }
    if (!assignee.trim() || !actor.trim()) { setActionError('Enter an assignee and the actor recording the assignment.'); return; }
    setBusy(true); setActionError('');
    try {
      await assignReconciliationCase(selected.id, assignee.trim(), actor.trim());
      onToast({ title: 'Case assigned', detail: `${selected.id} assigned to ${assignee.trim()}. Ownership is recorded in the evidence path.` });
      await onRefresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not assign the case.'); }
    finally { setBusy(false); }
  };
  const resolve = async () => {
    if (!selected?.record) { setActionError('This case is not backed by a connected reconciliation record. Demo cases cannot be changed.'); return; }
    if (!actor.trim()) { setActionError('Enter the actor recording the resolution.'); return; }
    if (resolution.trim().length < 8) { setActionError('Describe the evidence and disposition in at least 8 characters.'); return; }
    setBusy(true); setActionError('');
    try {
      await resolveReconciliationCase(selected.id, resolution.trim(), actor.trim());
      onToast({ title: 'Case resolved with evidence', detail: `${selected.id} closed. No inventory quantity was changed by the resolution.` });
      setResolution('');
      await onRefresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not resolve the case.'); }
    finally { setBusy(false); }
  };
  return <div className="page-content">
    <SectionHeading eyebrow="PROCESS CONFORMANCE" title="Reconciliation queue" detail="Explain each physical or transactional discrepancy with an evidence path. An anomaly score is never a conclusion about intent."
      action={<Button variant="primary" icon={ClipboardText} onClick={() => onNavigate('Inspection plan')}>Plan inspections</Button>} />
    <div className="recon-banner"><div className="recon-banner__icon"><GitBranch size={20} /></div><div><strong>Priority ranking is economic, not accusatory.</strong><p>Case priority = posterior probability of unresolved state × observed economic exposure. Close cases only with a documented resolution path.</p></div></div>
    <div className="toolbar-line"><div className="segmented-tabs">{['Open', 'Resolved', 'All'].map((s) => <button key={s} className={status === s ? 'segmented-tabs__active' : ''} onClick={() => setStatus(s)}>{s}</button>)}</div><span className="muted-label">{visibleCases.length} visible · sorted by expected exposure</span></div>
    {visibleCases.length === 0 ? <EmptyState title="No cases in this view" detail="Cases are created from stock-state conflicts, missing event-graph edges or audit evidence. The connected database currently has no matching cases." /> : <div className="table-shell"><div className="table-scroll"><table className="data-table recon-table"><thead><tr><th>CASE</th><th>PART / EVENT</th><th>OBSERVED DEVIATION</th><th>UNRESOLVED P</th><th>EXPOSURE</th><th>ASSIGNED TO</th><th>STATUS</th><th /></tr></thead><tbody>{visibleCases.map((row) => <tr key={row.id} onClick={() => openCase(row)}><td><span className="mono case-id">{row.id}</span><small>{row.priority} priority</small></td><td><strong>{row.name}</strong><small>{row.sku}</small></td><td><span>{row.reason}</span></td><td><div className="probability-cell"><div className="probability-track"><span style={{ width: `${row.likelihood * 100}%` }} /></div>{Math.round(row.likelihood * 100)}%</div></td><td className="money-cell">{money(row.exposure)}</td><td>{row.owner}</td><td><Tag tone={row.status === 'RESOLVED' ? 'success' : 'warning'}>{row.status}</Tag></td><td><button className="table-more" aria-label={`Open ${row.id}`} onClick={(event) => { event.stopPropagation(); openCase(row); }}><ArrowRight size={16} /></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>{visibleCases.length} visible cases</span><span>Source: {dataMode === 'demo' ? 'SYNTHETIC_DEMO preview' : 'connected database records'}</span></div></div>}
    {selected && <div className="drawer-backdrop" onClick={closeDrawer}><aside className="detail-drawer" onClick={(event) => event.stopPropagation()}><button className="drawer-close" onClick={closeDrawer} aria-label="Close case"><X size={18} /></button><p className="eyebrow">CASE INVESTIGATION</p><h2>{selected.id}</h2><p className="drawer-intro"><span className="mono">{selected.sku}</span> · {selected.name}</p><div className="case-facts"><div><span>Unresolved probability</span><strong>{Math.round(selected.likelihood * 100)}%</strong></div><div><span>Economic exposure</span><strong>{money(selected.exposure)}</strong></div><div><span>Priority</span><strong>{selected.priority}</strong></div></div><div className="detail-block"><span>Observed deviation</span><p>{selected.reason}</p>{selected.record?.expected_quantity != null && <div className="detail-line"><small>Expected</small><strong>{selected.record.expected_quantity}</strong></div>}{selected.record?.observed_quantity != null && <div className="detail-line"><small>Observed</small><strong>{selected.record.observed_quantity}</strong></div>}</div><div className="detail-block"><span>Evidence path</span>{(selected.record?.evidence_path || []).length === 0 ? <p>No evidence entries are recorded on this case yet. Add evidence through the connected source workflow before closing it.</p> : (selected.record?.evidence_path || []).slice(-6).map((entry, index) => <div className="evidence-entry" key={`${selected.id}-${index}`}><span>{String((entry as { type?: string }).type || 'EVIDENCE')}</span><code>{JSON.stringify(entry).slice(0, 220)}</code></div>)}</div><div className="detail-block"><span>Assignment and resolution</span><label className="field"><span>Assigned to</span><input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Storekeeper or investigator ID" disabled={selected.status === 'RESOLVED' || busy} /></label><label className="field"><span>Actor recording this action</span><input value={actor} onChange={(event) => setActor(event.target.value)} disabled={selected.status === 'RESOLVED' || busy} /></label><button className="full-action" onClick={() => void assign()} disabled={busy || selected.status === 'RESOLVED' || !selected.record}><Clipboard size={16} />Assign case</button><label className="field case-resolution-field"><span>Resolution evidence</span><textarea value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Describe the evidence checked and the disposition. Do not infer intent." rows={4} disabled={selected.status === 'RESOLVED' || busy} /></label><button className="full-action full-action--dark" onClick={() => void resolve()} disabled={busy || selected.status === 'RESOLVED' || !selected.record}><Check size={16} />Resolve with evidence</button>{!selected.record && <p className="drawer-footnote">Synthetic preview case. Connect the backend and use database-backed case records to assign or resolve.</p>}</div>{actionError && <div className="form-error"><WarningCircle size={16} />{actionError}</div>}{selected.record?.resolution && <div className="detail-block"><span>Recorded resolution</span><p>{selected.record.resolution}</p>{selected.record.resolved_at && <small className="muted-label">Resolved {new Date(selected.record.resolved_at).toLocaleString()}</small>}</div>}<p className="drawer-footnote">Resolution records evidence and ownership. It does not change inventory quantities or imply misconduct.</p></aside></div>}
  </div>;
}

function MovementsPage({ dataMode, query, rows, integrity }: { dataMode: DataMode; query: string; rows: MovementView[]; integrity: IntegrityResult | null }) {
  const filtered = rows.filter((row) => !query || `${row.id} ${row.sku} ${row.action} ${row.path} ${row.actor}`.toLowerCase().includes(query.toLowerCase()));
  const synthetic = dataMode === 'demo' || dataMode === 'connected-synthetic';
  return <div className="page-content"><SectionHeading eyebrow="EVENT-SOURCED TRANSACTION STATE" title="Movement ledger" detail="Every inventory-changing event has a stable event ID, actor, timestamp, source/destination and document lineage. Corrections append new events instead of editing history." action={<Button icon={ShieldCheck} onClick={() => window.open(`${API_BASE}/docs`, '_blank', 'noopener,noreferrer')}>API reference</Button>} />
    <div className="integrity-strip"><div className="integrity-strip__icon"><ShieldCheck size={20} /></div><div><strong>Append-only event stream</strong><span>{integrity ? `SHA-256 chain verification ${integrity.valid ? 'passed' : 'failed'} across ${integrity.checked_events} events.` : 'Chain verification has not run for this session.'} Corrections use compensating events.</span></div><Tag tone={integrity ? (integrity.valid ? 'success' : 'critical') : 'neutral'}>{integrity ? (integrity.valid ? 'Verified' : 'Verification failed') : 'Not verified'}</Tag></div>
    {filtered.length === 0 ? <EmptyState title="No events in this view" detail={rows.length === 0 ? 'The connected event stream is empty. Post a receipt, issue, return, transfer or adjustment through the API. A valid event path is retained for replay and audit.' : 'No events match the current search. Clear the search to see the full ledger.'} /> : <div className="table-shell"><div className="table-toolbar"><div><strong>Append-only events</strong><span>{rows.length} records loaded · stable order by append time</span></div><div className="table-toolbar__controls">{synthetic && <Tag tone="warning">SYNTHETIC_DEMO</Tag>}<Button icon={DownloadSimple} onClick={() => exportCsv(synthetic ? 'movement-ledger-synthetic.csv' : 'movement-ledger.csv', ['event_id','action','sku','quantity','path','actor','time','state','source_class'], filtered.map((r) => [r.id,r.action,r.sku,r.qty,r.path,r.actor,r.time,r.state,r.source]))}>Export CSV</Button></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>EVENT ID</th><th>EVENT</th><th>SKU</th><th>QTY</th><th>EVENT PATH</th><th>ACTOR</th><th>TIME</th><th>RECORDED STATE</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td className="mono">{row.id}</td><td><strong>{row.action}</strong></td><td className="mono">{row.sku}</td><td>{row.qty}</td><td>{row.path}</td><td>{row.actor}</td><td className="mono">{row.time}</td><td><Tag tone={statusTone(row.state)}>{row.state}</Tag><small className="source-mini">{row.source}</small></td></tr>)}</tbody></table></div><div className="table-footer"><span>Events are immutable once written. Corrections append a new event.</span><span>{synthetic ? 'Synthetic preview records' : 'Connected database records'}</span></div></div>}
  </div>;
}

function VisionPage({ dataMode, onNavigate, onToast, parts }: { dataMode: DataMode; onNavigate: (page: string) => void; onToast: (toast: Toast) => void; parts: InventoryPart[] }) {
  return <div className="page-content"><SectionHeading eyebrow="PHYSICAL OBSERVATION / COMPUTER VISION" title="Vision observations" detail="Fuse OCR, barcode decoding, object/part candidates, count posteriors and occupancy evidence. Vision supplies evidence to the physical-state filter. It never decides whether to reorder." action={<Button variant="primary" icon={ClipboardText} onClick={() => onNavigate('Inspection plan')}>Plan a physical audit</Button>} />
    <VisionWorkbench parts={parts} onSaved={(message) => onToast({ title: 'Observation recorded', detail: message })} />
    <div className="integration-note"><div className="integration-note__icon"><ShieldCheck size={18} /></div><div><strong>Evidence contract and review gate</strong><p>Persist candidate identifiers, normalized count distribution, occupancy, model version, capture time, source class and a durable evidence URI. Original images must be stored in access-controlled object storage. Save an observation only after provider output is reviewed; the physical-state filter updates separately and purchase actions always require approval.</p></div></div>
    {dataMode === 'connected-empty' && <p className="inline-notice">No inventory baseline is loaded. Image preview remains available, but a production observation must reference valid part/bin identifiers and an approved provider.</p>}
  </div>;
}

function ForecastPage({ dataMode, onNavigate }: { dataMode: DataMode; onNavigate: (page: string) => void }) {
  const [model, setModel] = useState('Decision loss');
  const synthetic = dataMode === 'demo' || dataMode === 'connected-synthetic';
  return <div className="page-content"><SectionHeading eyebrow="PROBABILISTIC PLANNING" title="Demand & lead time" detail="Intermittent demand is occurrence × size. Model selection uses rolling-origin decision loss; supplier lead times remain empirical until diagnostics justify a distributional approximation." action={<Button variant="primary" icon={Pulse} onClick={() => onNavigate('Evaluation')}>Model evaluation</Button>} />
    <div className="forecast-summary"><div><span>Selected model family</span><strong>{synthetic ? 'Croston / TSB baseline' : 'Not evaluated'}</strong><small>{synthetic ? 'synthetic sample only' : 'no forecast experiment recorded'}</small></div><div><span>Forecast validation</span><strong>{synthetic ? 'Time-ordered sample' : 'Awaiting history'}</strong><small>no random shuffle</small></div><div><span>Lead-time method</span><strong>Empirical quantile</strong><small>requires supplier + part + route history</small></div><div><span>Service policy</span><strong>Criticality-linked</strong><small>requires calibrated policy inputs</small></div></div>
    <div className="overview-grid forecast-grid"><section className="panel">          <div className="panel-heading"><div><p className="eyebrow">DEMAND TRACKING</p><h2>Actual issue history vs forecast</h2><p>{synthetic ? 'Illustrative weekly totals, not a Raam forecast' : 'No recorded forecast experiment in this database'}</p></div><label className="simple-select"><select value={model} onChange={(e) => setModel(e.target.value)}><option>Decision loss</option><option>MAE</option><option>RMSE</option><option>Pinball loss</option></select><CaretDown size={14} /></label></div>{!synthetic ? <EmptyState title="Forecast experiment not recorded" detail="Import time-stamped demand with stockout context, then run a time-ordered rolling-origin forecast through the API. This page will not plot a synthetic series as if it were connected operating history." /> : <div className="chart-box chart-box--large">
<ResponsiveContainer width="100%" height="100%"><BarChart data={forecastData} margin={{ top: 8, right: 6, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#E9E5E1" strokeDasharray="3 4"/><XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: '#88817E', fontSize: 11 }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#88817E', fontSize: 11 }}/><Tooltip contentStyle={{ borderRadius: 8, borderColor: '#e7e2de', boxShadow: 'none', fontSize: 12 }}/><Bar dataKey="actual" name="Actual demand" fill="#4B191F" radius={[3,3,0,0]} maxBarSize={18}/><Bar dataKey="forecast" name={model} fill="#B21E2B" radius={[3,3,0,0]} maxBarSize={18}/></BarChart></ResponsiveContainer></div>}<div className="metrics-foot"><span>Metrics: RMSE · MAE · MASE · pinball loss · cost loss</span><Tag tone="neutral">No MAPE primary</Tag></div></section>
      <section className="panel method-panel"><div className="panel-heading"><div><p className="eyebrow">MODEL GOVERNANCE</p><h2>Method selection</h2><p>Choose by decision consequences</p></div></div><div className="method-row"><div><strong>Croston / SBA</strong><span>Sparse occurrence with smoothed interval</span></div><Tag tone="neutral">Baseline</Tag></div><div className="method-row"><div><strong>TSB</strong><span>Separate occurrence probability and size</span></div><Tag tone="neutral">Baseline</Tag></div><div className="method-row"><div><strong>Negative binomial</strong><span>Occurrence and over-dispersed positive size</span></div><Tag tone="neutral">Candidate</Tag></div><div className="method-row"><div><strong>GBM / stacked ensemble</strong><span>Only admitted after rolling-origin evaluation</span></div><Tag tone="warning">Validate</Tag></div><div className="method-callout"><WarningCircle size={16}/><p>Stockout-censored demand must be represented explicitly. Zero recorded issues do not necessarily mean zero demand.</p></div></section></div>
    <section className="panel lead-time-panel"><div className="panel-heading"><div><p className="eyebrow">SUPPLIER RELIABILITY</p><h2>Empirical lead-time distribution</h2><p>Confirmed-to-received time, with tail-delay regimes retained</p></div><Button icon={ArrowRight} onClick={() => onNavigate('Replenishment')}>Use in policy</Button></div><div className="lead-time-layout"><div className="lead-time-stat"><span>Median lead time</span><strong>{synthetic ? '7.8 days' : '—'}</strong><small>{synthetic ? 'synthetic sample only' : 'no empirical lead-time history'}</small></div><div className="lead-time-stat"><span>90th percentile</span><strong>{synthetic ? '13 days' : '—'}</strong><small>{synthetic ? 'synthetic sample only' : 'awaiting recorded receipts'}</small></div><div className="lead-time-stat"><span>Sampling rule</span><strong>Supplier × part</strong><small>fallback only with explicit pooling</small></div><div className="lead-time-note"><strong>Keep the tail.</strong><p>Reorder thresholds use a quantile of empirical lead-time demand. Do not replace it with a normal distribution unless diagnostics support the approximation.</p></div></div></section>
  </div>;
}

function ReplenishmentPage({ dataMode, parts, onToast }: { dataMode: DataMode; parts: InventoryPart[]; onToast: (toast: Toast) => void }) {
  const [budget, setBudget] = useState('85000');
  const [capacity, setCapacity] = useState('42');
  const [riskWeight, setRiskWeight] = useState('0.25');
  const [approved, setApproved] = useState(false);
  const [ran, setRan] = useState(false);
  const recommended = dataMode === 'connected-empty' ? [] : parts.filter((p) => p.reorderQty > 0).sort((a, b) => b.value * b.reorderQty - a.value * a.reorderQty);
  const totalValue = recommended.reduce((sum, p) => sum + p.value * p.reorderQty, 0);
  return <div className="page-content"><SectionHeading eyebrow="CONSTRAINED INVENTORY POLICY" title="Replenishment workbench" detail="Recommendations are evaluated jointly against service targets, storage volume, remaining budget, transfer options and tail-cost risk. No purchase order is sent automatically." action={<Tag tone="warning">Approval required</Tag>} />
    <div className="optimizer-layout"><section className="panel optimizer-controls"><div className="panel-heading"><div><p className="eyebrow">CONTROL PARAMETERS</p><h2>Optimization run</h2><p>Set today's hard limits</p></div></div><div className="form-grid"><label className="field"><span>Budget remaining</span><div className="field-with-prefix"><b>₹</b><input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric"/><span>INR</span></div><small>Maximum combined procurement spend</small></label><label className="field"><span>Storage capacity remaining</span><div className="field-with-prefix"><input value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="decimal"/><span>m³</span></div><small>Net allocatable bin volume</small></label><label className="field field--wide"><span>Tail-risk weight <strong>{riskWeight}</strong></span><input type="range" min="0" max="1" step="0.05" value={riskWeight} onChange={(e) => setRiskWeight(e.target.value)} /><small>Higher values penalize high-cost tail scenarios via CVaR.</small></label></div><div className="optimizer-constraints"><div><CheckCircle size={16}/><span>Service-level chance constraints</span></div><div><CheckCircle size={16}/><span>Discrete storage capacity</span></div><div><CheckCircle size={16}/><span>Budget and supplier lead-time risk</span></div><div><CheckCircle size={16}/><span>Feasible fallback if learned policy fails</span></div></div><button className="button button--primary button--wide" onClick={() => { setRan(true); setApproved(false); onToast({ title: 'Synthetic candidate preview', detail: 'Illustrative quantities only. No purchase order was created and no optimizer run was persisted.' }); }}>Preview candidate plan <ArrowRight size={16}/></button>
<p className="form-footnote">For production, send source-backed inventory and lead-time scenarios to <code>POST /api/v1/control/run</code>.</p></section>
      <section className="panel optimizer-results"><div className="panel-heading"><div><p className="eyebrow">PROPOSED ACTIONS</p><h2>{ran ? 'Latest candidate plan' : 'Candidate plan preview'}</h2><p>{dataMode === 'demo' ? 'Synthetic planning exercise' : 'Waiting for source-backed inventory state'}</p></div><Tag tone={approved ? 'success' : 'warning'}>{approved ? 'Planner accepted' : 'Pending approval'}</Tag></div>
        {recommended.length === 0 ? <EmptyState title="No order candidates" detail="A policy run requires stock posteriors, empirical lead-time demand and calibrated costs. The connected database currently has no eligible planning set." /> : <><div className="result-summary"><div><span>Proposed spend</span><strong>{money(totalValue)}</strong><small>synthetic quantity × unit value</small></div><div><span>Budget remaining</span><strong>{money(Math.max(0, Number(budget || 0) - totalValue))}</strong><small>{Number(budget || 0) > 0 ? Math.max(0, (1 - totalValue / Number(budget || 1)) * 100).toFixed(1) : '0.0'}% of budget left</small></div></div><div className="candidate-list">{recommended.slice(0, 5).map((part) => <div className="candidate-row" key={part.sku}><div className="candidate-row__part"><div className="candidate-glyph"><Package size={17}/></div><div><strong>{part.name}</strong><span>{part.sku} · {part.leadDays}d lead time</span></div></div><div className="candidate-qty"><strong>{part.reorderQty} units</strong><span>{money(part.value * part.reorderQty)}</span></div><Tag tone={part.criticality === 'Critical' ? 'critical' : 'neutral'}>{part.criticality}</Tag></div>)}</div><div className="objective-box"><span>OBJECTIVE</span><strong>min E[holding + order + transfer + expedite + shortage] + λ · CVaR</strong><p>Candidate values are not optimizer output. Connect the empirical scenarios and run the backend reference policy before using any decision.</p></div><div className="approval-actions"><Button onClick={() => { setApproved(false); onToast({ title: 'Plan returned for revision', detail: 'No actions were posted to the ledger.' }); }}>Request revision</Button><Button variant="primary" icon={Check} onClick={() => { setApproved(true); onToast({ title: 'Preview acknowledged', detail: 'UI acknowledgement only. Production approval must be persisted with an authenticated actor.' }); }}>Acknowledge preview</Button></div></>}
      </section></div>
  </div>;
}

function InspectionPage({ dataMode, onToast }: { dataMode: DataMode; onToast: (toast: Toast) => void }) {
  const [minutes, setMinutes] = useState('120');
  const [selected, setSelected] = useState(['DEMO-SEN-103', 'DEMO-BRK-014']);
  const synthetic = dataMode === 'demo' || dataMode === 'connected-synthetic';
  const tasks = !synthetic ? [] : [
    { sku: 'DEMO-SEN-103', name: 'Crankshaft position sensor', bin: 'C-03-03', benefit: 8400, cost: 380, duration: 12, reason: 'High posterior variance + criticality' },
    { sku: 'DEMO-BRK-014', name: 'Front brake pad kit', bin: 'B-02-14', benefit: 5100, cost: 340, duration: 10, reason: 'Potential shortage exposure' },
    { sku: 'DEMO-SUS-032', name: 'Stabilizer link', bin: 'A-03-09', benefit: 2400, cost: 260, duration: 8, reason: 'Repeated location variance' },
    { sku: 'DEMO-CLP-061', name: 'Retainer clip set', bin: 'A-02-11', benefit: 620, cost: 180, duration: 6, reason: 'Low-value, high uncertainty' },
  ];
  const totalMinutes = tasks.filter((t) => selected.includes(t.sku)).reduce((sum, t) => sum + t.duration, 0);
  const netValue = tasks.filter((t) => selected.includes(t.sku)).reduce((sum, t) => sum + t.benefit - t.cost, 0);
  return <div className="page-content"><SectionHeading eyebrow="VALUE OF INFORMATION" title="Inspection plan" detail="Inspection consumes technician time, travel and attention. Select the set that maximizes expected cost reduction net of inspection cost under a time budget." action={<Tag tone="neutral">0/1 knapsack policy</Tag>} />
    <div className="inspection-layout"><section className="panel inspection-controls"><div className="panel-heading"><div><p className="eyebrow">AUDIT BUDGET</p><h2>Technician availability</h2><p>One shift · single route</p></div><ClipboardText size={19}/></div><label className="field"><span>Available time</span><div className="field-with-prefix"><input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric"/><span>minutes</span></div></label><div className="audit-budget"><div className="audit-budget__label"><span>Selected time</span><strong>{totalMinutes} / {Math.max(0, Number(minutes) || 0)} min</strong></div><div className="audit-budget__track"><span style={{ width: `${Math.min(100, totalMinutes / Math.max(1, Number(minutes) || 1) * 100)}%` }} /></div><p>{totalMinutes > Number(minutes) ? 'Selected tasks exceed the time budget. Remove a task.' : 'Time budget remains feasible.'}</p></div><div className="audit-value"><span>Expected net value</span><strong>{money(netValue)}</strong><small>illustrative inputs only</small></div><Button variant="primary" icon={ClipboardText} disabled={totalMinutes > Number(minutes)} onClick={() => onToast({ title: 'Audit plan prepared', detail: 'Save and assign the proposed plan in the connected workflow before sending a technician.' })}>Prepare inspection plan</Button></section>
      <section className="panel audit-list-panel"><div className="panel-heading"><div><p className="eyebrow">ELIGIBLE AUDITS</p><h2>Prioritized inspection candidates</h2><p>Net expected benefit and time cost are both considered</p></div><Button icon={FunnelSimple} onClick={() => setSelected([])}>Clear selection</Button></div>{tasks.length === 0 ? <EmptyState title="No audit candidates" detail="Candidates appear from posterior uncertainty, expected exposure and measured inspection cost." /> : <div className="audit-candidate-list">{tasks.map((task) => <label className={`audit-candidate ${selected.includes(task.sku) ? 'audit-candidate--selected' : ''}`} key={task.sku}><input type="checkbox" checked={selected.includes(task.sku)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, task.sku] : old.filter((x) => x !== task.sku))}/><span className="audit-checkbox"><Check size={13}/></span><span className="audit-candidate__copy"><strong>{task.name}</strong><span>{task.sku} · {task.bin}</span><small>{task.reason}</small></span><span className="audit-candidate__value"><strong>{money(task.benefit - task.cost)}</strong><span>net expected value</span><small>{task.duration} min</small></span></label>)}</div>}</section></div>
    <div className="bottom-note"><WarningCircle size={16}/><span>Value-of-inspection inputs must be calibrated against historical audits and service consequences. A low confidence score alone is not sufficient to justify a costly inspection.</span></div>
  </div>;
}

function SpatialPage({ dataMode, onNavigate, onOpenPart, parts }: { dataMode: DataMode; onNavigate: (page: string) => void; onOpenPart: (part: InventoryPart) => void; parts: InventoryPart[] }) {
  const spatialParts = dataMode === 'connected-empty' ? [] : parts;
  return <div className="page-content"><SectionHeading eyebrow="PHYSICAL SPACE MODEL / DIGITAL TWIN" title="Spatial inventory twin" detail="Explore the facility in three dimensions. Each populated bin is bound to its displayed part record, inventory discrepancy, vision confidence and provenance, rather than being an animation-only warehouse." action={<Button icon={MapPin} onClick={() => onNavigate('Inventory')}>Open part register</Button>} />
    <div className="spatial-twin-summary"><div><span>Rendered facility objects</span><strong>{spatialParts.length} part-linked bins</strong><small>{dataMode === 'connected-empty' ? 'No stock baseline loaded' : 'Mapped from current inventory view'}</small></div><div><span>Control dimensions</span><strong>State · variance · confidence</strong><small>Switch overlays inside the scene</small></div><div><span>Interaction</span><strong>Orbit · zoom · inspect</strong><small>Mouse, trackpad and touch controls</small></div></div>
    <section className="panel spatial-canvas spatial-canvas--twin"><div className="panel-heading"><div><p className="eyebrow">SERVICE CENTRE · ZONE A–C</p><h2>Interactive facility model</h2><p>Three.js scene with state-bound bins and selectable risk overlays</p></div><Tag tone={dataMode === 'connected-empty' ? 'warning' : 'success'}>{dataMode === 'connected-empty' ? 'Baseline required' : 'Interactive 3D'}</Tag></div>
      <WarehouseTwin parts={spatialParts} dataMode={dataMode} onOpenPart={onOpenPart} />
    </section>
    <div className="spatial-footnote"><ShieldCheck size={17} /><p><strong>Digital-twin integrity rule.</strong> The current starter places records into a schematic coordinate grid because surveyed facility coordinates are not in the source data. Production must map each object to `(part, bin, location, timestamp)` from persisted spatial coordinates and re-render only from the same event-sourced state used by the ledger and optimizer.</p></div>
  </div>;
}

function ScenariosPage({ dataMode, onToast }: { dataMode: DataMode; onToast: (toast: Toast) => void }) {
  const [demand, setDemand] = useState(1.25); const [lead, setLead] = useState(1.4); const [name, setName] = useState('Supplier tail-delay');
  return <div className="page-content"><SectionHeading eyebrow="COUNTERFACTUAL ANALYSIS" title="Scenario lab" detail="Resample historical demand and lead-time trajectories to compare inventory policies on the same sampled paths. No fixed percentage multiplier should be presented as evidence of savings." action={<Tag tone="neutral">Same-path comparison</Tag>} />
    <div className="scenario-layout"><section className="panel scenario-controls"><div className="panel-heading"><div><p className="eyebrow">STRESS PARAMETERS</p><h2>Define a counterfactual</h2><p>Illustrative sensitivity controls</p></div><SlidersHorizontal size={18}/></div><label className="field"><span>Scenario name</span><input className="text-input" value={name} onChange={(e) => setName(e.target.value)} /></label><div className="slider-field"><div><span>Demand pressure</span><strong>{demand.toFixed(2)}×</strong></div><input type="range" min="0.5" max="3" step="0.05" value={demand} onChange={(e) => setDemand(Number(e.target.value))}/><div className="slider-labels"><span>Lower demand</span><span>Higher demand</span></div></div><div className="slider-field"><div><span>Lead-time stress</span><strong>{lead.toFixed(2)}×</strong></div><input type="range" min="0.5" max="3" step="0.05" value={lead} onChange={(e) => setLead(Number(e.target.value))}/><div className="slider-labels"><span>Normal regime</span><span>Tail-delay regime</span></div></div><Button variant="primary" icon={Pulse} onClick={() => onToast({ title: 'Scenario definition captured', detail: 'The backend will withhold cost deltas until empirical trajectories are connected.' })}>Prepare scenario</Button><p className="form-footnote">Backend route: <code>POST /api/v1/scenarios/run</code>. Results are intentionally withheld without observed trajectories.</p></section>
      <section className="panel scenario-results"><div className="panel-heading"><div><p className="eyebrow">POLICY COMPARISON</p><h2>Result gate</h2><p>Only report measurable economic outcomes</p></div></div><div className="scenario-gate"><div className="scenario-gate__icon"><Database size={22}/></div><strong>{dataMode === 'connected-empty' ? 'Observed data required' : 'No simulation result generated yet'}</strong><p>To calculate cost, service, shortage and expedite deltas, connect demand observations, supplier lead-time regimes, costs, physical-stock uncertainty and baseline policy outputs.</p><div className="scenario-requirements"><span><CheckCircle size={15}/> Historical demand trajectories</span><span><CheckCircle size={15}/> Empirical supplier lead times</span><span><CheckCircle size={15}/> Cost and criticality inputs</span><span><CheckCircle size={15}/> Baseline and proposed policy</span></div></div><div className="scenario-parameters"><span>Current request</span><strong>{name || 'Untitled scenario'}</strong><div><span>Demand pressure</span><b>{demand.toFixed(2)}×</b><span>Lead-time stress</span><b>{lead.toFixed(2)}×</b></div></div></section></div>
  </div>;
}

function EvaluationPage({ dataMode }: { dataMode: DataMode }) {
  const metrics = [
    { label: 'Demand forecast', items: ['MAE', 'RMSE', 'MASE', 'Pinball loss', 'Interval coverage'] },
    { label: 'Inventory integrity', items: ['Unit IRI', 'Value IRI', 'Audit precision', 'Audit recall'] },
    { label: 'Policy performance', items: ['Total cost delta', 'Service delta', 'Shortage delta', 'Expedite delta'] },
  ];
  return <div className="page-content"><SectionHeading eyebrow="MEASUREMENT + EXTERNAL VALIDITY" title="Evaluation & evidence" detail="Establish an observed baseline first. Every figure is labeled by provenance, and a result on another automotive or cross-industry dataset is never promoted to a Raam result." action={<Tag tone="warning">Baseline required</Tag>} />
    <div className="evaluation-banner"><div className="evaluation-banner__mark"><ChartBar size={22}/></div><div><strong>{dataMode === 'connected-empty' ? 'No operational baseline exists in this database' : 'This preview contains no Raam KPI claims'}</strong><p>Reference research values are evidence for architecture, not measured performance from this implementation. All synthetic preview metrics are explicitly labeled.</p></div></div>
    <div className="evaluation-cards">{metrics.map((group) => <section className="panel evaluation-card" key={group.label}><p className="eyebrow">MEASUREMENT GROUP</p><h2>{group.label}</h2><div className="evaluation-items">{group.items.map((item) => <div key={item}><span>{item}</span><span className="metric-pending">{dataMode === 'connected-empty' ? 'No data' : 'Not evaluated'} <ArrowRight size={13}/></span></div>)}</div></section>)}</div>
    <section className="panel source-register"><div className="panel-heading"><div><p className="eyebrow">PROVENANCE CONTRACT</p><h2>Required source classes</h2><p>Keep external evidence separate from connected records</p></div></div><div className="source-class-list"><div><Tag tone="success">RAAM_OBSERVED</Tag><p>Measured from connected operational records. Used for business reporting once completeness and lineage checks pass.</p></div><div><Tag tone="neutral">AUTOMOTIVE_PUBLISHED</Tag><p>Peer-reviewed automotive dataset or industrial case. Context for model design, not RAAM performance.</p></div><div><Tag tone="neutral">CROSS_INDUSTRY_PUBLISHED</Tag><p>External non-automotive evidence. Use for structural arguments and explicitly label transfer limitations.</p></div><div><Tag tone="warning">SYNTHETIC_DEMO</Tag><p>Local interface training only. Must never be mixed into model fitting or reported as an operating metric.</p></div></div></section>
  </div>;
}

function SettingsPage({ dataMode, connected, onRefresh, onToast }: { dataMode: DataMode; connected: boolean; onRefresh: () => void; onToast: (toast: Toast) => void }) {
  return <div className="page-content"><SectionHeading eyebrow="SYSTEM CONFIGURATION" title="Settings & integrations" detail="Configure source connectivity, data provenance, approval boundaries and model versions before enabling production decisions." action={<Button icon={ArrowCounterClockwise} onClick={onRefresh}>Refresh connection</Button>} />
    <div className="settings-grid"><section className="panel settings-section"><div className="panel-heading"><div><p className="eyebrow">DATA INTERFACE</p><h2>Backend connection</h2><p>FastAPI · PostgreSQL / SQLite dev</p></div><Tag tone={connected ? 'success' : 'warning'}>{connected ? 'Connected' : 'Offline'}</Tag></div><div className="settings-row"><div><strong>API base URL</strong><span>Configured through VITE_API_BASE_URL</span></div><code>http://localhost:8000</code></div><div className="settings-row"><div><strong>Data mode</strong><span>Source labels retained per entity</span></div><Tag tone={dataMode === 'demo' ? 'warning' : 'neutral'}>{dataMode === 'demo' ? 'Preview fallback' : 'Database'}</Tag></div><div className="settings-row"><div><strong>Schema migrations</strong><span>Prototype bootstraps tables on startup; production should use Alembic.</span></div><Tag tone="warning">Setup required</Tag></div><Button variant="primary" icon={Database} onClick={() => onToast({ title: 'Integration checklist opened', detail: 'Configure credentials, approved source mappings and a migration workflow before production use.' })}>Review integration checklist</Button></section>
      <section className="panel settings-section"><div className="panel-heading"><div><p className="eyebrow">CONTROL GOVERNANCE</p><h2>Decision guardrails</h2><p>Human authority remains explicit</p></div><ShieldCheck size={19}/></div><div className="settings-row"><div><strong>Automatic purchase order creation</strong><span>Controller output is always a proposal by default.</span></div><Tag tone="success">Disabled</Tag></div><div className="settings-row"><div><strong>Human override trail</strong><span>Original action, revised action, reason, actor and timestamp.</span></div><Tag tone="success">Required</Tag></div><div className="settings-row"><div><strong>Anomaly interpretation</strong><span>Missing event paths create a reconciliation case, not an intent label.</span></div><Tag tone="success">Enforced in UI</Tag></div><div className="settings-row"><div><strong>Model fallback</strong><span>Infeasible learned action falls back to a feasible reference policy.</span></div><Tag tone="warning">Backend integration</Tag></div></section></div>
    <div className="bottom-note"><WarningCircle size={16}/><span>Before production: implement authentication, role-based permissions, signed approvals, secrets management, Alembic migrations, image-access controls, retention policy, backups, monitoring and integration contract tests.</span></div>
  </div>;
}

function GenericPage({ active, dataMode, onNavigate }: { active: string; dataMode: DataMode; onNavigate: (page: string) => void }) {
  const config: Record<string, { icon: IconComponent; eyebrow: string; title: string; detail: string; section: string }> = {
    'Vision observations': { icon: Scan, eyebrow: 'PHYSICAL OBSERVATION', title: 'Vision observations', detail: 'Manage image, barcode, OCR and physical-audit evidence.', section: 'SENSING' },
  };
  const current = config[active];
  if (current) { const Icon = current.icon; return <div className="page-content"><SectionHeading eyebrow={current.eyebrow} title={current.title} detail={current.detail} action={<Button variant="primary" icon={Icon} onClick={() => onNavigate('Inventory')}>Review inventory</Button>} /><EmptyState title={dataMode === 'connected-empty' ? 'No observations loaded' : 'Open the dedicated observation view'} detail="This section is implemented in the local prototype with explicit synthetic-data labels. Production images require controlled evidence storage and a separately evaluated vision model." /></div>; }
  return <div className="page-content"><SectionHeading eyebrow="RAAM CONTROL SYSTEM" title={active} detail="A state-aware inventory workflow connected to the event ledger, physical observation layer, demand models and constrained control policy." action={<Button icon={ArrowRight} onClick={() => onNavigate('Overview')}>Back to overview</Button>} /><div className="panel module-intro"><div className="module-intro__icon"><Wrench size={22}/></div><h2>{active} module</h2><p>This module is mapped in the project implementation plan and navigation. Its production behavior depends on imported operational records, calibrated models and the relevant approval workflow.</p><div className="module-actions"><Button variant="primary" onClick={() => onNavigate('Inventory')}>Open inventory</Button><Button onClick={() => onNavigate('Evaluation')}>Review evaluation contract</Button></div></div></div>;
}

function TransactionModal({ onClose, onSaved, parts, dataMode }: { onClose: () => void; onSaved: () => void; parts: InventoryPart[]; dataMode: DataMode }) {
  const [sku, setSku] = useState(parts[0]?.sku || ''); const [eventType, setEventType] = useState('ISSUE');
  const [quantity, setQuantity] = useState('1'); const [actor, setActor] = useState('Operations planner'); const [documentId, setDocumentId] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const save = async () => {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0) { setError('Enter a whole, non-negative quantity.'); return; }
    if (!actor.trim()) { setError('Actor is required for event lineage.'); return; }
    if (dataMode === 'demo') { setError('The local fallback uses synthetic records. Connect the backend and use a real part ID before posting a movement.'); return; }
    if (!Number.isInteger(Number(sku))) { setError('This part does not have a numeric backend ID. Import it into the connected database first.'); return; }
    setSaving(true); setError('');
    try { await postEvent({ part_id: Number(sku), event_type: eventType, quantity: qty, actor_id: actor.trim(), document_id: documentId || null, idempotency_key: crypto.randomUUID() }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not write event.'); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="modal-header"><div><p className="eyebrow">APPEND-ONLY EVENT</p><h2 id="transaction-title">Record inventory movement</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div><p className="modal-description">A movement creates a new event. Existing history is never overwritten.</p><div className="form-stack"><label className="field"><span>Part master ID</span><select value={sku} onChange={(e) => setSku(e.target.value)}>{parts.map((p, i) => <option key={p.sku} value={dataMode === 'demo' ? p.sku : (p as InventoryPart & { id?: number }).id || p.sku}>{p.sku} · {p.name}</option>)}</select><small>Use a backend numeric part ID when connected.</small></label><label className="field"><span>Event type</span><select value={eventType} onChange={(e) => setEventType(e.target.value)}>{['RECEIPT','ISSUE','RETURN','TRANSFER_IN','TRANSFER_OUT','SCRAP','ADJUSTMENT_IN','ADJUSTMENT_OUT','VENDOR_RETURN'].map((x) => <option key={x}>{x}</option>)}</select></label><label className="field"><span>Quantity</span><input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" /></label><label className="field"><span>Actor / user ID</span><input value={actor} onChange={(e) => setActor(e.target.value)} /></label><label className="field"><span>Document / job reference</span><input value={documentId} onChange={(e) => setDocumentId(e.target.value)} placeholder="e.g. JOB-4820 or GRN-0192" /></label></div>{error && <div className="form-error"><WarningCircle size={16}/>{error}</div>}<div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={saving ? CircleNotch : Check} disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Append event'}</Button></div></section></div>;
}

function PartDrawer({ part, onClose, onNavigate }: { part: InventoryPart; onClose: () => void; onNavigate: (page: string) => void }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="detail-drawer" onClick={(e) => e.stopPropagation()}><button className="drawer-close" onClick={onClose} aria-label="Close details"><X size={18}/></button><p className="eyebrow">PART STATE</p><h2>{part.name}</h2><p className="drawer-intro mono">{part.sku}</p><Tag tone={statusTone(part.status)}>{part.status}</Tag><div className="detail-metrics"><div><span>Ledger quantity</span><strong>{part.ledger}</strong></div><div><span>Physical posterior</span><strong>{Number.isFinite(part.physical) ? part.physical.toFixed(1) : '—'}</strong></div><div><span>Confidence</span><strong>{Math.round(part.confidence * 100)}%</strong></div><div><span>Unit value</span><strong>{money(part.value)}</strong></div></div><div className="detail-block"><span>Part context</span><div className="detail-line"><small>Vehicle family</small><strong>{part.family}</strong></div><div className="detail-line"><small>Storage bin</small><strong>{part.bin}</strong></div><div className="detail-line"><small>Supplier</small><strong>{part.supplier}</strong></div><div className="detail-line"><small>Demand class</small><strong>{part.demandClass}</strong></div></div><div className="detail-block"><span>Control note</span><p>{!Number.isFinite(part.ledger) || !Number.isFinite(part.physical) ? 'Baseline required. Import a dated ledger snapshot and physical observation before comparing stock or making a replenishment decision.' : Math.abs(part.ledger - part.physical) >= 1 ? 'Recorded stock differs from the physical posterior. Keep uncertainty visible and route the part through reconciliation before committing a purchase action.' : 'Ledger and physical estimates currently align within this sample. Continue confidence monitoring.'}</p></div><Button variant="primary" icon={GitBranch} onClick={() => { onClose(); onNavigate('Reconciliation'); }}>Open reconciliation</Button><p className="drawer-footnote">Source classification: {part.source}. Preview records are not operational evidence.</p></aside></div>;
}

function exportCsv(filename: string, headers: string[], rows: unknown[][]) {
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export default function App() {
  const [active, setActive] = useState('Overview'); const [query, setQuery] = useState('');
  const [dataMode, setDataMode] = useState<DataMode>('demo'); const [connected, setConnected] = useState(false);
  const [apiOverview, setApiOverview] = useState<Overview | null>(null); const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<Toast>(null); const [selectedPart, setSelectedPart] = useState<InventoryPart | null>(null);
  const [parts, setParts] = useState<InventoryPart[]>(demoParts);
  const [cases, setCases] = useState<ReconciliationCaseRecord[]>([]);
  const [events, setEvents] = useState<LedgerEventRecord[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const notify = (next: Toast) => { setToast(next); window.setTimeout(() => setToast(null), 3800); };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const [health, overview, caseResponse, eventResponse, integrityResponse] = await Promise.all([
        getHealth(), getOverview(), getReconciliationCases('All'), getEvents(200), getLedgerIntegrity(),
      ]);
      setConnected(health.status === 'ok'); setApiOverview(overview);
      setCases(caseResponse.items ?? []); setEvents(eventResponse.items ?? []); setIntegrity(integrityResponse);
      setLastRefreshed(new Date());
      if ((overview.parts || 0) === 0) { setDataMode('connected-empty'); setParts([]); }
      else {
        const [partsResponse, stateResponse] = await Promise.all([fetch(`${API_BASE}/api/v1/parts`), fetch(`${API_BASE}/api/v1/inventory/state`)]);
        const body = await partsResponse.json(); const stateBody = await stateResponse.json();
        const stateBySku = new Map<string, Record<string, unknown>>((stateBody.items || []).map((item: Record<string, unknown>) => [String(item.sku), item]));
        const mapped: InventoryPart[] = (body.items || []).map((p: Record<string, unknown>) => {
          const state = stateBySku.get(String(p.sku)) || {};
          const ledgerAvailable = state.ledger_quantity !== null && state.ledger_quantity !== undefined && Number.isFinite(Number(state.ledger_quantity));
          const physicalAvailable = state.physical_mean !== null && state.physical_mean !== undefined && Number.isFinite(Number(state.physical_mean));
          return { partId: Number(p.id), sku: String(p.sku), name: String(p.name), family: String(p.vehicle_family || 'Not specified'), bin: String(state.bin_code || 'Not assigned'),
          ledger: ledgerAvailable ? Number(state.ledger_quantity) : Number.NaN, physical: physicalAvailable ? Number(state.physical_mean) : Number.NaN, confidence: state.confidence != null && Number.isFinite(Number(state.confidence)) ? Number(state.confidence) : 0, value: Number(p.unit_cost || 0),
          criticality: Number(p.criticality || 0) >= 0.8 ? 'Critical' : Number(p.criticality || 0) >= 0.55 ? 'High' : 'Standard',
          status: !ledgerAvailable ? 'Baseline required' : !physicalAvailable ? 'Physical baseline required' : Math.abs(Number(state.ledger_quantity) - Number(state.physical_mean)) >= 2 ? 'Reconcile' : 'Healthy', demandClass: 'Not evaluated', supplier: 'Not specified', leadDays: 0, reorderQty: 0,
          source: String(state.source_class || p.source_class || 'RAAM_OBSERVED') };
        });
        setParts(mapped);
        const syntheticOnly = mapped.length > 0 && mapped.every((part) => part.source === 'SYNTHETIC_DEMO');
        setDataMode(mapped.length ? (syntheticOnly ? 'connected-synthetic' : 'connected') : 'connected-empty');
      }
    } catch {
      setConnected(false); setApiOverview(null); setDataMode('demo'); setParts(demoParts);
      setCases([]); setEvents([]); setIntegrity(null); setLastRefreshed(null);
    } finally { setRefreshing(false); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { const handle = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.querySelector<HTMLInputElement>('.global-search input')?.focus(); } if (e.key === 'Escape') { setSelectedPart(null); } }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, []);

  const caseViews = useMemo<ExceptionView[]>(() => {
    if (dataMode === 'demo') {
      return exceptionRows.map((row) => ({
        id: row.id, partId: null, sku: row.sku, name: row.name, reason: row.reason,
        likelihood: row.likelihood, exposure: row.exposure, owner: row.owner,
        priority: row.priority as ExceptionView['priority'], status: 'OPEN',
      }));
    }
    return cases.map((record) => {
      const part = parts.find((candidate) => candidate.partId === record.part_id);
      const deviation = record.case_type.replaceAll('_', ' ').toLowerCase();
      return {
        id: record.case_id, partId: record.part_id,
        sku: part?.sku || (record.part_id != null ? `PART-${record.part_id}` : 'UNLINKED-PART'),
        name: part?.name || 'Unlinked part record',
        reason: record.expected_quantity != null && record.observed_quantity != null
          ? `${deviation} · expected ${record.expected_quantity}, observed ${record.observed_quantity}`
          : deviation,
        likelihood: record.posterior_unresolved_probability, exposure: record.economic_exposure,
        owner: record.assigned_to || 'Unassigned', priority: priorityFor(record.economic_exposure, record.priority_score),
        status: record.status, record,
      };
    });
  }, [cases, dataMode, parts]);

  const movementViews = useMemo<MovementView[]>(() => {
    if (dataMode === 'demo') {
      return movementRows.map((row) => ({ ...row, source: 'SYNTHETIC_DEMO' }));
    }
    return events.map((event) => {
      const part = parts.find((candidate) => candidate.partId === event.part_id);
      const path = event.source_location && event.destination_location
        ? `${event.source_location} → ${event.destination_location}`
        : event.source_location ? `${event.source_location} → ${event.job_id ? `JOB ${event.job_id}` : 'external'}`
          : event.destination_location ? `${event.job_id ? `JOB ${event.job_id}` : 'external'} → ${event.destination_location}`
            : event.job_id ? `JOB ${event.job_id}` : 'No location path';
      return {
        id: event.event_id,
        action: actionFor(event.event_type),
        sku: part?.sku || `PART-${event.part_id}`,
        qty: quantityFor(event.event_type, event.quantity),
        path, actor: event.actor_id,
        time: new Date(event.occurred_at).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        state: event.corrects_event_id ? 'Correction' : 'Recorded',
        source: event.source_class,
      };
    });
  }, [dataMode, events, parts]);

  const openCaseCount = caseViews.filter((row) => row.status !== 'RESOLVED').length;
  const isSyntheticMode = dataMode === 'demo' || dataMode === 'connected-synthetic';
  const openPart = (part: InventoryPart) => setSelectedPart(part);
  let content: ReactNode;
  switch (active) {
    case 'Overview': content = <Dashboard onNavigate={setActive} query={query} parts={parts} dataMode={dataMode} apiOverview={apiOverview} cases={caseViews} events={movementViews} lastRefreshed={lastRefreshed} ledgerIntegrity={integrity} />; break;
    case 'Inventory': content = <InventoryPage parts={parts} query={query} dataMode={dataMode} onOpen={openPart} onNavigate={setActive} />; break;
    case 'Reconciliation': content = <ReconciliationPage dataMode={dataMode} cases={caseViews} onNavigate={setActive} onToast={notify} onRefresh={refresh} />; break;
    case 'Movement ledger': content = <MovementsPage dataMode={dataMode} query={query} rows={movementViews} integrity={integrity} />; break;
    case 'Vision observations': content = <VisionPage dataMode={dataMode} onNavigate={setActive} onToast={notify} parts={parts} />; break;
    case 'Demand & lead time': content = <ForecastPage dataMode={dataMode} onNavigate={setActive} />; break;
    case 'Replenishment': content = <ReplenishmentPage dataMode={dataMode} parts={parts} onToast={notify} />; break;
    case 'Inspection plan': content = <InspectionPage dataMode={dataMode} onToast={notify} />; break;
    case 'Spatial twin': content = <SpatialPage dataMode={dataMode} onNavigate={setActive} onOpenPart={openPart} parts={parts} />; break;
    case 'Scenarios': content = <ScenariosPage dataMode={dataMode} onToast={notify} />; break;
    case 'Evaluation': content = <EvaluationPage dataMode={dataMode} />; break;
    case 'Settings': content = <SettingsPage dataMode={dataMode} connected={connected} onRefresh={() => void refresh()} onToast={notify} />; break;
    default: content = <GenericPage active={active} dataMode={dataMode} onNavigate={setActive} />;
  }

  return <div className="app-shell">
    <Sidebar active={active} onNavigate={setActive} reconciliationCount={openCaseCount} />
    <div className="main-shell"><Header active={active} onSearch={setQuery} query={query} connected={connected} onRefresh={() => void refresh()} refreshing={refreshing} onNotifications={() => setActive('Reconciliation')} />
      <main>
        {isSyntheticMode && <div className="global-provenance provenance-banner provenance-banner--demo"><div className="provenance-banner__icon"><WarningCircle size={18} /></div><div><strong>Training sandbox · synthetic records only</strong><p>Every quantity and KPI in this mode is illustrative. Nothing here is a Raam operational result; replace demo inputs with source-backed records before operational decisions.</p></div><Tag tone="warning">SYNTHETIC_DEMO</Tag></div>}
        {content}<footer className="app-footer"><span>RAAM GROUP · INTEGRATED SPARE-PARTS CONTROL</span><span>Physical state <b>↔</b> event state <b>↔</b> forecast state <b>↔</b> policy state</span><span>Build 0.1 · Local prototype</span></footer></main>
    </div>
    {selectedPart && <PartDrawer part={selectedPart} onClose={() => setSelectedPart(null)} onNavigate={setActive} />}
    {toast && <div className={`toast toast--${toast.kind || 'success'}`} role="status"><div className="toast__icon">{toast.kind === 'error' ? <WarningCircle size={18}/> : <CheckCircle size={18}/>}</div><div><strong>{toast.title}</strong>{toast.detail && <span>{toast.detail}</span>}</div><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={16}/></button></div>}
  </div>;
}
