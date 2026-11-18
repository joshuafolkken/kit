import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_symbol_users, type Reach, type Source } from './test-symbol-users'

const FULL: Reach = { max_hops: Infinity, stops: new Set() }
const ONE_HOP: Reach = { max_hops: 1, stops: new Set() }
const MATH = 'math.ts'
const MATH_TEST = 'math.test.ts'
const SUB_TEST = 'sub.test.ts'
const TOTAL_TEST = 'total.test.ts'
const DEV_TEST = 'dev.test.ts'
const TABLE_TEST = 'table.test.ts'
const STOP_TEST = 'stop.test.ts'
const HUB_TEST = 'hub.test.ts'
const LIB = 'lib.ts'
const LIB_TEST = 'lib.test.ts'
const NAMED = 'named.ts'
const STARRED = 'starred.ts'
const RUN_EXPORT = 'export { run }'
const NAMED_TEST = 'named.test.ts'
const STARRED_TEST = 'starred.test.ts'
const CLI_TEST = 'cli.test.ts'
const REGISTRY = 'registry.ts'
const DIRECT_TEST = 'direct.test.ts'
const LIMIT_TEST = 'limit.test.ts'
const BETA_TEST = 'beta.test.ts'
const GREET_TEST = 'greet.test.ts'
const DYNAMIC_TEST = 'dynamic.test.ts'
const STAR_TEST = 'star.test.ts'

function source(file: string, ...lines: Array<string>): Source {
	return { file, text: `${lines.join('\n')}\n` }
}

function import_of(name: string, module: string): string {
	return `import { ${name} } from './${module}'`
}

function by_path(first: string, second: string): number {
	return first.localeCompare(second)
}

const SOURCES: Array<Source> = [
	source(
		MATH,
		'function add(a: number, b: number): number {',
		'\treturn a + b',
		'}',
		'',
		'function sub(a: number, b: number): number {',
		'\treturn a - b',
		'}',
		'',
		'const math = { add, sub }',
		'',
		'export { math }',
	),
	source('barrel.ts', `export * from './math'`),
	source(
		'total.ts',
		`import { math } from './math'`,
		'function total(values: Array<number>): number {',
		'\treturn values.reduce(math.add, 0)',
		'}',
		'export { total }',
	),
	source(MATH_TEST, `import { math } from './math'`, `it('adds', () => math.add(1, 2))`),
	source(SUB_TEST, `import { math } from './barrel'`, `it('subtracts', () => math.sub(1, 2))`),
	source(TOTAL_TEST, `import { total } from './total'`, `it('totals', () => total([1]))`),
]

function resolve(specifier: string): string | undefined {
	return specifier.startsWith('./') ? `${specifier.slice('./'.length)}.ts` : undefined
}

function selected_in(
	sources: ReadonlyArray<Source>,
	file: string,
	lines: Array<number>,
	reach: Reach = FULL,
): Array<string> {
	const index = test_symbol_users.build(ts, resolve, sources)
	const seeds = test_symbol_users.changed_keys(index, file, lines)

	return [...test_symbol_users.select(index, seeds, reach)].toSorted(by_path)
}

describe('test_symbol_users.select — users of changed declarations', () => {
	it('selects only the direct test users of a changed function within one hop', () => {
		expect(selected_in(SOURCES, MATH, [2], ONE_HOP)).toEqual([MATH_TEST])
	})

	it('reaches the test of a user in another file when walked in full', () => {
		expect(selected_in(SOURCES, MATH, [2])).toEqual([MATH_TEST, TOTAL_TEST])
	})

	it('selects the users of an unchanged sibling only when the sibling changes', () => {
		expect(selected_in(SOURCES, MATH, [6])).toEqual([SUB_TEST])
	})

	it('selects nothing for a line outside every declaration', () => {
		expect(selected_in(SOURCES, MATH, [4])).toEqual([])
	})
})

const PORTS: Array<Source> = [
	source(
		'ports.ts',
		'const DEV = 5173',
		'const PREVIEW = 4173',
		'const LIVE_PORTS = { dev: DEV, preview: PREVIEW }',
		'export { LIVE_PORTS }',
	),
	source(DEV_TEST, import_of('LIVE_PORTS', 'ports'), 'it("dev", () => LIVE_PORTS.dev)'),
	source(TABLE_TEST, import_of('LIVE_PORTS', 'ports'), 'it("t", () => LIVE_PORTS[k])'),
]

describe('test_symbol_users.select — object members', () => {
	it('reaches a bundle member reader only through the member it reads', () => {
		expect(selected_in(PORTS, 'ports.ts', [2])).toEqual([TABLE_TEST])
	})

	it('reaches a whole-table reader through any member', () => {
		expect(selected_in(PORTS, 'ports.ts', [1])).toEqual([DEV_TEST, TABLE_TEST])
	})
})

const EVENTS: Array<Source> = [
	source(
		'events.ts',
		'const EVENT_KIND = {',
		`\tstart: 'start',`,
		`\tstop: 'stop',`,
		'}',
		'export { EVENT_KIND }',
	),
	source('start.test.ts', import_of('EVENT_KIND', 'events'), 'it("s", () => EVENT_KIND.start)'),
	source(STOP_TEST, import_of('EVENT_KIND', 'events'), 'it("s", () => EVENT_KIND.stop)'),
]

