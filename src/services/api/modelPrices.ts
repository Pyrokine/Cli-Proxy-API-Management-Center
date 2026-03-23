/**
 * 模型价格 API
 * 服务端存储模型价格配置，替代 localStorage
 */

import type {ModelPrice} from '@/utils/usage'
import {apiClient} from './client'

interface GetModelPricesResponse {
    prices: Record<string, ModelPrice>;
}

interface PutModelPricesResponse {
    status: string;
    count: number;
}

export const modelPricesApi = {
    async get(): Promise<Record<string, ModelPrice>> {
        const resp = await apiClient.get<GetModelPricesResponse>('/model-prices')
        return resp.prices ?? {}
    },

    async put(prices: Record<string, ModelPrice>): Promise<PutModelPricesResponse> {
        return apiClient.put<PutModelPricesResponse>('/model-prices', { prices })
    },
}
