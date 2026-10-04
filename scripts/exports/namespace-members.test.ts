import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { namespace_members, type Namespace } from './namespace-members'

const FILE = '/project/library.ts'
const MEMBER_LINE = 3

function parse(text: string, file = FILE): ts.SourceFile {
	return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
}

function member_names(text: string, file = FILE): Array<string> {
	return namespace_members
		.collect_namespaces(parse(text, file))
		.flatMap((namespace) => namespace.members)
		.map((member) => `${member.namespace}.${member.member}`)
}

function only_namespace(source: ts.SourceFile): Namespace {
	const namespaces = namespace_members.collect_namespaces(source)
	const [namespace] = namespaces

	expect(namespaces).toHaveLength(1)
	if (namespace === undefined) throw new Error('expected one namespace')

	return namespace
}

describe('namespace_members.collect_namespaces — a scanned namespace', () => {
	const SOURCE = 'function a(): void {}\nconst lib = {\n\ta,\n\tb: 1,\n}\nexport { lib }'

	it('returns the declaration and the literal it declares', () => {
		const source = parse(SOURCE)
		const namespace = only_namespace(source)

		expect(namespace.declaration.name.getText(source)).toBe('lib')
		expect(namespace.declaration.initializer).toBe(namespace.literal)
	})

	it('returns every member with its namespace, file, one-based line and declaration node', () => {
		const namespace = only_namespace(parse(SOURCE))

		expect(
			namespace.members.map(({ namespace: name, member, file, line }) => ({
				name,
				member,
				file,
				line,
			})),
		).toStrictEqual([
			{ name: 'lib', member: 'a', file: FILE, line: MEMBER_LINE },
			{ name: 'lib', member: 'b', file: FILE, line: MEMBER_LINE + 1 },
		])
		expect(namespace.members.map((member) => member.declaration)).toStrictEqual([
			...namespace.literal.properties,
		])
	})
})

describe('namespace_members.collect_namespaces — member names', () => {
	it('reads every member kind that carries a name', () => {
		const text =
			"const lib = { short, named: 1, 'quoted-key': 2, 3: 4, method(): void {}, get getter(): number { return 1 } }\nexport { lib }"

		expect(member_names(text)).toStrictEqual([
			'lib.short',
			'lib.named',
			'lib.quoted-key',
			'lib.3',
			'lib.method',
			'lib.getter',
		])
	})

	it('skips a spread and a computed key, which name no member', () => {
		const text = "const lib = { ...other, ['computed']: 1, [key]: 2, kept: 3 }\nexport { lib }"

		expect(member_names(text)).toStrictEqual(['lib.kept'])
	})
})

describe('namespace_members.collect_namespaces — declaration forms', () => {
	it.each([
		['as const', 'const lib = { a: 1 } as const'],
		['satisfies', 'const lib = { a: 1 } satisfies object'],
		['parentheses', 'const lib = ({ a: 1 })'],
		['nested wrappers', 'const lib = (({ a: 1 }) as const) satisfies object'],
		['let', 'let lib = { a: 1 }'],
	])('unwraps a literal declared with %s', (_label, declaration) => {
		expect(member_names(`${declaration}\nexport { lib }`)).toStrictEqual(['lib.a'])
	})

	it('names the namespace by its local name when exported under an alias', () => {
		expect(member_names('const lib = { a: 1 }\nexport { lib as renamed }')).toStrictEqual(['lib.a'])
	})

	it('reads every exported namespace of one declaration list', () => {
		const text = 'const first = { a: 1 }, second = { b: 2 }\nexport { first, second }'

		expect(member_names(text)).toStrictEqual(['first.a', 'second.b'])
	})

	it('returns a namespace with no members for an empty literal', () => {
		expect(only_namespace(parse('const lib = {}\nexport { lib }')).members).toStrictEqual([])
	})
})

describe('namespace_members.collect_namespaces — what is not a namespace', () => {
	it.each([
		['an UPPER_CASE constant', 'const LIB = { a: 1 }\nexport { LIB }'],
		['a camelCase name', 'const myLib = { a: 1 }\nexport { myLib }'],
		['a name starting with an underscore', 'const _lib = { a: 1 }\nexport { _lib }'],
		['a type-annotated table', 'const lib: Record<string, number> = { a: 1 }\nexport { lib }'],
		['an object never exported', 'const lib = { a: 1 }\nexport const other = 2'],
		['a type-only export', 'const lib = { a: 1 }\nexport type { lib }'],
		['a re-export from another module', "const lib = { a: 1 }\nexport { lib } from './other'"],
		['an inline export modifier', 'export const lib = { a: 1 }'],
		['a non-object initializer', 'const lib = [1]\nexport { lib }'],
		['a declaration with no initializer', 'let lib: { a: number }\nexport { lib }'],
		['a destructuring declaration', 'const { lib } = { lib: { a: 1 } }\nexport { lib }'],
		['a literal behind a call', 'const lib = Object.freeze({ a: 1 })\nexport { lib }'],
		[
			'an object declared inside a function',
			'function f(): void { const lib = { a: 1 } }\nexport { f }',
		],
	])('ignores %s', (_label, text) => {
		expect(namespace_members.collect_namespaces(parse(text))).toStrictEqual([])
	})
})

describe('namespace_members.collect_namespaces — which files are scanned', () => {
	const EXPORTED = 'const lib = { a: 1 }\nexport { lib }'

	it.each([
		['a public index.ts entry', '/project/index.ts'],
		['a nested index.ts entry', '/project/src/lib/index.ts'],
		['a JavaScript file', '/project/library.js'],
		['a TSX file', '/project/library.tsx'],
		['an .mts file', '/project/library.mts'],
	])('skips %s', (_label, file) => {
		expect(member_names(EXPORTED, file)).toStrictEqual([])
	})

	it.each([
		['a file merely ending in index.ts', '/project/my-index.ts'],
		['a declaration file', '/project/library.d.ts'],
		['a test file', '/project/library.test.ts'],
	])('scans %s', (_label, file) => {
		expect(member_names(EXPORTED, file)).toStrictEqual(['lib.a'])
	})
})
