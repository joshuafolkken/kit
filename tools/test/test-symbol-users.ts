import {
	test_symbol_facts,
	type Binding,
	type FileFacts,
	type Resolve,
	type TypeScript,
} from './test-symbol-facts'

// A prototype of related-test selection by the users of changed functions and constants, rather than
// by every file a changed file's imports reach (joshuafolkken/kit#7979, measured for #7980). A changed
// line marks the declaration it falls in; the change travels to every declaration referencing it —
// freely inside one file, one hop per file boundary — and selects each test file it reaches. `a.b`
// on an object bundling functions reads the member `b` alone; a load-time statement reaches only the
// direct readers of its module; a namespace or dynamic import uses every export.

const { EVERY, LOAD, SEPARATOR, key_of, file_of, name_of } = test_symbol_facts
const MAX_REEXPORT_DEPTH = 16
const TEST_FILE = /\.(?:test|spec)\.ts$/u

interface Source {
	file: string
	text: string
}

interface SymbolIndex {
	facts: Map<string, FileFacts>
	users: Map<string, Set<string>>
	readers: Map<string, Set<string>>
}

interface Walk {
	index: SymbolIndex
	max_hops: number
	selected: Set<string>
	seen: Set<string>
	layer: Array<string>
	next: Array<string>
}

function add_to(map: Map<string, Set<string>>, key: string, value: string): void {
	const known = map.get(key)

	if (known === undefined) map.set(key, new Set([value]))
	else known.add(value)
}

function reexport_of(facts: FileFacts, name: string): Binding | undefined {
	const direct = facts.reexports.find((item) => item.as === name)
	if (direct !== undefined) return direct
	const star = facts.reexports.find((item) => item.as === EVERY)

	return star === undefined ? undefined : { module: star.module, name }
}

// One step of following an exported name: the module it is re-exported from, or none once `binding`
// names its declaration — an unresolved name standing for every export of its module.
function export_step(index: SymbolIndex, binding: Binding): Binding | undefined {
	const facts = index.facts.get(binding.module)

	if (facts === undefined || binding.name === EVERY || facts.exports.has(binding.name)) {
		return undefined
	}

	return reexport_of(facts, binding.name) ?? { module: binding.module, name: EVERY }
}

function declaration_key(index: SymbolIndex, binding: Binding): string {
	const local = index.facts.get(binding.module)?.exports.get(binding.name)

	return key_of(binding.module, local ?? EVERY)
}

// The declaration an imported name binds; an unresolved one stands for every export of its module.
function resolve_export(index: SymbolIndex, binding: Binding): string {
	let current = binding

	for (let depth = 0; depth < MAX_REEXPORT_DEPTH; depth += 1) {
		const step = export_step(index, current)
		if (step === undefined) return declaration_key(index, current)
		current = step
	}

	return key_of(binding.module, EVERY)
}

function name_target(index: SymbolIndex, file: string, name: string): string | undefined {
	const facts = index.facts.get(file)
	if (facts?.declarations.has(name) === true) return key_of(file, name)
	const binding = facts?.imports.get(name)

	return binding === undefined ? undefined : resolve_export(index, binding)
}

// `a.b` with `a` an object bundling functions reads the declaration behind its member `b`.
function member_target(index: SymbolIndex, container: string, member: string): string {
	const file = file_of(container)
	const local = index.facts.get(file)?.members.get(name_of(container))?.get(member)
	const target = local === undefined ? undefined : name_target(index, file, local)

	return target ?? container
}

function target_of(index: SymbolIndex, file: string, reference: string): string | undefined {
	if (reference.includes(SEPARATOR)) return reference
	const dot = reference.indexOf('.')
	if (dot === -1) return name_target(index, file, reference)
	const container = name_target(index, file, reference.slice(0, dot))

	return container === undefined
		? undefined
		: member_target(index, container, reference.slice(dot + 1))
}

function link(index: SymbolIndex, user: string, references: ReadonlySet<string>): void {
	const file = file_of(user)

	for (const reference of references) {
		const target = target_of(index, file, reference)
		if (target !== undefined && target !== user) add_to(index.users, target, user)
	}
}

