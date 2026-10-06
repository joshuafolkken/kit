import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { member_usage, type MemberUsage } from './member-usage'
import { namespace_members, type Namespace } from './namespace-members'
import { unused_members_fixture, type FixtureFile } from './unused-members-fixture'

const { create_project, with_reader, PROGRAM_OPTIONS, READ_KEPT } = unused_members_fixture
const TAKE = 'declare function take(value: unknown): void\n'
const TAKE_TWO = 'declare function take(value: unknown, other: unknown): void\n'
const OUTER = 'const outer = { library }\nexport { outer }\n'
const KEPT = 'library.kept'
const DROPPED = 'library.dropped'
const UNKNOWN = '?'

// What one pass found, by name: the namespace members some reference resolved to, the namespaces
// that escaped, and each namespace mapped to the names of the namespaces nested in its literal.
interface UsageNames {
	used: Array<string>
	escaped: Array<string>
	nested: Record<string, Array<string>>
}

interface Analysis {
	namespaces: Array<Namespace>
	usage: MemberUsage
}

function analyze(files: ReadonlyArray<FixtureFile>): Analysis {
	const root = create_project(files)
	const root_names = files.map(([relative]) => path.join(root, relative))
	const program = ts.createProgram({ rootNames: root_names, options: PROGRAM_OPTIONS })
	const sources = program.getSourceFiles().filter((source) => !source.isDeclarationFile)
	const namespaces = sources.flatMap((source) => namespace_members.collect_namespaces(source))
	const scope = {
		checker: program.getTypeChecker(),
		declarations: new Set<ts.Node>(namespaces.map((namespace) => namespace.declaration)),
		literals: new Map<ts.Node, ts.Node>(
			namespaces.map((namespace) => [namespace.literal, namespace.declaration]),
		),
	}

	return { namespaces, usage: member_usage.collect_usage(scope, sources) }
}

function to_names({ namespaces, usage }: Analysis): UsageNames {
	const names = new Map<ts.Node, string>(
		namespaces.map((namespace) => [namespace.declaration, namespace.declaration.name.getText()]),
	)

	function name_of(node: ts.Node): string {
		return names.get(node) ?? UNKNOWN
	}

	return {
		used: namespaces
			.flatMap((namespace) => namespace.members)
			.filter((member) => usage.used.has(member.declaration))
			.map((member) => `${member.namespace}.${member.member}`),
		escaped: [...usage.escaped]
			.map((node) => name_of(node))
			.toSorted((left, right) => left.localeCompare(right)),
		nested: Object.fromEntries(
			[...usage.nested].map(([outer, inners]) => [
				name_of(outer),
				inners.map((inner) => name_of(inner)),
			]),
		),
	}
}

function usage_of(reader: string): UsageNames {
	return to_names(analyze(with_reader(reader)))
}

describe('member_usage.collect_usage — members a reference names', () => {
	it('marks only the member a property access reads', () => {
		expect(usage_of(READ_KEPT)).toStrictEqual({ used: [KEPT], escaped: [], nested: {} })
	})

	it.each([
		['a string-keyed access', "library['dropped']()"],
		['a template-keyed access', 'library[`dropped`]()'],
		['a destructuring', 'const { dropped } = library\ndropped()'],
		['a renamed destructuring', 'const { dropped: renamed } = library\nrenamed()'],
		['a string-keyed destructuring', "const { 'dropped': renamed } = library\nrenamed()"],
		[
			'a spy naming the member by string',
			"declare function spy_on(holder: object, name: string): void\nspy_on(library, 'dropped')",
		],
	])('marks a member read by %s without escaping the namespace', (_label, reader) => {
		expect(usage_of(reader)).toStrictEqual({ used: [DROPPED], escaped: [], nested: {} })
	})

	it('marks a member read through a namespace nested in another', () => {
		const names = usage_of(`${OUTER}export const value = outer.library.dropped()`)

		expect(names.used).toStrictEqual([DROPPED, 'outer.library'])
		expect(names.escaped).toStrictEqual([])
	})

	it('marks no member for a string argument with no holder before it', () => {
		const reader = "declare function name_only(name: string): void\nname_only('dropped')"

		expect(usage_of(reader)).toStrictEqual({ used: [], escaped: [], nested: {} })
	})
})

