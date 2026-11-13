import { readFileSync } from 'node:fs'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import type ts from 'typescript'

type TypeScript = typeof ts

interface Comparison {
	base: string
	typescript: TypeScript
}

// A new import can break an indirect test's mock while every direct importer passes (#7453).
// Only unchanged import declarations and targets may use the direct-only cap. Unknown history keeps reach.
function is_loading(typescript: TypeScript, node: ts.Node, source: ts.SourceFile): boolean {
	if (!typescript.isCallExpression(node)) return false

	return (
		node.expression.kind === typescript.SyntaxKind.ImportKeyword ||
		node.expression.getText(source) === 'require'
	)
}

function signature(typescript: TypeScript, file: string, content: string): string {
	const source = typescript.createSourceFile(file, content, typescript.ScriptTarget.Latest)
	const declarations: Array<string> = []

	function visit(node: ts.Node): void {
		if (
			typescript.isImportDeclaration(node) ||
			typescript.isExportDeclaration(node) ||
			is_loading(typescript, node, source)
		) {
			declarations.push(node.getText(source))
		}

		typescript.forEachChild(node, visit)
	}

	visit(source)

	return JSON.stringify(declarations)
}

async function is_stable(root: string, file: string, comparison: Comparison): Promise<boolean> {
	if (path.extname(file) === '.svelte') return false

	try {
		const before = await git_spawn.read(['-C', root, 'show', `${comparison.base}:${file}`])
		const current = readFileSync(path.join(root, file), 'utf8')

		return (
			signature(comparison.typescript, file, before) ===
			signature(comparison.typescript, file, current)
		)
	} catch {
		return false
	}
}

async function compare(root: string, files: ReadonlyArray<string>): Promise<Array<boolean>> {
	try {
		const base = await change_base.resolved_through_merge()
		if (base === undefined) return files.map(() => false)
		const { default: typescript } = await import('typescript')

		return await Promise.all(
			files.map(async (file) => await is_stable(root, file, { base, typescript })),
		)
	} catch {
		return files.map(() => false)
	}
}

async function stable_files(root: string, files: ReadonlyArray<string>): Promise<Array<string>> {
	if (files.length === 0) return []
	const stable = await compare(root, files)
	const retained = files.filter((_file, index) => stable[index] !== true)

	if (retained.length > 0) {
		process.stdout.write(
			`josh test:related: keeping full reach (imports changed or unknown): ${retained.join(', ')}\n`,
		)
	}

	return files.filter((_file, index) => stable[index] === true)
}

const test_related_imports = { stable_files }

export { test_related_imports }
