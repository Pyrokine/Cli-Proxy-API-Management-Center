import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'

const sourcePath = fileURLToPath(
    new URL('../src/components/usage/hooks/useUsageData.ts', import.meta.url),
)
const modelManagementPath = fileURLToPath(new URL('../src/pages/ModelManagementPage.tsx', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')
const modelManagementSource = readFileSync(modelManagementPath, 'utf8')

describe('usage model price loading', () => {
    test('loads the server price table without writing during initialization', () => {
        const effectStart = source.indexOf('    useEffect(() => {')
        const effectEnd = source.indexOf('    const handleExport', effectStart)
        const initializationEffect = source.slice(effectStart, effectEnd)

        expect(effectStart).toBeGreaterThan(-1)
        expect(effectEnd).toBeGreaterThan(effectStart)
        expect(initializationEffect).toContain('const loaded = await loadModelPrices()')
        expect(initializationEffect).toContain('setModelPrices(loaded)')
        expect(initializationEffect).not.toContain('saveModelPrices(')
        expect(source).not.toContain('defaultModelPrices')
    })

    test('observes background repricing after model catalog price changes', () => {
        expect(modelManagementSource).toContain('const observePriceRecalculation = useCallback(')
        expect(modelManagementSource).toContain('modelPricesApi.waitForRecalculation()')
        expect(modelManagementSource).toContain('const catalog = await modelsApi.patchModelCatalogModel(request)')
        expect(modelManagementSource).toContain('if (catalog.recalculation_pending)')
        expect(modelManagementSource).toContain('if (response.catalog.recalculation_pending)')
        expect(modelManagementSource).toContain('observePriceRecalculation()')
    })

    test('keeps price writes in the explicit save handler', () => {
        const handlerStart = source.indexOf('    const handleSetModelPrices = useCallback(')
        const handlerEnd = source.indexOf('    const usage', handlerStart)
        const saveHandler = source.slice(handlerStart, handlerEnd)

        expect(handlerStart).toBeGreaterThan(-1)
        expect(handlerEnd).toBeGreaterThan(handlerStart)
        expect(saveHandler).toContain('await saveModelPrices(prices)')
        expect(saveHandler).toContain('result.recalculation_pending')
        expect(saveHandler).toContain('await modelPricesApi.waitForRecalculation()')
        expect(saveHandler).toContain('await handleAfterPricesSaved()')
    })
})
