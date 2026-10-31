import path from 'node:path'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { file_reader } from '#scripts/lib/read-file'
import type ts from 'typescript'
import { import_test_inputs } from './import-test-inputs'
import { type_only_imports } from './type-only-imports'

// What a file's lint verdict reads besides the file itself: every file its imports reach, followed
// through the project's own files and stopped at a package's. A type-aware rule's verdict on a file
// is about the types of those, so a cached verdict holds only while all of them do
// (joshuafolkken/kit#4415).
//
// The modules are resolved as the type checker resolves them — the project's `tsconfig.json`, its
// paths and `package.json` imports — because a resolution of our own would follow a different file
// than the one whose types the rule read. A package's file is named by its resolved path rather than
// read: that path carries the installed version, and a package's files change with nothing else.
const TSCONFIG = 'tsconfig.json'
const NODE_MODULES = 'node_modules'
const MODULE_STATEMENT = /^(?:import|export)\b/mu
const GLOBAL_DECLARATION = /^declare (?:global|module|namespace)\b/mu

type TypeScript = typeof ts

interface Dependency {
	file: string
	external: boolean
}

interface Resolver {
	typescript: TypeScript
	options: ts.CompilerOptions
}

interface GraphContext extends Resolver {
	root: string
	resolution_cache: ts.ModuleResolutionCache
	ambient: ReadonlyArray<Dependency>
	dependencies: Map<string, ReadonlyArray<Dependency>>
	runtime_dependencies: Map<string, ReadonlyArray<Dependency>>
	content_hashes: Map<string, string>
}

interface ProjectConfig {
	options: ts.CompilerOptions
	file_names: ReadonlyArray<string>
	config_files: ReadonlyArray<string>
}

interface ImportGraph {
	// Absent on older graph providers; undefined means an unknown input, never reusable.
	test_inputs?: ((file: string) => ReadonlyArray<string> | undefined) | undefined
	closure: (file: string) => ReadonlyArray<string>
	closure_hash: (file: string) => string
	imports: (file: string, content?: string) => ReadonlyArray<string>
	importers: (files: ReadonlyArray<string>, universe: ReadonlyArray<string>) => ReadonlySet<string>
	runtime_importers: (
		files: ReadonlyArray<string>,
		universe: ReadonlyArray<string>,
	) => ReadonlySet<string>
	strings: (file: string) => ReadonlyArray<string>
}

// A file's direct dependencies along one kind of edge.
type Edges = (context: GraphContext, file: string) => ReadonlyArray<Dependency>

// `typescript` is an optional peer: a project without it has no type-aware rule to go stale.
async function load_typescript(): Promise<TypeScript | undefined> {
	try {
		const module = await import('typescript')

		return module.default
	} catch {
		return undefined
	}
}

// A configuration that does not parse fails the type check, which reports it; here it only leaves
// the options the parse did reach. `config_files` are `tsconfig.json` and every file it extends: a
// type-aware verdict reads the compiler options — `strict` decides what is `any` — so a changed
// option is a changed input like a changed import.
function parsed_config(typescript: TypeScript, root: string): ProjectConfig | undefined {
	const config_file = path.join(root, TSCONFIG)
	if (!typescript.sys.fileExists(config_file)) return undefined
	const source = typescript.readJsonConfigFile(config_file, typescript.sys.readFile)
	const parsed = typescript.parseJsonSourceFileConfigFileContent(
		source,
		typescript.sys,
		root,
		undefined,
		config_file,
	)

	return {
		options: parsed.options,
		file_names: parsed.fileNames,
		config_files: [config_file, ...(source.extendedSourceFiles ?? [])],
	}
}

// A package is named by its resolved path only while that path sits in an install. A workspace or
// `link:` package resolves through its symlink to source the project edits — a path that carries no
// version — so its files are read like the project's own.
function is_installed(file: string): boolean {
	return file.split(path.sep).includes(NODE_MODULES)
}

function as_dependency(
	file: string | undefined,
	external: boolean | undefined,
): Dependency | undefined {
	if (file === undefined) return undefined

	return { file, external: external === true && is_installed(file) }
}

// A file named by its path from the one naming it: a `/// <reference path>`, or a relative import the
// checker cannot resolve — a `.svelte` component — whose file is still the one it names.
function relative_to(specifier: string, file: string): Dependency {
	return { file: path.resolve(path.dirname(file), specifier), external: false }
}

