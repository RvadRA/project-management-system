import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { exportElementToPDF } from '../utils/exportPdf';
import { toast } from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GanttTask {
  id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_critical?: boolean;
  risk_level?: string;
  assigned_to_name?: string | null;
  workflow_status?: string | null;
  subtasks?: GanttTask[];
  wbsNumber?: string;
}

interface GanttBlock {
  id: number;
  name: string;
  domain?: string;
  tasks?: GanttTask[];
  children?: GanttBlock[];
  calendar_info?: { name: string } | null;
}

interface GanttChartProps {
  blocks: GanttBlock[];
  projectStartDate?: string | null;
  projectEndDate?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toMs(dateStr: string) {
  return new Date(dateStr).getTime();
}

function formatDate(ms: number, short = false): string {
  const d = new Date(ms);
  if (short) return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

interface FlatRow {
  type: 'block' | 'task';
  id: number;
  name: string;
  start: number | null;
  end: number | null;
  is_critical?: boolean;
  risk_level?: string;
  assigned?: string | null;
  workflow_status?: string | null;
  wbsNumber: string;
  indent: number;
}

function flattenBlocks(blocks: GanttBlock[], indent = 0, prefix = ''): FlatRow[] {
  const rows: FlatRow[] = [];

  blocks.forEach((block, bi) => {
    const blockNum = prefix ? `${prefix}.${bi + 1}` : `${bi + 1}`;
    rows.push({
      type: 'block',
      id: block.id,
      name: block.name,
      start: null,
      end: null,
      wbsNumber: blockNum,
      indent,
    });

    const flatTasks = (tasks: GanttTask[], tIndent: number, tPrefix: string) => {
      (tasks || []).filter(t => !('parent' in t && (t as any).parent)).forEach((task, ti) => {
        const tNum = `${tPrefix}.${ti + 1}`;
        rows.push({
          type: 'task',
          id: task.id,
          name: task.name,
          start: task.start_date ? toMs(task.start_date) : null,
          end: task.end_date ? toMs(task.end_date) + 86400000 : null, // include end day
          is_critical: task.is_critical,
          risk_level: task.risk_level,
          assigned: task.assigned_to_name,
          workflow_status: task.workflow_status,
          wbsNumber: tNum,
          indent: tIndent,
        });
        if (task.subtasks?.length) {
          flatTasks(task.subtasks, tIndent + 1, tNum);
        }
      });
    };

    flatTasks(block.tasks || [], indent + 1, blockNum);

    if (block.children?.length) {
      rows.push(...flattenBlocks(block.children, indent + 1, blockNum));
    }
  });

  return rows;
}

function generateTicks(start: number, end: number, zoom: number): number[] {
  const days = Math.round((end - start) / 86400000);
  const ticks: number[] = [];
  // Interval in days depending on zoom & total span
  const interval = zoom <= 1
    ? (days > 180 ? 30 : days > 60 ? 14 : 7)
    : (days > 60 ? 14 : days > 30 ? 7 : 3);

  for (let d = 0; d <= days; d += interval) {
    ticks.push(start + d * 86400000);
  }
  return ticks;
}

const ROW_H = 32;
const LABEL_W = 240;
const TODAY = Date.now();

// ─── Bar Color ────────────────────────────────────────────────────────────────

function barColor(row: FlatRow): string {
  if (row.is_critical) return '#ef4444';
  if (row.workflow_status === 'DONE') return '#10b981';
  if (row.workflow_status === 'IN_PROGRESS') return '#3b82f6';
  if (row.risk_level === 'HIGH') return '#f97316';
  if (row.risk_level === 'MEDIUM') return '#f59e0b';
  return '#8b5cf6';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GanttChart({ blocks, projectStartDate, projectEndDate }: GanttChartProps) {
  const [zoom, setZoom] = useState(1); // 0.5 = zoomed out, 2 = zoomed in
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => flattenBlocks(blocks), [blocks]);

  // Calculate timeline range
  const { rangeStart, rangeEnd } = useMemo(() => {
    const dates: number[] = [];
    if (projectStartDate) dates.push(toMs(projectStartDate));
    if (projectEndDate) dates.push(toMs(projectEndDate));
    rows.forEach(r => {
      if (r.start) dates.push(r.start);
      if (r.end) dates.push(r.end);
    });

    if (dates.length === 0) {
      const now = Date.now();
      return { rangeStart: now - 7 * 86400000, rangeEnd: now + 30 * 86400000 };
    }

    const pad = 7 * 86400000;
    return { rangeStart: Math.min(...dates) - pad, rangeEnd: Math.max(...dates) + pad };
  }, [rows, projectStartDate, projectEndDate]);

  const totalMs = rangeEnd - rangeStart;
  const totalDays = Math.round(totalMs / 86400000);
  const chartW = Math.max(800, totalDays * 18 * zoom);

  const ticks = useMemo(() => generateTicks(rangeStart, rangeEnd, zoom), [rangeStart, rangeEnd, zoom]);

  function toX(ms: number): number {
    return ((ms - rangeStart) / totalMs) * chartW;
  }

  const svgH = Math.max(200, rows.length * ROW_H + 40);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportElementToPDF('gantt-chart-container', 'gantt-chart');
      toast.success('Gantt экспортирован в PDF');
    } catch (err: any) {
      console.error('Gantt export error:', err);
      toast.error(`Ошибка при экспорте: ${err?.message || 'Неизвестная ошибка'}`);
    } finally {
      setExporting(false);
    }
  };