describe('test_symbol_users.select — literal table items', () => {
	it('reaches only the readers of the changed item', () => {
		expect(selected_in(EVENTS, 'events.ts', [3])).toEqual([STOP_TEST])
	})
})

const LOADED: Array<Source> = [
	source(REGISTRY, 'const names: Array<string> = []', `names.push('x')`, 'export { names }'),
	source(DIRECT_TEST, import_of('names', 'registry'), 'it("d", () => names)'),
	source('user.ts', import_of('names', 'registry'), 'function count() { return names }'),
	source('far.test.ts', `import './user'`, 'it("f", () => 1)'),
]

describe('test_symbol_users.select — load-time statements', () => {
	it('selects the direct test readers of the module and no further', () => {
		expect(selected_in(LOADED, REGISTRY, [2])).toEqual([DIRECT_TEST])
	})
})

const LIMITED: Array<Source> = [
	source(
		'limit.ts',
		'const LIMIT = 3',
		'function check(n: number) { return n < LIMIT }',
		'export { check }',
	),
	source(LIMIT_TEST, import_of('check', 'limit'), 'it("c", () => check(1))'),
]

describe('test_symbol_users.select — constants', () => {
	it('reaches the tests of a function reading a changed constant', () => {
		expect(selected_in(LIMITED, 'limit.ts', [1])).toEqual([LIMIT_TEST])
	})
})

const BARRELS: Array<Source> = [
	source('alpha.ts', 'function alpha() { return 1 }', 'export { alpha }'),
	source('beta.ts', 'function beta() { return 2 }', 'export { beta }'),
	source('both.ts', `export * from './alpha'`, `export * from './beta'`),
	source(BETA_TEST, import_of('beta', 'both'), 'it("b", () => beta())'),
	source('entry.ts', `export { alpha } from './alpha'`),
	source(DYNAMIC_TEST, `it("d", async () => (await import('./entry')).alpha())`),
	source(STAR_TEST, `import * as all from './both'`, 'it("s", () => all)'),
]

describe('test_symbol_users.select — barrels', () => {
	it('finds a name in the second star of a barrel', () => {
		expect(selected_in(BARRELS, 'beta.ts', [1])).toEqual([BETA_TEST, STAR_TEST])
	})

	it('reaches the whole-module readers of a barrel through what it re-exports', () => {
		expect(selected_in(BARRELS, 'alpha.ts', [1])).toEqual([DYNAMIC_TEST, STAR_TEST])
	})
})

const DEFAULTS: Array<Source> = [
	source('greet.ts', 'export default function greet() { return 1 }'),
	source(GREET_TEST, `import greet from './greet'`, 'it("g", () => greet())'),
]

describe('test_symbol_users.select — default exports', () => {
	it('reaches the tests importing a changed default export', () => {
		expect(selected_in(DEFAULTS, 'greet.ts', [1])).toEqual([GREET_TEST])
	})
})

const SWAPPED: Array<Source> = [
	source('v2.ts', 'function pick() { return 2 }', 'export { pick }'),
	source(LIB, import_of('pick', 'v2'), 'function run() { return pick() }', RUN_EXPORT),
	source(LIB_TEST, import_of('run', 'lib'), 'it("l", () => run())'),
	source(NAMED, `export { pick } from './v2'`),
	source(STARRED, `export * from './v2'`),
	source(NAMED_TEST, import_of('pick', 'named'), 'it("n", () => pick())'),
	source(STARRED_TEST, import_of('pick', 'starred'), 'it("s", () => pick())'),
]

// joshuafolkken/kit#7980 round 1: a changed binding statement falls in no declaration.
describe('test_symbol_users.select — changed binding statements', () => {
	it('reaches the users of a name a changed import binds', () => {
		expect(selected_in(SWAPPED, LIB, [1])).toEqual([LIB_TEST])
	})

	it('reaches the readers of what a changed named re-export passes on', () => {
		expect(selected_in(SWAPPED, NAMED, [1])).toContain(NAMED_TEST)
	})

	it('reaches the readers of what a changed star re-export passes on', () => {
		expect(selected_in(SWAPPED, STARRED, [1])).toContain(STARRED_TEST)
	})
})

const HUB: Array<Source> = [
	source('run.ts', 'function run() { return 1 }', RUN_EXPORT),
	source('hub.ts', import_of('run', 'run'), 'const HUB = { run }', 'export { HUB }'),
	source(HUB_TEST, import_of('HUB', 'hub'), 'it("h", () => HUB[k])'),
	source('cli.ts', import_of('HUB', 'hub'), 'function main() { return HUB[k] }', 'export { main }'),
	source(CLI_TEST, import_of('main', 'cli'), 'it("c", () => main())'),
]

describe('test_symbol_users.select — stop keys', () => {
	it('passes a change at a stop key to its direct test users alone', () => {
		const reach: Reach = { max_hops: Infinity, stops: new Set(['hub.ts::HUB']) }

		expect(selected_in(HUB, 'run.ts', [1], reach)).toEqual([HUB_TEST])
	})

	it('walks past the hub where no stop is set', () => {
		expect(selected_in(HUB, 'run.ts', [1])).toEqual([CLI_TEST, HUB_TEST])
	})
})
