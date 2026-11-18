import type ts from 'typescript'
import type { TypeScript } from './test-symbol-bindings'
import type { Source } from './test-symbol-users'

// **The tests calling a changed `josh` command by its name** (joshuafolkken/kit#7980): a command
// registry (`scripts/josh/josh-commands-*.ts`) is read through one table, so the symbol walk passes a
// change to an entry no further than that table's own tests. The entry's key is the name tests run the
// command by, so the test files naming a changed key — as a string or a word of a command line — are
// its readers.

const REGISTRY = /(?:^|\/)josh-commands-[^/]+\.ts$/u
// A command name needs no escaping in a pattern; any other key is never a command a test runs.
const COMMAND_NAME = /^[\w:-]+$/u
// A quote, a backtick (`\x60`) or a space either side of the name.
const EDGE = String.raw`['"\s\x60]`

function is_registry(file: string): boolean {
	return REGISTRY.test(file)
}

function line_of(source: ts.SourceFile, position: number): number {
	return source.getLineAndCharacterOfPosition(position).line + 1
}

function entries_of(typescript: TypeScript, source: ts.SourceFile): Array<ts.PropertyAssignment> {
	return source.statements
		.filter((statement) => typescript.isVariableStatement(statement))
		.flatMap((statement) => [...statement.declarationList.declarations])
		.flatMap((item) =>
			item.initializer !== undefined && typescript.isObjectLiteralExpression(item.initializer)
				? [...item.initializer.properties]
				: [],
		)
		.filter((property) => typescript.isPropertyAssignment(property))
}

function is_hit(source: ts.SourceFile, node: ts.Node, lines: ReadonlyArray<number>): boolean {
	const start = line_of(source, node.getStart(source))
	const end = line_of(source, node.getEnd())

	return lines.some((line) => line >= start && line <= end)
}

// The keys of the registry entries a changed line falls in.
function changed_commands(
	typescript: TypeScript,
	registry: Source,
	lines: ReadonlyArray<number>,
): Array<string> {
	const target = typescript.ScriptTarget.Latest
	const source = typescript.createSourceFile(registry.file, registry.text, target, true)

	return entries_of(typescript, source)
		.filter((entry) => is_hit(source, entry, lines))
		.map((entry) => entry.name)
		.filter((name) => typescript.isStringLiteral(name))
		.map((name) => name.text)
}

function named(command: string): RegExp {
	return new RegExp(`${EDGE}${command}${EDGE}`, 'u')
}

// The test files among `tests` naming one of `commands`.
function readers_of(commands: ReadonlyArray<string>, tests: ReadonlyArray<Source>): Array<string> {
	const names = commands.filter((command) => COMMAND_NAME.test(command))
	const patterns = names.map((command) => named(command))

	return tests
		.filter((test) => patterns.some((pattern) => pattern.test(test.text)))
		.map((test) => test.file)
}

const test_registry_readers = { changed_commands, is_registry, readers_of }

export { test_registry_readers }