function index_file(index: SymbolIndex, file: string, facts: FileFacts): void {
	for (const module of facts.modules) add_to(index.readers, module, file)
	for (const [name, item] of facts.declarations) link(index, key_of(file, name), item.references)
}

function build(
	typescript: TypeScript,
	resolve: Resolve,
	sources: ReadonlyArray<Source>,
): SymbolIndex {
	const index: SymbolIndex = { facts: new Map(), users: new Map(), readers: new Map() }

	for (const { file, text } of sources) {
		index.facts.set(file, test_symbol_facts.read_file(typescript, resolve, file, text))
	}

	for (const [file, facts] of index.facts) index_file(index, file, facts)

	return index
}

// The declarations a changed line falls in, a changed test file standing for itself.
function changed_keys(
	index: SymbolIndex,
	file: string,
	lines: ReadonlyArray<number>,
): Array<string> {
	const facts = index.facts.get(file)
	if (facts === undefined) return []
	const keys = [...facts.declarations]
		.filter(([, item]) => lines.some((line) => line >= item.start && line <= item.end))
		.map(([name]) => key_of(file, name))

	return TEST_FILE.test(file) ? [...keys, key_of(file, LOAD)] : keys
}

function is_exported(index: SymbolIndex, key: string): boolean {
	const exports = index.facts.get(file_of(key))?.exports.values() ?? []

	return [...exports].includes(name_of(key))
}

// The keys `key` reaches in one step: its users, and an exported one's whole-module users.
function users_of(index: SymbolIndex, key: string): Array<string> {
	const every = is_exported(index, key) ? (index.users.get(key_of(file_of(key), EVERY)) ?? []) : []

	return [...(index.users.get(key) ?? []), ...every]
}

// A step inside one file costs no hop; one into another file costs one.
function queue(walk: Walk, user: string, file: string): void {
	if (file_of(user) === file) walk.layer.push(user)
	else walk.next.push(user)
}

// A load-time change reaches the test files reading its module directly, and no further.
function load_readers(walk: Walk, key: string, hops: number): Array<string> {
	const file = file_of(key)
	if (hops >= walk.max_hops || !name_of(key).startsWith(LOAD)) return []

	return [...(walk.index.readers.get(file) ?? [])].filter((reader) => TEST_FILE.test(reader))
}

function visit(walk: Walk, key: string, hops: number): void {
	const file = file_of(key)

	walk.seen.add(key)
	if (TEST_FILE.test(file)) walk.selected.add(file)
	for (const reader of load_readers(walk, key, hops)) walk.selected.add(reader)
	const unseen = users_of(walk.index, key).filter((user) => !walk.seen.has(user))

	for (const user of unseen) queue(walk, user, file)
}

function drain(walk: Walk, hops: number): void {
	for (let key = walk.layer.pop(); key !== undefined; key = walk.layer.pop()) {
		if (!walk.seen.has(key)) visit(walk, key, hops)
	}

	walk.layer = walk.next
	walk.next = []
}

// The test files a change to `seeds` reaches within `max_hops` file boundaries, walked in rounds of
// one hop so that each key is visited at the fewest hops it can be reached in.
function select(index: SymbolIndex, seeds: ReadonlyArray<string>, max_hops: number): Set<string> {
	const walk: Walk = {
		index,
		max_hops,
		selected: new Set(),
		seen: new Set(),
		layer: [...seeds],
		next: [],
	}

	for (let hops = 0; hops <= max_hops && walk.layer.length > 0; hops += 1) {
		drain(walk, hops)
	}

	return walk.selected
}

// Today's selection, for comparison: every test file whose runtime imports reach a changed file.
function import_reach(index: SymbolIndex, files: ReadonlyArray<string>): Set<string> {
	const reached = new Set(files)
	const pending = [...files]

	for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
		const readers = [...(index.readers.get(file) ?? [])].filter((reader) => !reached.has(reader))

		for (const reader of readers) reached.add(reader)
		pending.push(...readers)
	}

	return new Set([...reached].filter((file) => TEST_FILE.test(file)))
}

const test_symbol_users = { build, changed_keys, select, import_reach }

export type { Source, SymbolIndex }
export { test_symbol_users }
