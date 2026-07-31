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
    status: 'idle' | 'running' | 'ok' | 'error'
    running: boolean
    recalculated_days?: number
    total_cost?: number
    error?: string
}

interface WaitForRecalculationOptions {
    timeoutMs?: number
    pollIntervalMs?: number
}

const delay = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, milliseconds)
    })

export const modelPricesApi = {
    async get(): Promise<Record<string, ModelPrice>> {
        const resp = await apiClient.get<GetModelPricesResponse>('/model-prices')
        return resp.prices ?? {}
    },

    async put(prices: Record<string, ModelPrice>): Promise<PutModelPricesResponse> {
        return apiClient.put<PutModelPricesResponse>('/model-prices', { prices })
    },

    async getRecalculationStatus(): Promise<CostRecalculationStatus> {
        return apiClient.get<CostRecalculationStatus>('/usage/recalculate-costs')
    },

    async waitForRecalculation(
        options: WaitForRecalculationOptions = {},
    ): Promise<CostRecalculationStatus | null> {
        const timeoutMs      = options.timeoutMs ?? 310_000
        const pollIntervalMs = options.pollIntervalMs ?? 5000
        const deadline       = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            const status = await this.getRecalculationStatus()
            if (!status.running && status.status !== 'running') {
                return status
            }
            await delay(pollIntervalMs)
        }
        return null
    },
}
