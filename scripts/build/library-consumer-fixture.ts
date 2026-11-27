import { spawnSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKAGE_NAME = '@joshuafolkken/kit'
const CONSUMER_FILE = 'consumer.ts'

interface DeclaredSurface {
	diagnostics: ReadonlyArray<string>
	exports: ReadonlyArray<string>
}

// Lay out a consumer project whose node_modules links kit under its package name, so imports below
// resolve through package.json `exports` the way a real dependent's would — not by file path.
function link_consumer(directory: string): string {
	const scope_directory = path.join(directory, 'node_modules', '@joshuafolkken')

	mkdirSync(scope_directory, { recursive: true })
	symlinkSync(PACKAGE_DIR, path.join(scope_directory, 'kit'), 'dir')
	writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }))

	return directory
}

// The one order every surface list is compared in — the node probe below sorts the same way.
function sorted_names(names: ReadonlyArray<string>): Array<string> {
	return names.toSorted((left, right) => left.localeCompare(right))
}

// Import `<kit>/<entry>` under plain node from the consumer and report each export's own keys
// (an object export lists its members; anything else lists none), sorted for an exact comparison.
function runtime_surface(directory: string, entry: string): Record<string, Array<string>> {
	const script = `const m = await import('${PACKAGE_NAME}/${entry}')
		const sorted = (names) => names.toSorted((left, right) => left.localeCompare(right))
		const surface = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'object' && v !== null ? sorted(Object.keys(v)) : []]))
		process.stdout.write(JSON.stringify(surface))`
	const result = spawnSync('node', ['--input-type=module', '-e', script], {
		cwd: directory,
		encoding: 'utf8',
	})

	if (result.status !== 0) throw new Error(result.stderr)

	return JSON.parse(result.stdout) as Record<string, Array<string>>
}

function consumer_program(file: string): ts.Program {
	return ts.createProgram([file], {
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		target: ts.ScriptTarget.ES2022,
		strict: true,
		noEmit: true,
		types: ['node'],
		typeRoots: [path.join(PACKAGE_DIR, 'node_modules', '@types')],
	})
}

function module_exports(program: ts.Program, source: ts.SourceFile): Array<string> {
	const declaration = source.statements.find((statement): statement is ts.ImportDeclaration =>
		ts.isImportDeclaration(statement),
	)
	const checker = program.getTypeChecker()
	const symbol = declaration ? checker.getSymbolAtLocation(declaration.moduleSpecifier) : undefined
	const names = symbol ? checker.getExportsOfModule(symbol).map((member) => member.name) : []

	return sorted_names(names)
}

// Type-check a consumer that imports `type_names` from `<kit>/<entry>` by package name and report
// its diagnostics plus every name the resolved declaration exports, sorted.
function declared_surface(
	directory: string,
	entry: string,
	type_names: ReadonlyArray<string>,
): DeclaredSurface {
	const file = path.join(directory, CONSUMER_FILE)
	const aliases = type_names.map((name) => `export type Probe${name} = ${name}`).join('\n')

	writeFileSync(
		file,
		`import type { ${type_names.join(', ')} } from '${PACKAGE_NAME}/${entry}'\n${aliases}\n`,
	)
	const program = consumer_program(file)
	const source = program.getSourceFile(file)
	const diagnostics = ts.getPreEmitDiagnostics(program)

	return {
		diagnostics: diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')),
		exports: source ? module_exports(program, source) : [],
	}
}

const library_consumer_fixture = { link_consumer, runtime_surface, declared_surface, sorted_names }

export type { DeclaredSurface }
export { library_consumer_fixture }
