import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {compareLooseSemver, parseLooseSemver} from '@/utils/looseSemver'

interface ParsedVersion {
    major: number
    minor: number
    patch: number
    aug: number
    groupKey: string
}

const transpiler = new Bun.Transpiler({loader: 'ts'})
const modalSource = readFileSync(new URL('../src/components/system/VersionHistoryModal.tsx', import.meta.url), 'utf8')
const systemSource = readFileSync(new URL('../src/pages/SystemPage.tsx', import.meta.url), 'utf8')

const modalHelpers = modalSource.slice(
    modalSource.indexOf('function parseVersion('),
    modalSource.indexOf('/** Check if a release body mentions breaking changes. */'),
)
const systemHelpers = systemSource.slice(
    systemSource.indexOf('const compareVersions ='),
    systemSource.indexOf('export function SystemPage()'),
)
const {parseVersion, compareSemver} = runInNewContext(
    `${transpiler.transformSync(modalHelpers)}\n({parseVersion, compareSemver})`,
) as {
    parseVersion: (version: string) => ParsedVersion | null
    compareSemver: (left: ParsedVersion, right: ParsedVersion) => number
}
const {compareVersions} = runInNewContext(
    `${transpiler.transformSync(systemHelpers)}\n({compareVersions})`,
    {parseLooseSemver, compareLooseSemver},
) as {compareVersions: (latest: string, current: string) => number | null}

describe('release version build metadata', () => {
    test.each([
        ['v1.17.14-aug.2+dirty.8bb826eee218', 'v1.22.2-aug.1'],
        ['v7.2.67-aug.3+dirty.8f1a76e34d62', 'v7.2.127-aug.1'],
        ['v1.17.14-augmented.2+build.20260914', 'v1.22.2-aug.1'],
        ['v7.3.2-sync.20260924+dirty.a97a9b8b7430', 'v7.3.2-aug.1'],
        ['v1.23.1-sync.20260923+dirty.95123dbeb4b1', 'v1.23.1-aug.1'],
    ])('keeps the upgrade direction for %s', (current, target) => {
        const currentParsed = parseVersion(current)
        const targetParsed = parseVersion(target)
        expect(currentParsed).not.toBeNull()
        expect(targetParsed).not.toBeNull()
        if (!currentParsed || !targetParsed) {
            throw new Error('Release version could not be parsed')
        }
        expect(compareSemver(currentParsed, targetParsed)).toBeLessThan(0)
        expect(compareSemver(targetParsed, currentParsed)).toBeGreaterThan(0)
        expect(compareVersions(target, current)).toBeGreaterThan(0)
    })

    test.each(['dirty.8bb826eee218', 'build.20260914', 'linux-amd64.123'])('ignores %s in release precedence', (metadata) => {
        const plain = 'v1.22.2-aug.1'
        const annotated = `${plain}+${metadata}`
        expect(parseVersion(annotated)).toEqual(parseVersion(plain))
        expect(compareVersions(plain, annotated)).toBe(0)
        expect(compareVersions(annotated, plain)).toBe(0)
    })

    test.each(['dev', 'v1.2.3-rc.1', 'v1.2.3-sync.foo', 'v1.2.3-sync.20260924.extra', 'v1.2.3+', 'v1.2.3+dirty..hash', 'v1.2.3+dirty/hash'])('rejects unsupported or malformed history version %s', (value) => {
        expect(parseVersion(value)).toBeNull()
    })
})
