export type LooseSemver = [number, number, number, number]

export function parseLooseSemver(input: string): LooseSemver | null {
    const trimmed = String(input ?? '').trim()
    if (!trimmed) {
        return null
    }
    const lowered = trimmed.toLowerCase()
    if (lowered === 'dev' || lowered === 'unknown' || lowered === '-') {
        return null
    }
    const match = trimmed
        .replace(/^v/i, '')
        .match(/^(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?(?:-(?:aug|augmented)\.(?<aug>\d+))?/i)
    if (!match?.groups) {
        return null
    }
    return [
        Number(match.groups.major),
        Number(match.groups.minor),
        match.groups.patch !== undefined ? Number(match.groups.patch) : 0,
        match.groups.aug !== undefined ? Number(match.groups.aug) : 0,
    ]
}

export function compareLooseSemver(a: LooseSemver, b: LooseSemver): number {
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) {
            return a[index] - b[index]
        }
    }
    return 0
}
