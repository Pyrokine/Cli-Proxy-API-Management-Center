/**
 * Chart.js configuration utilities for usage statistics
 * Extracted from UsagePage.tsx for reusability
 */

import type {ChartOptions} from 'chart.js'

function getCssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * Static sparkline chart options (no dependencies on theme/mobile)
 */
export const sparklineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
    elements: { line: { tension: 0.45 }, point: { radius: 0 } },
}

interface ChartConfigOptions {
    period: 'hour' | 'day';
    labels: string[];
    isMobile: boolean;
}

/**
 * Build chart options with theme and responsive awareness
 */
export function buildChartOptions({ period, labels, isMobile }: ChartConfigOptions): ChartOptions<'line'> {
    const pointRadius       = isMobile && period === 'hour' ? 0 : isMobile ? 2 : 4
    const tickFontSize      = isMobile ? 10 : 12
    const maxTickLabelCount = isMobile ? (period === 'hour' ? 8 : 6) : period === 'hour' ? 12 : 10
    const gridColor         = getCssVar('--chart-grid-color', 'rgba(17, 24, 39, 0.06)')
    const axisBorderColor   = getCssVar('--chart-axis-color', 'rgba(17, 24, 39, 0.10)')
    const tickColor         = getCssVar('--chart-tick-color', 'rgba(17, 24, 39, 0.72)')
    const tooltipBg         = getCssVar('--chart-tooltip-bg', 'rgba(255, 255, 255, 0.98)')
    const tooltipTitle      = getCssVar('--chart-tooltip-title', '#111827')
    const tooltipBody       = getCssVar('--chart-tooltip-body', '#374151')
    const tooltipBorder     = getCssVar('--chart-tooltip-border', 'rgba(17, 24, 39, 0.10)')

    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: tooltipBg,
                titleColor: tooltipTitle,
                bodyColor: tooltipBody,
                borderColor: tooltipBorder,
                borderWidth: 1,
                padding: 10,
                displayColors: true,
                usePointStyle: true,
            },
        },
        scales: {
            x: {
                grid: {
                    color: gridColor,
                    drawTicks: false,
                },
                border: {
                    color: axisBorderColor,
                },
                ticks: {
                    color: tickColor,
                    font: { size: tickFontSize },
                    maxRotation: isMobile ? 0 : 45,
                    minRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: maxTickLabelCount,
                    callback: (value) => {
                        const index = typeof value === 'number' ? value : Number(value)
                        const raw   =
                                  Number.isFinite(index) && labels[index] ?
                                  labels[index] :
                                  typeof value === 'string' ? value : ''

                        if (period === 'hour') {
                            const [md, time] = raw.split(' ')
                            if (!time) {
                                return raw
                            }
                            if (time.startsWith('00:')) {
                                return md ? [md, time] : time
                            }
                            return time
                        }

                        if (isMobile) {
                            const parts = raw.split('-')
                            if (parts.length === 3) {
                                return `${parts[1]}-${parts[2]}`
                            }
                        }
                        return raw
                    },
                },
            },
            y: {
                beginAtZero: true,
                grid: {
                    color: gridColor,
                },
                border: {
                    color: axisBorderColor,
                },
                ticks: {
                    color: tickColor,
                    font: { size: tickFontSize },
                },
            },
        },
        elements: {
            line: {
                tension: 0.35,
                borderWidth: isMobile ? 1.5 : 2,
            },
            point: {
                borderWidth: 2,
                radius: pointRadius,
                hoverRadius: 4,
            },
        },
    }
}

/**
 * Calculate minimum chart width for hourly data on mobile devices
 */
export function getHourChartMinWidth(labelCount: number, isMobile: boolean): string | undefined {
    if (!isMobile || labelCount <= 0) {
        return undefined
    }
    const perPoint = 56
    const minWidth = Math.min(labelCount * perPoint, 3000)
    return `${minWidth}px`
}
