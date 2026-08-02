import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'
import {compareLooseSemver, parseLooseSemver} from '../src/utils/looseSemver'

const viteConfigPath = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const viteConfig = readFileSync(viteConfigPath, 'utf8')

describe('version compatibility', () => {
    test('compares augmented versions after their semantic base version', () => {
        expect(parseLooseSemver('v7.2.67-aug.1')).toEqual([7, 2, 67, 1])
        expect(parseLooseSemver('v7.2.67-augmented.2')).toEqual([7, 2, 67, 2])
        expect(compareLooseSemver([7, 2, 67, 0], [7, 2, 67, 1])).toBeLessThan(0)
        expect(compareLooseSemver([7, 2, 67, 2], [7, 2, 67, 1])).toBeGreaterThan(0)
        expect(compareLooseSemver([7, 2, 68, 0], [7, 2, 67, 9])).toBeGreaterThan(0)
    })

    test('treats development and unknown versions as unavailable', () => {
        expect(parseLooseSemver('dev')).toBeNull()
        expect(parseLooseSemver('unknown')).toBeNull()
        expect(parseLooseSemver('-')).toBeNull()
    })

    test('requires CLIProxyAPI v7.2.67-aug.2', () => {
        expect(viteConfig).toContain("__COMPAT_MIN_SERVER__: JSON.stringify('7.2.67-aug.2')")
        expect(viteConfig).not.toContain("__COMPAT_MIN_SERVER__: JSON.stringify('7.2.67-aug.1')")
    })
})
