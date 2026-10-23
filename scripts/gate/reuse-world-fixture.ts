import path from 'node:path'

// joshuafolkken/kit#4494: the checkout the reuse property tests walk — its files, the merge base the
// branch sits on, and what each main sync brought in. Every write carries a revision no earlier write
// carried, so a path's content differs from a recorded one exactly when something changed it since.
//
// **The reference model is what moved since the last green record**: every path whose content now
// differs from the recorded one, a main sync's own changes included. A verdict may reuse a green
// result only when none of the paths it reads is among them.

type Kind = 'module' | 'declaration' | 'globals' | 'doc' | 'style' | 'asset' | 'config'

interface Snapshot {
	contents: ReadonlyMap<string, string>
	base: number
}

interface World {
	contents: Map<string, string>
	base_contents: Map<string, string>
	imports: Map<string, ReadonlyArray<string>>
	// The paths each main sync changed, in order; the merge base is how many have run.
	upstream: Array<ReadonlyArray<string>>
	revision: number
	recorded: Snapshot
}

type Render = (tag: string) => string

const MANIFEST = 'package.json'
const LOCKFILE = 'pnpm-lock.yaml'
const TSCONFIG = 'tsconfig.json'
const ESLINT_CONFIG = 'eslint.config.js'
const CONFIG_FILES: ReadonlyArray<string> = [MANIFEST, LOCKFILE, TSCONFIG, ESLINT_CONFIG]
const GLOBALS = 'src/globals.ts'
const DECLARATION_SUFFIX = '.d.ts'
const MODULE_EXTENSION = '.ts'
const DELETED = 'deleted'
const BASE_PREFIX = 'base-'
const KIND_BY_EXTENSION: ReadonlyMap<string, Kind> = new Map([
	[MODULE_EXTENSION, 'module'],
	['.md', 'doc'],
	['.css', 'style'],
])
const INITIAL_IMPORTS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
	['src/m0.ts', []],
	['src/m1.ts', ['src/m0.ts']],
	['src/m2.ts', ['src/m1.ts']],
	['src/m3.ts', []],
]
const INITIAL_FILES: ReadonlyArray<string> = [
	...CONFIG_FILES,
	GLOBALS,
	'types/g0.d.ts',
	'docs/guide.md',
	'src/style.css',
	'assets/notes.txt',
]
// The branch's own change when the walk starts: a gate tree is never empty, which no gate reuses.
const BRANCH_EDIT = 'src/m3.ts'

const TSCONFIG_BODY =
	'{ "compilerOptions": { "module": "esnext", "moduleResolution": "bundler", "strict": true, "types": [] }, "include": ["src/**/*.ts", "types/**/*.ts"] }\n'

const RENDERERS: ReadonlyMap<string, Render> = new Map<string, Render>([
	[MANIFEST, (tag) => `{ "name": "reuse-world", "description": "${tag}" }\n`],
	[LOCKFILE, (tag) => `# ${tag}\nlockfileVersion: '9.0'\n`],
	[TSCONFIG, (tag) => `// ${tag}\n${TSCONFIG_BODY}`],
	[ESLINT_CONFIG, (tag) => `// ${tag}\nexport default []\n`],
	['declaration', (tag) => `// ${tag}\ndeclare const reuse_world: string\n`],
	['globals', (tag) => `export {}\ndeclare global {\n\tvar reuse_world: string\n}\n// ${tag}\n`],
	['doc', (tag) => `# ${tag}\n`],
	['style', (tag) => `/* ${tag} */\n`],
	['asset', (tag) => `${tag}\n`],
])

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function kind_of(relative: string): Kind {
	if (CONFIG_FILES.includes(relative)) return 'config'
	if (relative.endsWith(DECLARATION_SUFFIX)) return 'declaration'
	if (relative === GLOBALS) return 'globals'

	return KIND_BY_EXTENSION.get(path.extname(relative)) ?? 'asset'
}

function import_line(imported: string, index: number): string {
	const name = path.basename(imported, MODULE_EXTENSION)

	return `import { value as value_${String(index)} } from './${name}'\n`
}

function render_module(tag: string, imports: ReadonlyArray<string>): string {
	const lines = imports.map((imported, index) => import_line(imported, index))

	return `${lines.join('')}export const value = '${tag}'\n`
}

function render(world: World, relative: string): string {
	world.revision += 1
	const tag = `rev ${String(world.revision)}`
	const kind = kind_of(relative)
	if (kind === 'module') return render_module(tag, world.imports.get(relative) ?? [])
	const renderer = RENDERERS.get(kind === 'config' ? relative : kind)

	return renderer === undefined ? tag : renderer(tag)
}

function snapshot(world: World): Snapshot {
	return { contents: new Map(world.contents), base: world.upstream.length }
}

function write(world: World, relative: string): void {
	world.contents.set(relative, render(world, relative))
}

function create_world(): World {
	const world: World = {
		contents: new Map(),
		base_contents: new Map(),
		imports: new Map(INITIAL_IMPORTS),
		upstream: [],
		revision: 0,
		recorded: { contents: new Map(), base: 0 },
	}

	for (const relative of [...world.imports.keys(), ...INITIAL_FILES]) write(world, relative)
	world.base_contents = new Map(world.contents)
	write(world, BRANCH_EDIT)
	world.recorded = snapshot(world)

	return world
}

function all_paths(...maps: ReadonlyArray<ReadonlyMap<string, string>>): ReadonlyArray<string> {
	return [...new Set(maps.flatMap((map) => [...map.keys()]))].toSorted(by_name)
}

// What moved since the last green record — the reference every verdict is held to.
function moved(world: World): ReadonlyArray<string> {
	const { contents } = world.recorded

	return all_paths(contents, world.contents).filter(
		(relative) => contents.get(relative) !== world.contents.get(relative),
	)
}

function is_branch_change(world: World, relative: string): boolean {
	return world.contents.get(relative) !== world.base_contents.get(relative)
}

// The gate tree: each path the branch changed against its merge base, keyed to its content.
function tree_of(world: World): Record<string, string> {
	const changed = all_paths(world.contents, world.base_contents).filter((relative) =>
		is_branch_change(world, relative),
	)

	return Object.fromEntries(
		changed.map((relative) => [relative, world.contents.get(relative) ?? DELETED]),
	)
}

function base_name(base: number): string {
	return `${BASE_PREFIX}${String(base)}`
}

// What `git diff <from> <to>` names between two merge bases of the walk.
function upstream_between(world: World, from: number, to: number): ReadonlyArray<string> {
	return world.upstream.slice(Math.min(from, to), Math.max(from, to)).flat()
}

const reuse_world = {
	all_paths,
	base_name,
	by_name,
	create_world,
	is_branch_change,
	kind_of,
	moved,
	snapshot,
	tree_of,
	upstream_between,
	write,
}

export type { Kind, Snapshot, World }
export { BASE_PREFIX, CONFIG_FILES, ESLINT_CONFIG, LOCKFILE, reuse_world, TSCONFIG }