function resolve_module(
	context: GraphContext,
	specifier: string,
	file: string,
): Dependency | undefined {
	const { typescript, options, resolution_cache } = context
	const resolved = typescript.resolveModuleName(
		specifier,
		file,
		options,
		typescript.sys,
		resolution_cache,
	).resolvedModule

	if (resolved !== undefined) {
		return as_dependency(resolved.resolvedFileName, resolved.isExternalLibraryImport)
	}

	if (!specifier.startsWith('.')) return undefined

	return relative_to(specifier, file)
}

function resolve_type(resolver: Resolver, name: string, file: string): Dependency | undefined {
	const { typescript, options } = resolver
	const resolved = typescript.resolveTypeReferenceDirective(
		name,
		file,
		options,
		typescript.sys,
	).resolvedTypeReferenceDirective

	return as_dependency(resolved?.resolvedFileName, resolved?.isExternalLibraryImport)
}

function references_of(
	context: GraphContext,
	file: string,
	content: string,
): Array<Dependency | undefined> {
	const processed = context.typescript.preProcessFile(content, true, true)

	return [
		...processed.importedFiles.map((reference) =>
			resolve_module(context, reference.fileName, file),
		),
		...processed.referencedFiles.map((reference) => relative_to(reference.fileName, file)),
		...processed.typeReferenceDirectives.map((reference) =>
			resolve_type(context, reference.fileName, file),
		),
	]
}

function direct_dependencies(context: GraphContext, file: string): ReadonlyArray<Dependency> {
	const known = context.dependencies.get(file)
	if (known !== undefined) return known
	const found = references_of(context, file, file_reader.read_if_readable(file) ?? '').filter(
		(dependency) => dependency !== undefined,
	)

	context.dependencies.set(file, found)

	return found
}

// The direct dependencies the test runner follows: the imports left once the transpiler drops the
// type-only declarations, and no `/// <reference>` (joshuafolkken/kit#5368).
function runtime_dependencies(context: GraphContext, file: string): ReadonlyArray<Dependency> {
	const known = context.runtime_dependencies.get(file)
	if (known !== undefined) return known
	const content = file_reader.read_if_readable(file) ?? ''
	const found = type_only_imports
		.runtime_specifiers(context.typescript, file, content)
		.map((specifier) => resolve_module(context, specifier, file))
		.filter((dependency) => dependency !== undefined)

	context.runtime_dependencies.set(file, found)

	return found
}

// A file reaches files that never import it when it is a script or declares a global or a module —
// SvelteKit's `src/app.d.ts` `App.Locals`, say, or a `.ts` module's `declare global` augmentation;
// one that only exports is read through its imports like any other module.
function is_ambient(file: string): boolean {
	const content = file_reader.read_if_readable(file) ?? ''

	return GLOBAL_DECLARATION.test(content) || !MODULE_STATEMENT.test(content)
}

// What every file reads without importing it: the project's ambient declarations, the type packages
// its compiler options load (`types`, or every `@types` package when it is unset), and the
// configuration files those options come from.
function ambient_of(resolver: Resolver, root: string, config: ProjectConfig): Array<Dependency> {
	const config_file = path.join(root, TSCONFIG)
	const declarations = [
		...config.file_names.filter((file) => is_ambient(file)),
		...config.config_files,
	].map((file) => ({ file, external: false }))
	const types = resolver.typescript
		.getAutomaticTypeDirectiveNames(resolver.options, resolver.typescript.sys)
		.map((name) => resolve_type(resolver, name, config_file))
		.filter((dependency) => dependency !== undefined)

	return [...declarations, ...types]
}

function content_hash(context: GraphContext, file: string): string {
	const known = context.content_hashes.get(file)
	if (known !== undefined) return known
	const computed = input_fingerprint.of_file(file)

	context.content_hashes.set(file, computed)

	return computed
}

// Every file the imports reach, the starting file excluded: its own content is the cache's key
// already, and a file that imports itself through a cycle is still only that one key.
function is_unvisited(
	dependency: Dependency,
	start: string,
	reached: Map<string, Dependency>,
): boolean {
	return dependency.file !== start && !reached.has(dependency.file)
}

// Dependencies joined to what is reached, and those inside the project queued to be followed.
function join(
	dependencies: ReadonlyArray<Dependency>,
	start: string,
	reached: Map<string, Dependency>,
): Array<string> {
	const next = dependencies.filter((dependency) => is_unvisited(dependency, start, reached))

	for (const dependency of next) reached.set(dependency.file, dependency)

	return next.filter((dependency) => !dependency.external).map((dependency) => dependency.file)
}

