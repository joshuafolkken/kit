import { readdirSync } from 'node:fs'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
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

interface ProjectFiles {
	names: ReadonlyArray<string>
	options: ts.CompilerOptions
}

function project_files(root: string): ProjectFiles {
	const config_file = ts.readConfigFile(path.join(root, TSCONFIG), (file) => ts.sys.readFile(file))
	const parsed = ts.parseJsonConfigFileContent(config_file.config, ts.sys, root)
	const names = [...new Set([...parsed.fileNames, ...root_sources(root)])]

	return { names: names.map((name) => path.resolve(name)), options: parsed.options }
}

function load_program(root: string): ts.Program {
	const { names, options } = project_files(root)

	return ts.createProgram({ rootNames: names, options })
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

interface ScanScope {
	declaring: ReadonlySet<string>
	readers: ReadonlySet<string>
}

interface BaseRevision {
	root: string
	commit: string | undefined
}

// A changed file's text at the change base, or undefined where there is none: a new file, no base, or
// a root that is no checkout of the repository the base was read in.
async function base_text(base: BaseRevision, file: string): Promise<string | undefined> {
	if (base.commit === undefined) return undefined
	const spec = `${base.commit}:${path.relative(base.root, file)}`

	try {
		return await git_spawn.read(['-C', base.root, 'show', spec])
	} catch {
		return undefined
	}
}

// What a changed file imports now and imported at the change base: a reader that drops its last
// reference usually drops the import with it, or the whole file, so its current text no longer names
// the file whose namespace it left unused.
async function imports_of(
	base: BaseRevision,
	graph: ImportGraph,
	file: string,
): Promise<ReadonlyArray<string>> {
	const text = await base_text(base, file)
	const before = text === undefined ? [] : graph.imports(file, text)

	return [...graph.imports(file), ...before]
}

// The files whose namespaces a change can leave unused — the changed files, and the files they import
// directly, since dropping a reader's last reference leaves the declaring file untouched
// (joshuafolkken/kit#4649) — and their readers: the files whose imports reach one of them, which is
// every file that can name its namespaces — through a renaming re-export, an alias, or a namespace
// nesting one — so a member they read is never reported unused. Undefined where no import graph can
// be built.
async function scope_of(
	root: string,
	files: ReadonlyArray<string>,
	project: ProjectFiles,
): Promise<ScanScope | undefined> {
	const graph = await import_graph.create(root)
	if (graph === undefined) return undefined
	const base = { root, commit: await change_base.resolved() }
	const imported = await Promise.all(files.map(async (file) => await imports_of(base, graph, file)))
	const declaring = new Set([...files, ...imported.flat()])

	return { declaring, readers: graph.importers([...declaring], project.names) }
}

// The same judgement as `find_unused_members`, limited to the namespaces the scope declares: the
// program holds only the files that can read them, and only those readers are walked — the files
// they import in turn are there for the checker, not as readers (joshuafolkken/kit#4645).
async function find_unused_members_in(
	root: string,
	files: ReadonlyArray<string>,
): Promise<Array<NamespaceMember>> {
	const project = project_files(root)
	const scope = await scope_of(
		root,
		files.map((file) => path.resolve(file)),
		project,
	)
	if (scope === undefined) return find_unused_members(root)
	const program = ts.createProgram({ rootNames: [...scope.readers], options: project.options })
	const sources = program
		.getSourceFiles()
		.filter((source) => scope.readers.has(path.resolve(source.fileName)))
	const declaring = sources.filter((source) => scope.declaring.has(path.resolve(source.fileName)))

	return unused_of(declared_namespaces(declaring), program, sources)
}

const unused_members = { find_unused_members, find_unused_members_in }

export { unused_members }
