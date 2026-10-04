import { readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { member_usage } from './member-usage'
import { namespace_members, type Namespace, type NamespaceMember } from './namespace-members'

const TSCONFIG = 'tsconfig.json'
const TEST_FILE_SUFFIX = '.test.ts'
const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`
const ROOT_SOURCE = /\.[cm]?[jt]s$/u

// The config files at the repository root (`vitest.config.ts`, `eslint.config.js`) read namespaces
// yet sit outside the `tsconfig.json` include, so nothing type-checks them: a member only they read
// would be reported unused and its removal would break them silently. They join as roots.
function root_sources(root: string): Array<string> {
	return readdirSync(root)
		.filter((name) => ROOT_SOURCE.test(name))
		.map((name) => path.join(root, name))
}

function load_program(root: string): ts.Program {
	const config_file = ts.readConfigFile(path.join(root, TSCONFIG), (file) => ts.sys.readFile(file))
	const parsed = ts.parseJsonConfigFileContent(config_file.config, ts.sys, root)
	const root_names = [...new Set([...parsed.fileNames, ...root_sources(root)])]

	return ts.createProgram({ rootNames: root_names, options: parsed.options })
}

function is_project_source(source: ts.SourceFile): boolean {
	return (
		!source.isDeclarationFile && !path.normalize(source.fileName).includes(NODE_MODULES_SEGMENT)
	)
}

// A test declares no namespace anything else reads, but every reference it makes counts as a use:
// a member kept for a test is a decision the test records, not dead code.
function declared_namespaces(sources: ReadonlyArray<ts.SourceFile>): Array<Namespace> {
	return sources
		.filter((source) => !source.fileName.endsWith(TEST_FILE_SUFFIX))
		.flatMap((source) => namespace_members.collect_namespaces(source))
}

function unused_of(
	namespaces: ReadonlyArray<Namespace>,
	program: ts.Program,
	sources: ReadonlyArray<ts.SourceFile>,
): Array<NamespaceMember> {
	const usage = member_usage.collect_usage(
		{
			checker: program.getTypeChecker(),
			declarations: new Set(namespaces.map((namespace) => namespace.declaration)),
			literals: new Map(namespaces.map((namespace) => [namespace.literal, namespace.declaration])),
		},
		sources,
	)

	return namespaces
		.filter((namespace) => !usage.escaped.has(namespace.declaration))
		.flatMap((namespace) => namespace.members)
		.filter((member) => !usage.used.has(member.declaration))
}

// Every member of an exported namespace object that nothing in the program reads — the dead exports
// an ordinary unused-export tool cannot see, because the namespace itself is imported everywhere.
function find_unused_members(root: string): Array<NamespaceMember> {
	const program = load_program(root)
	const sources = program.getSourceFiles().filter((source) => is_project_source(source))

	return unused_of(declared_namespaces(sources), program, sources)
}

const unused_members = { find_unused_members }

export { unused_members }
