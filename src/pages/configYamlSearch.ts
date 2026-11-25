import type {YamlConfigField} from '@/hooks/visualConfigFields'
import {SearchCursor} from '@codemirror/search'
import type {EditorState} from '@codemirror/state'
import {isMap, isNode, isScalar, isSeq, type ParsedNode, parseDocument} from 'yaml'

export function findYamlFieldRange(source: string, { path, template }: YamlConfigField) {
    let node: ParsedNode | null = parseDocument(source).contents
    let range                   = { from: 0, to: 0, exact: false }
    for (const [index, part] of path.entries()) {
        if (template && (part === '[]' || part === '{*}')) {
            break
        }
        const pair           = typeof part === 'string' && isMap(node) ? node.items.find((item) =>
                                                                                             isScalar(item.key) &&
                                                                                             String(item.key.value) ===
                                                                                             part) : undefined
        const child: unknown = typeof part === 'number' && isSeq(node) ? node.items[part] : pair?.value
        const target         = pair?.key ?? child
        if (!isNode(target) || !target.range) {
            break
        }
        range = { from: target.range[0], to: target.range[1], exact: index === path.length - 1 }
        node  = isNode(child) ? child as ParsedNode : null
    }
    return range
}

export function findYamlSearchMatch(
    state: EditorState,
    query: string,
    direction: 'next' | 'prev',
    repeat: boolean,
) {
    if (!query) {
        return null
    }

    const matches: Array<{ from: number; to: number }> = []
    const cursor                                       = new SearchCursor(
        state.doc,
        query,
        0,
        state.doc.length,
        (value) => value.toLowerCase(),
    )
    while (!cursor.nextOverlapping().done) {
        matches.push(cursor.value)
    }
    if (matches.length === 0) {
        return null
    }

    const selection = state.selection.main
    const selected  = repeat ? matches.findIndex(({ from, to }) => from === selection.from && to === selection.to) : -1
    let index: number
    if (selected >= 0) {
        index = (selected + (direction === 'next' ? 1 : -1) + matches.length) % matches.length
    } else if (direction === 'next') {
        const next = matches.findIndex(({ from }) => from >= selection.head)
        index      = next < 0 ? 0 : next
    } else {
        const next = matches.findIndex(({ from }) => from > selection.head)
        index      = next > 0 ? next - 1 : matches.length - 1
    }
    const { from, to } = matches[index]
    return { from, to, current: index + 1, total: matches.length }
}
