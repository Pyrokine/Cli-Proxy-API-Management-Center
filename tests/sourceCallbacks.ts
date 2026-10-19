import {readFileSync} from 'node:fs'
import ts from 'typescript'

export function sourceCallback<T>(file: string, name: string, scope: Record<string, unknown>, effectIndex: number | string = 0): T {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let callback: string | undefined
    let effect = 0
    const visit = (node: ts.Node) => {
        if (name === 'useEffect' && ts.isCallExpression(node) && node.expression.getText(tree) === name) {
            const body = node.arguments[0]?.getText(tree)
            if (typeof effectIndex === 'string' ? body?.includes(effectIndex) : effect++ === effectIndex) {
                callback = body
            }
        } else if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name &&
            node.initializer && ts.isCallExpression(node.initializer)) {
            callback = node.initializer.arguments[0]?.getText(tree)
        } else if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === name) {
            callback = node.getText(tree).replace(/^export\s+(?:default\s+)?/, '')
        }
        ts.forEachChild(node, visit)
    }
    visit(tree)
    if (!callback) {
        throw new Error(`Missing callback ${file}.${name}`)
    }
    const transpiler = new Bun.Transpiler({loader: 'tsx', tsconfig: {compilerOptions: {jsx: 'react'}}})
    const code = transpiler.transformSync(`const callback = ${callback}`)
    return new Function(...Object.keys(scope), `${code}; return callback`)(...Object.values(scope)) as T
}

export function sourceInitializer<T>(file: string, name: string, scope: Record<string, unknown>): T {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let initializer: string | undefined
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
            initializer = node.initializer.getText(tree)
        }
        ts.forEachChild(node, visit)
    }
    visit(tree)
    if (!initializer) {
        throw new Error(`Missing initializer ${file}.${name}`)
    }
    const code = new Bun.Transpiler({loader: 'tsx', tsconfig: {compilerOptions: {jsx: 'react'}}}).transformSync(`const value = ${initializer}`)
    return new Function(...Object.keys(scope), `${code}; return value`)(...Object.values(scope)) as T
}
