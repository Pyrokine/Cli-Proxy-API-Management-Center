import {sanitizeAuthFileName} from '@/features/authFiles/identity'

interface AuthFileBatchDownloadResult {
    downloaded: string[]
    failed: string[]
}

type AuthFileDownloader = (name: string) => Promise<Blob>
type BlobSaver = (name: string, blob: Blob) => void

const normalizeDownloadBaseName = (name: string, index: number): string => {
    const safeName = sanitizeAuthFileName(name).slice(0, 180)
    return safeName || `credential-${index + 1}.json`
}

const splitExtension = (name: string): { stem: string; extension: string } => {
    const dot = name.lastIndexOf('.')
    if (dot <= 0) {
        return { stem: name, extension: '' }
    }
    return { stem: name.slice(0, dot), extension: name.slice(dot) }
}

export const stableAuthFileDownloadName = (name: string, index = 0): string =>
    normalizeDownloadBaseName(name, index)

const uniqueDownloadName = (name: string, used: Set<string>): string => {
    const key = name.toLowerCase()
    if (!used.has(key)) {
        used.add(key)
        return name
    }
    const { stem, extension } = splitExtension(name)
    let suffix                = 2
    while (used.has(`${stem} (${suffix})${extension}`.toLowerCase())) {
        suffix += 1
    }
    const candidate = `${stem} (${suffix})${extension}`
    used.add(candidate.toLowerCase())
    return candidate
}

const saveAuthFileBlob = (name: string, blob: Blob): void => {
    const url       = URL.createObjectURL(blob)
    const anchor    = document.createElement('a')
    anchor.href     = url
    anchor.download = name
    anchor.click()
    queueMicrotask(() => URL.revokeObjectURL(url))
}

export async function downloadAuthFilesBatch(
    names: string[],
    download: AuthFileDownloader,
    save: BlobSaver = saveAuthFileBlob,
): Promise<AuthFileBatchDownloadResult> {
    const uniqueNames          = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
    const downloaded: string[] = []
    const failed: string[]     = []
    const usedDownloadNames    = new Set<string>()

    for (const [index, name] of uniqueNames.entries()) {
        try {
            const blob     = await download(name)
            const safeName = stableAuthFileDownloadName(name, index)
            save(uniqueDownloadName(safeName, usedDownloadNames), blob)
            downloaded.push(name)
        } catch {
            failed.push(name)
        }
    }

    return { downloaded, failed }
}
