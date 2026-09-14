/**
 * 模型价格 API
 * 服务端存储模型价格配置，替代 localStorage
 */

import type {ModelPrice} from '@/utils/usage'
import {apiClient} from './client'

interface GetModelPricesResponse {
    prices: Record<string, ModelPrice>
}

export interface PutModelPricesResponse {
    status: string
    count: number
    recalculation: boolean
    recalculation_pending?: boolean
    recalculated_days?: number
    total_cost?: number
    recalculation_error?: string
    already_running?: boolean
}

export interface CostRecalculationStatus {
    status: 'idle' | 'started' | 'busy' | 'running' | 'rolling_up' | 'interrupted' | 'ok' | 'error'
    running: boolean
    task_id?: string
    phase?: string
    processed_events?: number
    total_events?: number
    changed_events?: number
    rollup_total_days?: number
    rollup_done_days?: number
    dirty_days_remaining?: number
    percent?: number
    recalculated_days?: number
    total_cost?: number
    error?: string
    started_at?: string
    updated_at?: string
    resumable?: boolean
    resumed?: boolean
    restart_reason?: string
}

interface RecalculationRequestOptions {
    signal?: AbortSignal
}

interface WaitForRecalculationOptions extends RecalculationRequestOptions {
    timeoutMs?: number
    pollIntervalMs?: number
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds)
        signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new DOMException('The operation was aborted', 'AbortError'))
        }, { once: true })
    })
}

export const modelPricesApi = {
    async get(): Promise<Record<string, ModelPrice>> {
        const resp = await apiClient.get<GetModelPricesResponse>('/model-prices')
        return resp.prices ?? {}
    },

    async put(prices: Record<string, ModelPrice>): Promise<PutModelPricesResponse> {
        return apiClient.put<PutModelPricesResponse>('/model-prices', { prices })
    },

    async startRecalculation(options: RecalculationRequestOptions = {}): Promise<CostRecalculationStatus> {
        return apiClient.post<CostRecalculationStatus>('/usage/recalculate-costs', undefined, options)
    },

    async getRecalculationStatus(options: RecalculationRequestOptions = {}): Promise<CostRecalculationStatus> {
        return apiClient.get<CostRecalculationStatus>('/usage/recalculate-costs', options)
    },

    async waitForRecalculation(
        options: WaitForRecalculationOptions = {},
    ): Promise<CostRecalculationStatus | null> {
        const timeoutMs      = options.timeoutMs ?? 310_000
        const pollIntervalMs = options.pollIntervalMs ?? 5000
        const deadline       = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            const status = await this.getRecalculationStatus({ signal: options.signal })
            if (!status.running) {
                return status
            }
            await delay(pollIntervalMs, options.signal)
        }
        return null
    },
}
