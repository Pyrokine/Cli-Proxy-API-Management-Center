/**
 * Chart.js configuration utilities for usage statistics
 * Extracted from UsagePage.tsx for reusability
 */

import type { ChartOptions } from 'chart.js'

function getCssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

interface ChartConfigOptions {
    period: 'hour' | 'day'
    labels: string[]
    isMobile: boolean
}

/**
 * Build chart options with theme and responsive awareness
 */
export function buildChartOptions({ period, labels, isMobile }: ChartConfigOptions): ChartOptions<'line'> {
    const tickFontSize = isMobile ? 10 : 12
    const maxTickLabelCount = isMobile ? (period === 'hour' ? 8 : 6) : period === 'hour' ? 12 : 10
    const gridColor = getCssVar('--chart-grid-color', 'rgba(17, 24, 39, 0.04)')
    const axisBorderColor = getCssVar('--chart-axis-color', 'rgba(17, 24, 39, 0.10)')
    const tickColor = getCssVar('--chart-tick-color', 'rgba(17, 24, 39, 0.72)')
    const tooltipBg = getCssVar('--chart-tooltip-bg', 'rgba(255, 255, 255, 0.98)')
    const tooltipTitle = getCssVar('--chart-tooltip-title', '#111827')
    const tooltipBody = getCssVar('--chart-tooltip-body', '#374151')
    const tooltipBorder = getCssVar('--chart-tooltip-border', 'rgba(17, 24, 39, 0.10)')

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
                callbacks: {
                    label: (context) => {
                        const label = context.dataset.label || ''
                        const raw = context.parsed.y ?? 0
                        const total = context.chart.data.datasets.reduce((sum, ds) => {
                            const v = ds.data[context.dataIndex]
                            return sum + (typeof v === 'number' ? v : 0)
                        }, 0)
                        const pct = total > 0 ? ((raw / total) * 100).toFixed(1) : '0.0'
                        const display = Number.isInteger(raw) ? raw.toLocaleString() : raw.toFixed(2)
                        return `${label}: ${display} (${pct}%)`
                    },
                    footer: (items) => {
                        const total = items.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0)
                        const display = Number.isInteger(total) ? total.toLocaleString() : total.toFixed(2)
                        return `Total: ${display}`
                    },
                },
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
                        const raw =
                            Number.isFinite(index) && labels[index]
                                ? labels[index]
                                : typeof value === 'string'
                                  ? value
                                  : ''

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
                tension: 0.3,
                borderWidth: 2,
            },
            point: {
                borderWidth: 2,
                radius: 0,
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
