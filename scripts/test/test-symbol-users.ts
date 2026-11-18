import { test_declared_logic } from './test-declared-logic'
import type { Binding, BindingSpan, Reexport, Resolve, TypeScript } from './test-symbol-bindings'
import { test_symbol_facts, type FileFacts } from './test-symbol-facts'
import { test_symbol_whole } from './test-symbol-whole'

// **Related-test selection by the users of changed functions and constants**, rather than by every
// file a changed file's imports reach (joshuafolkken/kit#7980, measured in #7979). A changed line marks
// the declaration it falls in; the change travels to every declaration referencing it — freely inside
// one file, one hop per file boundary — and selects each test file it reaches. `a.b` on an object
// literal reads the member `b` alone; a load-time statement reaches only the direct test readers of
// its module; a namespace or dynamic import uses every export. A `stops` key — a hub most of the code
// reads, such as the command map — passes the change to its direct test users alone.

const { EVERY, LOAD, SEPARATOR, key_of, file_of, name_of } = test_symbol_facts
const MAX_REEXPORT_DEPTH = 16
const { is_test_file } = test_declared_logic

interface Source {
	file: string
	text: string
}

interface SymbolIndex {
	facts: Map<string, FileFacts>
	users: Map<string, Set<string>>
	readers: Map<string, Set<string>>
}

// How far a change travels: `max_hops` file boundaries, and no further than the direct test users of a
// `stops` key.
interface Reach {
	max_hops: number
	stops: ReadonlySet<string>
}

// A run of lines: a declaration's or a binding statement's.
interface Span {
	start: number
	end: number
}

interface Walk extends Reach {
	index: SymbolIndex
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

// Whether `module` declares or re-exports `name` by name, so a star barrel's name is found in the
// module that has it rather than in its first star.
function names_export(index: SymbolIndex, module: string, name: string): boolean {
	const facts = index.facts.get(module)

	return (
		facts?.exports.has(name) === true || facts?.reexports.some((item) => item.as === name) === true
	)
}

function reexport_of(index: SymbolIndex, facts: FileFacts, name: string): Binding | undefined {
	const direct = facts.reexports.find((item) => item.as === name)
	if (direct !== undefined) return direct
	const stars = facts.reexports.filter((item) => item.as === EVERY)
	const star = stars.find((item) => names_export(index, item.module, name)) ?? stars[0]

	return star === undefined ? undefined : { module: star.module, name }
}

// One step of following an exported name: the module it is re-exported from, or none once `binding`
// names its declaration — an unresolved name standing for every export of its module.
function export_step(index: SymbolIndex, binding: Binding): Binding | undefined {
	const facts = index.facts.get(binding.module)

	if (facts === undefined || binding.name === EVERY || facts.exports.has(binding.name)) {
		return undefined
	}

	return reexport_of(index, facts, binding.name) ?? { module: binding.module, name: EVERY }
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

// The declaration a re-export passes on — every export of its module for `export *`.
function reexport_target(index: SymbolIndex, binding: Binding): string {
	return binding.name === EVERY ? key_of(binding.module, EVERY) : resolve_export(index, binding)
}

// A barrel's whole-module readers — `import('./barrel')`, `import * as` — use what it re-exports.
function index_file(index: SymbolIndex, file: string, facts: FileFacts): void {
	for (const module of facts.modules) add_to(index.readers, module, file)
	for (const [name, item] of facts.declarations) link(index, key_of(file, name), item.references)

	for (const item of facts.reexports) {
		add_to(index.users, reexport_target(index, item), key_of(file, EVERY))
	}
}

// A `.svelte` component read whole, any other source by its syntax.
function facts_of(typescript: TypeScript, resolve: Resolve, source: Source): FileFacts {
	const { file, text } = source

	return test_symbol_whole.is_whole(file)
		? test_symbol_whole.read_whole(resolve, file, text)
		: test_symbol_facts.read_file(typescript, resolve, file, text)
}

function build(
	typescript: TypeScript,
	resolve: Resolve,
	sources: ReadonlyArray<Source>,
): SymbolIndex {
	const index: SymbolIndex = { facts: new Map(), users: new Map(), readers: new Map() }

	for (const { file, text } of sources) {
		index.facts.set(file, facts_of(typescript, resolve, { file, text }))
	}

	for (const [file, facts] of index.facts) index_file(index, file, facts)

	return index
}

function is_hit(span: Span, lines: ReadonlyArray<number>): boolean {
	return lines.some((line) => line >= span.start && line <= span.end)
}

function uses_name(references: ReadonlySet<string>, name: string): boolean {
	return [...references].some((reference) => reference === name || reference.startsWith(`${name}.`))
}

// What a re-export passes on: the declaration it names, or every export of a `export *` module.
function passed_on(index: SymbolIndex, item: Reexport): Array<string> {
	if (item.name !== EVERY) return [resolve_export(index, item)]
	const exports = index.facts.get(item.module)?.exports.values() ?? []

	return [...exports].map((name) => key_of(item.module, name))
}

// A changed import seeds its file's declarations using a name it binds; a changed re-export, what it
// passes on — so a swapped module or binding selects the users of the code it now reaches.
function binding_keys(index: SymbolIndex, file: string, span: BindingSpan): Array<string> {
	const declarations = [...(index.facts.get(file)?.declarations ?? [])]
	const users = declarations
		.filter(([, item]) => span.imports.some((name) => uses_name(item.references, name)))
		.map(([name]) => key_of(file, name))

	return [...users, ...span.reexports.flatMap((item) => passed_on(index, item))]
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
		.filter(([, item]) => is_hit(item, lines))
		.map(([name]) => key_of(file, name))
	const bound = facts.spans
		.filter((span) => is_hit(span, lines))
		.flatMap((span) => binding_keys(index, file, span))
	const all = [...keys, ...bound]

	return is_test_file(file) ? [...all, key_of(file, LOAD)] : all
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

	return [...(walk.index.readers.get(file) ?? [])].filter((reader) => is_test_file(reader))
}

// The users a change to `key` travels on to: a stop passes it to its test users alone.
function next_users(walk: Walk, key: string): Array<string> {
	const unseen = users_of(walk.index, key).filter((user) => !walk.seen.has(user))
	if (!walk.stops.has(key)) return unseen

	return unseen.filter((user) => is_test_file(file_of(user)))
}

function visit(walk: Walk, key: string, hops: number): void {
	const file = file_of(key)

	walk.seen.add(key)
	if (is_test_file(file)) walk.selected.add(file)
	for (const reader of load_readers(walk, key, hops)) walk.selected.add(reader)
	for (const user of next_users(walk, key)) queue(walk, user, file)
}

function drain(walk: Walk, hops: number): void {
	for (let key = walk.layer.pop(); key !== undefined; key = walk.layer.pop()) {
		if (!walk.seen.has(key)) visit(walk, key, hops)
	}

	walk.layer = walk.next
	walk.next = []
}

// The test files a change to `seeds` reaches, walked in rounds of one hop so that each key is visited
// at the fewest hops it can be reached in.
function select(index: SymbolIndex, seeds: ReadonlyArray<string>, reach: Reach): Set<string> {
	const walk: Walk = {
		...reach,
		index,
		selected: new Set(),
		seen: new Set(),
		layer: [...seeds],
		next: [],
	}

	for (let hops = 0; hops <= reach.max_hops && walk.layer.length > 0; hops += 1) {
		drain(walk, hops)
	}

	return walk.selected
}

const test_symbol_users = { build, changed_keys, select }

export type { Reach, Source, SymbolIndex }
export { test_symbol_users }
