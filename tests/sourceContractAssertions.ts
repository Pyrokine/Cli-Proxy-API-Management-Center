import {expect} from 'bun:test'
import ts from 'typescript'

const sourceTokens = (source: string): string => {
    const tree                                                  = ts.createSourceFile(
        'source.tsx',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    )
    const tokens: Array<{ kind: ts.SyntaxKind; value: string }> = []
    const visit                                                 = (node: ts.Node) => {
        const children = node.getChildren(tree)
        if (children.length > 0) {
            children.forEach(visit)
        } else if (node.end > node.getStart(tree) && node.kind !== ts.SyntaxKind.EndOfFileToken) {
            tokens.push({ kind: node.kind, value: ts.isStringLiteral(node) ? node.text : node.getText(tree) })
        }
    }
    visit(tree)
    return tokens
        .filter((token, index) => token.kind !== ts.SyntaxKind.CommaToken ||
                                  tokens[index + 1]?.kind !== ts.SyntaxKind.CloseParenToken)
        .map((token) => JSON.stringify(token))
        .join('\n')
}

export const expectSourceToContain = (source: string, expected: string): void => {
    expect(sourceTokens(source)).toContain(sourceTokens(expected))
}
