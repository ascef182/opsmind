'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

// Built on shadcn's chart.tsx (ChartContainer/ChartTooltip/ChartConfig, added
// via `pnpm dlx shadcn add chart`) — integrated cleanly on the first attempt,
// no Card dependency to collide with our own `components/ui/card.tsx`. Cores
// default abaixo espelham os hex literais dos tokens `accent-*`/`positive-500`/
// `negative-500`/`ink-500` de app/globals.css: Recharts recebe cor via prop
// `fill`/`stroke` (atributos SVG), não via classe Tailwind, então hex literal
// é o jeito confiável de manter os componentes em sincronia com a paleta —
// mesma abordagem do brief original, só que agora por cima do wrapper shadcn.
//
// Decisão de design: nenhum destes 4 componentes se auto-envolve num `Card`
// próprio — "SparklineChart (... pra dentro de um KPI tile)" no brief indica
// que ele é pensado pra viver DENTRO de um tile/Card já existente (que traz o
// número grande + label), não ser um Card por si. Os outros três seguem a
// mesma convenção por consistência; Task 8/9 envolve em `Card` no call site
// quando fizer sentido.
const DEFAULT_ACCENT = '#f5820d'; // --color-accent-500
const DEFAULT_POSITIVE = '#22c55e'; // --color-positive-500
const DEFAULT_NEGATIVE = '#ef4444'; // --color-negative-500
const DEFAULT_MUTED = '#6b6b6b'; // --color-ink-500

const DONUT_FALLBACK_COLORS = [DEFAULT_ACCENT, DEFAULT_POSITIVE, DEFAULT_NEGATIVE, DEFAULT_MUTED, '#3b82f6', '#a855f7'];

interface SparklineChartProps {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  color?: string;
  height?: number;
}

// Area chart minimalista — sem eixo/grid/tooltip — pro shape de tendência
// dentro de um KPI tile.
export function SparklineChart({ data, dataKey, color = DEFAULT_ACCENT, height = 40 }: SparklineChartProps) {
  const gradientId = `sparkline-${dataKey}`;
  const config: ChartConfig = { [dataKey]: { color } };
  return (
    <ChartContainer config={config} className="aspect-auto" style={{ height }}>
      <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

interface DonutChartProps {
  data: Array<{ name: string; value: number; color?: string }>;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}

// Donut de distribuição por status (ex.: leads por LeadStatus).
export function DonutChart({ data, height = 200, innerRadius = 50, outerRadius = 80 }: DonutChartProps) {
  const config: ChartConfig = Object.fromEntries(
    data.map((d, i) => [d.name, { label: d.name, color: d.color ?? DONUT_FALLBACK_COLORS[i % DONUT_FALLBACK_COLORS.length] }]),
  );
  return (
    <ChartContainer config={config} className="mx-auto aspect-auto" style={{ height }}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={innerRadius} outerRadius={outerRadius} strokeWidth={2}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={d.color ?? DONUT_FALLBACK_COLORS[i % DONUT_FALLBACK_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

interface BarChartHighlightedProps {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  nameKey: string;
  highlightValue?: string | number;
  color?: string;
  highlightColor?: string;
  height?: number;
}

// Bar chart com uma barra em destaque (ex.: a cidade com mais leads) — as
// demais ficam em `color` (muted), a que bate com `highlightValue` usa
// `highlightColor`.
export function BarChartHighlighted({
  data,
  dataKey,
  nameKey,
  highlightValue,
  color = DEFAULT_MUTED,
  highlightColor = DEFAULT_ACCENT,
  height = 220,
}: BarChartHighlightedProps) {
  const config: ChartConfig = { [dataKey]: { color } };
  return (
    <ChartContainer config={config} className="aspect-auto" style={{ height }}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={nameKey} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey={dataKey} radius={4}>
          {data.map((entry) => (
            <Cell key={String(entry[nameKey])} fill={entry[nameKey] === highlightValue ? highlightColor : color} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

interface LineChartWithTooltipProps {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  xKey: string;
  color?: string;
  height?: number;
}

// Linha de 30 dias com tooltip — pro gráfico de tendência do dashboard
// (ex.: leads descobertos/qualificados por dia).
export function LineChartWithTooltip({ data, dataKey, xKey, color = DEFAULT_ACCENT, height = 240 }: LineChartWithTooltipProps) {
  const config: ChartConfig = { [dataKey]: { color } };
  return (
    <ChartContainer config={config} className="aspect-auto" style={{ height }}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} minTickGap={24} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ChartContainer>
  );
}