function reachable(context: GraphContext, file: string): Map<string, Dependency> {
	const reached = new Map<string, Dependency>()
	const pending = [file, ...join(context.ambient, file, reached)]

	for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
		pending.push(...join(direct_dependencies(context, current), file, reached))
	}

	return reached
}

// Named from the root rather than absolutely: a lane's seed and the gate's cache sharing rebase the
// cache file into another checkout, where an absolute name would drop every entry.
function token_of(context: GraphContext, dependency: Dependency): string {
	const name = path.relative(context.root, dependency.file)
	if (dependency.external) return name

	return `${name}:${content_hash(context, dependency.file)}`
}

function closure_hash(context: GraphContext, file: string): string {
	const tokens = [...reachable(context, file).values()].map((dependency) =>
		token_of(context, dependency),
	)

	return input_fingerprint.of_entries(tokens)
}

// The project's own files `closure_hash` reads for `file`, a package's left out.
function closure(context: GraphContext, file: string): Array<string> {
	return [...reachable(context, file).values()]
		.filter((dependency) => !dependency.external)
		.map((dependency) => dependency.file)
}

// The project's own files `file` imports directly; a package's are left out. `content` reads another
// text of the file in its place — its version at another revision — resolved from where it sits now.
function imports(context: GraphContext, file: string, content?: string): Array<string> {
	const dependencies =
		content === undefined
			? direct_dependencies(context, file)
			: references_of(context, file, content).filter((dependency) => dependency !== undefined)

	return dependencies
		.filter((dependency) => !dependency.external)
		.map((dependency) => dependency.file)
}

function append(map: Map<string, Array<string>>, key: string, value: string): void {
	const known = map.get(key)

	if (known === undefined) map.set(key, [value])
	else known.push(value)
}

function reverse_edges(
	context: GraphContext,
	universe: ReadonlyArray<string>,
	edges: Edges,
): Map<string, Array<string>> {
	const reverse = new Map<string, Array<string>>()

	for (const file of universe) {
		for (const dependency of edges(context, file)) {
			append(reverse, dependency.file, file)
		}
	}

	return reverse
}

// Every file of `universe` whose `edges` reach one of `files`, the files themselves included. Over every
// import, the only files that can name what they export, however many re-exports and aliases stand
// between; over the runtime imports, the graph the test runner walks, where a file read only through
// `import type` reaches no test past it (joshuafolkken/kit#5368).
function importers(
	context: GraphContext,
	files: ReadonlyArray<string>,
	universe: ReadonlyArray<string>,
	edges: Edges,
): ReadonlySet<string> {
	const reverse = reverse_edges(context, universe, edges)
	const reached = new Set(files)
	const pending = [...files]

	for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
		const next = (reverse.get(current) ?? []).filter((file) => !reached.has(file))

		for (const file of next) reached.add(file)
		pending.push(...next)
	}

	return reached
}

function project_module(
	context: GraphContext,
	specifier: string,
	file: string,
): Dependency | undefined {
	const dependency = resolve_module(context, specifier, file)
	if (dependency === undefined) return undefined
	const relative = path.relative(context.root, dependency.file)

	return relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? undefined : dependency
}

function graph_of(context: GraphContext): ImportGraph {
	return {
		// Type-checker suffixes need not select the source the runner executes.
		test_inputs:
			context.options.moduleSuffixes === undefined
				? import_test_inputs.create(context.typescript, (specifier, file) =>
						project_module(context, specifier, file),
					)
				: undefined,
		closure: (file) => closure(context, file),
		closure_hash: (file) => closure_hash(context, file),
		imports: (file, content) => imports(context, file, content),
		importers: (files, universe) => importers(context, files, universe, direct_dependencies),
		runtime_importers: (files, universe) =>
			importers(context, files, universe, runtime_dependencies),
		strings: (file) => type_only_imports.strings(context.typescript, file),
	}
}

// Undefined where nothing type-aware can run: no `typescript`, or no `tsconfig.json` at the root.
async function create(root: string): Promise<ImportGraph | undefined> {
	const typescript = await load_typescript()
	if (typescript === undefined) return undefined
	const parsed = parsed_config(typescript, root)
	if (parsed === undefined) return undefined

	return graph_of({
		root,
		typescript,
		options: parsed.options,
		resolution_cache: typescript.createModuleResolutionCache(root, (name) => name, parsed.options),
		ambient: ambient_of({ typescript, options: parsed.options }, root, parsed),
		dependencies: new Map(),
		runtime_dependencies: new Map(),
		content_hashes: new Map(),
	})
}

const import_graph = { create }

export type { ImportGraph }
export { import_graph }
