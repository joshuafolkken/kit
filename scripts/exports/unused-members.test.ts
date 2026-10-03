import { describe, expect, it } from 'vitest'
import { unused_members } from './unused-members'
import { unused_members_fixture, type FixtureFile } from './unused-members-fixture'

const { create_project, with_reader, LIBRARY, READ_KEPT } = unused_members_fixture
const LIBRARY_LINE = 3
const READ_DROPPED = 'export const other = library.dropped()'

function unused_names(files: ReadonlyArray<FixtureFile>): Array<string> {
	return unused_members
		.find_unused_members(create_project(files))
		.map((member) => `${member.namespace}.${member.member}`)
}

describe('unused_members.find_unused_members — reporting', () => {
	it('reports a namespace member nothing reads, with its file and line', () => {
		const [member, ...rest] = unused_members.find_unused_members(
			create_project(with_reader(READ_KEPT)),
		)

		expect(rest).toStrictEqual([])
		expect(member?.namespace).toBe('library')
		expect(member?.member).toBe('dropped')
		expect(member?.file.endsWith('library.ts')).toBe(true)
		expect(member?.line).toBe(LIBRARY_LINE)
	})

	it('still reports a member when the namespace is only aliased or nested in another', () => {
		const names = unused_names(
			with_reader(
				'const alias = library\nconst outer = { library }\nexport const value = alias.kept() + outer.library.kept()\nexport { outer }',
			),
		)

		expect(names).toStrictEqual(['library.dropped'])
	})
})

describe('unused_members.find_unused_members — uses', () => {
	it.each([
		['a property access', 'export const value = library.kept() + library.dropped()'],
		[
			'a destructuring',
			'const { kept, dropped } = library\nexport const value = kept() + dropped()',
		],
		['a string-keyed access', "export const value = library.kept() + library['dropped']()"],
		[
			'a spy naming the member by string',
			`declare function spy_on(holder: object, name: string): void\nspy_on(library, 'dropped')\n${READ_KEPT}`,
		],
	])('counts %s as a use', (_label, reader) => {
		expect(unused_names(with_reader(reader))).toStrictEqual([])
	})

	it('counts a reference from a root config file outside the tsconfig include as a use', () => {
		const config_reader = with_reader(READ_DROPPED, 'vitest.config.ts')

		expect(unused_names([...with_reader(READ_KEPT), ...config_reader])).toStrictEqual([])
	})

	it('counts a reference made only from a test file as a use', () => {
		const test_reader = with_reader(READ_DROPPED, 'library.test.ts')

		expect(unused_names([...with_reader(READ_KEPT), ...test_reader])).toStrictEqual([])
	})
})

describe('unused_members.find_unused_members — escapes and scope', () => {
	it.each([
		['spread into another object', 'export const copy = { ...library }'],
		['passed as a value', 'declare function take(value: object): void\ntake(library)'],
		[
			'passed as a value through an alias',
			'declare function take(value: object): void\nconst alias = library\nconst again = alias\ntake(again)',
		],
		[
			'read through a computed key',
			"declare const key: 'kept' | 'dropped'\nexport const value = library[key]()",
		],
	])('treats every member as used once the namespace is %s', (_label, reader) => {
		expect(unused_names(with_reader(reader))).toStrictEqual([])
	})

	it.each<[string, FixtureFile]>([
		['a public index.ts entry', ['index.ts', LIBRARY]],
		['an UPPER_CASE constant', ['table.ts', 'const TABLE = { a: 1 }\nexport { TABLE }']],
		[
			'a type-annotated table',
			['table.ts', 'const table: Record<string, number> = { a: 1 }\nexport { table }'],
		],
		['an object never exported', ['local.ts', 'const local = { a: 1 }\nexport const b = 2']],
	])('does not scan %s', (_label, file) => {
		expect(unused_names([file])).toStrictEqual([])
	})
})

describe('unused_members.find_unused_members — escapes of a nested namespace', () => {
	const NESTED =
		'declare function take(value: object): void\nconst outer = { library }\nexport { outer }\n'

	it.each([
		['the namespace holding it escapes', 'take(outer)'],
		['it is passed as a value as a member', 'take(outer.library)'],
		['an alias of it as a member is passed as a value', 'const alias = outer.library\ntake(alias)'],
	])('treats every member as used once %s', (_label, reader) => {
		expect(unused_names(with_reader(`${NESTED}${reader}`))).toStrictEqual([])
	})
})