  if (blocks.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 text-sm">
        Нет данных для отображения диаграммы Ганта
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {formatDate(rangeStart)} — {formatDate(rangeEnd)}
          </span>
          {/* Legend */}
          <div className="flex items-center gap-3 ml-4">
            {[
              { color: '#ef4444', label: 'Критичная' },
              { color: '#f59e0b', label: 'Средний риск' },
              { color: '#8b5cf6', label: 'Обычная' },
              { color: '#10b981', label: 'Завершена' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: l.color }} />
                <span className="text-[10px] text-slate-500">{l.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom(z => Math.max(0.4, z - 0.3))} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors" title="Уменьшить">
            <ZoomOut size={14} />
          </button>
          <span className="text-xs text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.3))} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors" title="Увеличить">
            <ZoomIn size={14} />
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 bg-violet-600/80 hover:bg-violet-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download size={12} />
            {exporting ? 'Экспорт...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Chart */}
      <div id="gantt-chart-container" className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex">
          {/* Fixed label column */}
          <div className="flex-shrink-0 border-r border-slate-800" style={{ width: LABEL_W }}>
            {/* Header */}
            <div className="h-9 bg-slate-900 border-b border-slate-800 flex items-center px-3">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Задача</span>
            </div>
            {rows.map((row, i) => (
              <div
                key={`${row.type}-${row.id}-${i}`}
                className={`flex items-center gap-2 px-2 border-b border-slate-800/50 ${row.type === 'block' ? 'bg-slate-900/60' : 'bg-slate-950/80 hover:bg-slate-900/30'}`}
                style={{ height: ROW_H, paddingLeft: 8 + row.indent * 12 }}
              >
                <span className="text-[9px] font-mono text-slate-600 flex-shrink-0 w-7">{row.wbsNumber}</span>
                <span className={`text-[11px] truncate ${row.type === 'block' ? 'font-bold text-slate-300' : 'text-slate-400'}`}>
                  {row.name}
                </span>
                {row.is_critical && (
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                )}
              </div>
            ))}
          </div>

          {/* Scrollable chart area */}
          <div className="flex-1 overflow-x-auto" ref={scrollRef}>
            <svg
              width={chartW}
              height={svgH + 36}
              className="block"
              style={{ minWidth: chartW }}
            >
              {/* Background */}
              <rect width={chartW} height={svgH + 36} fill="#020617" />

              {/* Tick lines & labels */}
              {ticks.map((tick, ti) => {
                const x = toX(tick);
                return (
                  <g key={ti}>
                    <line x1={x} y1={0} x2={x} y2={svgH + 36} stroke="#1e293b" strokeWidth={1} />
                    <text x={x + 4} y={14} fill="#475569" fontSize={10} fontFamily="monospace">
                      {formatDate(tick, true)}
                    </text>
                  </g>
                );
              })}

              {/* Weekend shading */}
              {Array.from({ length: totalDays }, (_, d) => {
                const dayMs = rangeStart + d * 86400000;
                const dow = new Date(dayMs).getDay();
                if (dow === 0 || dow === 6) {
                  const x = toX(dayMs);
                  const w = toX(dayMs + 86400000) - x;
                  return <rect key={d} x={x} y={36} width={w} height={svgH} fill="#ffffff06" />;
                }
                return null;
              })}

              {/* Row backgrounds */}
              {rows.map((row, i) => (
                <rect
                  key={`bg-${i}`}
                  x={0}
                  y={36 + i * ROW_H}
                  width={chartW}
                  height={ROW_H}
                  fill={row.type === 'block' ? '#0f172a' : i % 2 === 0 ? '#020617' : '#030712'}
                />
              ))}

              {/* Horizontal grid lines */}
              {rows.map((_, i) => (
                <line
                  key={`hl-${i}`}
                  x1={0} y1={36 + (i + 1) * ROW_H}
                  x2={chartW} y2={36 + (i + 1) * ROW_H}
                  stroke="#1e293b" strokeWidth={0.5}
                />
              ))}

              {/* Task bars */}
              {rows.map((row, i) => {
                if (!row.start || !row.end) return null;
                const x = toX(row.start);
                const w = Math.max(4, toX(row.end) - x);
                const y = 36 + i * ROW_H + ROW_H * 0.2;
                const h = ROW_H * 0.6;
                const color = barColor(row);
                const r = 3;

                return (
                  <g key={`bar-${row.id}-${i}`}>
                    {/* Glow for critical */}
                    {row.is_critical && (
                      <rect x={x - 1} y={y - 2} width={w + 2} height={h + 4} rx={r + 1} fill="#ef444440" />
                    )}
                    {/* Main bar */}
                    <rect
                      x={x} y={y} width={w} height={h}
                      rx={r} fill={color} opacity={0.85}
                    />
                    {/* Progress stripe (if in progress) */}
                    {row.workflow_status === 'IN_PROGRESS' && (
                      <rect x={x} y={y} width={w * 0.5} height={h} rx={r} fill={color} opacity={0.3} />
                    )}
                    {/* Label inside bar if wide enough */}
                    {w > 60 && (
                      <text
                        x={x + 5} y={y + h * 0.68}
                        fill="white" fontSize={9} opacity={0.9}
                        fontFamily="system-ui"
                      >
                        {row.assigned ? row.assigned.split(' ')[0] : ''}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Today line */}
              {TODAY >= rangeStart && TODAY <= rangeEnd && (
                <g>
                  <line
                    x1={toX(TODAY)} y1={0}
                    x2={toX(TODAY)} y2={svgH + 36}
                    stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4,3"
                  />
                  <text x={toX(TODAY) + 3} y={26} fill="#f59e0b" fontSize={9} fontFamily="monospace">
                    Сегодня
                  </text>
                </g>
              )}

              {/* Project end deadline line */}
              {projectEndDate && toMs(projectEndDate) >= rangeStart && toMs(projectEndDate) <= rangeEnd && (
                <g>
                  <line
                    x1={toX(toMs(projectEndDate))} y1={0}
                    x2={toX(toMs(projectEndDate))} y2={svgH + 36}
                    stroke="#ef4444" strokeWidth={1} strokeDasharray="6,3"
                    opacity={0.6}
                  />
                  <text x={toX(toMs(projectEndDate)) + 3} y={26} fill="#ef4444" fontSize={9} fontFamily="monospace">
                    Дедлайн
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="text-center py-1.5 bg-slate-900/50 border-t border-slate-800">
          <div className="flex items-center justify-center gap-4 text-[10px] text-slate-600">
            <span className="flex items-center gap-1"><ChevronLeft size={10} /><ChevronRight size={10} /> Прокрутите для просмотра</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 border border-dashed border-amber-500" /> Сегодня
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 bg-white/5" /> Выходные
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