describe('member_usage.collect_usage — what else a pass marks', () => {
	it('marks no member for a rest element, so a member only a rest captures stays unmarked', () => {
		const reader = 'const { kept, ...rest } = library\nexport const value = [kept, rest]'

		expect(usage_of(reader)).toStrictEqual({ used: [KEPT], escaped: [], nested: {} })
	})

	it('records the declaration of a non-namespace property a reference resolves to as well', () => {
		const { usage } = analyze(
			with_reader('const local = { field: 1 }\nexport const value = local.field'),
		)
		const texts = [...usage.used].map((node) => node.getText())

		expect(texts).toContain('field: 1')
	})
})

describe('member_usage.collect_usage — escapes', () => {
	it.each([
		['passed as a value', `${TAKE}take(library)`],
		['spread into an object', 'export const copy = { ...library }'],
		['returned', 'export function get(): object { return library }'],
		['read through a computed key', "declare const key: 'kept' | 'dropped'\nlibrary[key]()"],
		['re-exported from another module', "export { library as again } from './library'"],
		['passed through an alias', `${TAKE}const alias = library\nconst again = alias\ntake(again)`],
		[
			'passed through an alias of a nested member',
			`${TAKE}${OUTER}const alias = outer.library\ntake(alias)`,
		],
		['passed as a nested member', `${TAKE}${OUTER}take(outer.library)`],
		['placed in an object that is no namespace', `${TAKE}const holder = { library }\ntake(holder)`],
		['passed before a non-string argument', `${TAKE_TWO}take(library, 1)`],
	])('escapes the namespace once it is %s', (_label, reader) => {
		expect(usage_of(reader).escaped).toContain('library')
	})

	it.each([
		['aliased and never handed on', 'const alias = library\nexport const value = alias.kept()'],
		['imported', ''],
		['only exported by its own module', READ_KEPT],
	])('keeps the namespace contained when it is %s', (_label, reader) => {
		expect(usage_of(reader).escaped).toStrictEqual([])
	})

	it('stops on a cyclic alias without escaping anything', () => {
		const reader = `${TAKE}const first: unknown = second\nconst second: unknown = first\ntake(first)`

		expect(usage_of(reader).escaped).toStrictEqual([])
	})
})

describe('member_usage.collect_usage — namespaces nested in a namespace', () => {
	it('records a namespace placed as a shorthand member without escaping it', () => {
		expect(usage_of(OUTER)).toStrictEqual({ used: [], escaped: [], nested: { outer: ['library'] } })
	})

	// Pins current behavior: the key identifier itself resolves, through the property it declares,
	// to the namespace and is not a contained use, so a keyed placement escapes the namespace.
	it('records a namespace placed as a keyed member and also escapes it', () => {
		const reader = 'const outer = { key: library }\nexport { outer }\n'

		expect(usage_of(reader)).toStrictEqual({
			used: [],
			escaped: ['library'],
			nested: { outer: ['library'] },
		})
	})

	it('escapes every nested namespace, however deep, once the outermost escapes', () => {
		const reader = `${TAKE}${OUTER}const top = { outer }\nexport { top }\ntake(top)`
		const names = usage_of(reader)

		expect(names.escaped).toStrictEqual(['library', 'outer', 'top'])
		expect(names.nested).toStrictEqual({ outer: ['library'], top: ['outer'] })
	})

	it('records every namespace one literal holds', () => {
		const second: FixtureFile = ['second.ts', 'const second = { item: 1 }\nexport { second }']
		const reader =
			"import { second } from './second'\nconst outer = { library, second }\nexport { outer }"
		const names = to_names(analyze([...with_reader(reader), second]))

		expect(names.nested).toStrictEqual({ outer: ['library', 'second'] })
	})
})
