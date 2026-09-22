import { describe, expect, it } from 'vitest'
import { decision_oracle } from './decision-oracle'
import { oracle_firing } from './oracle-firing'

// joshuafolkken/kit#2324: every decision oracle owes a firing-point declaration — the governed action,
// or the reason none can be named. This suite pins the totality (no oracle is left undeclared, none
// declares both) and the three wired predicates match their governed call and reject the near-misses.

const ORACLE_NAMES = decision_oracle.DECISION_ORACLES.map((oracle) => oracle.name)
const WIRED = ['pkg:scout', 'issue:lint', 'release:scope']
const PKG_ADD = 'pnpm add lodash'
const FOLLOWUP = 'pnpm josh followup'
const LEAVES_ALONE = 'leaves %j alone'
const JOSH_GATE = 'pnpm josh gate'

describe('every oracle declares exactly one of firing point / reason', () => {
	it.each(ORACLE_NAMES)('%s declares exactly one', (name) => {
		const declaration = oracle_firing.declaration_for(name)
		const has_firing = declaration.firing_point !== undefined
		const has_reason =
			declaration.not_firing_reason !== undefined && declaration.not_firing_reason.length > 0

		expect(has_firing).not.toBe(has_reason)
	})
})

describe('the firing / not-named maps cover the registry exactly', () => {
	it('every declared name is a real oracle', () => {
		const declared = [...oracle_firing.FIRING.keys(), ...oracle_firing.NOT_NAMED.keys()]

		for (const name of declared) {
			expect(ORACLE_NAMES).toContain(name)
		}
	})

	it('no name appears in both maps', () => {
		const overlap = [...oracle_firing.FIRING.keys()].filter((name) =>
			oracle_firing.NOT_NAMED.has(name),
		)

		expect(overlap).toEqual([])
	})
})

describe('the three wired firing points are the clearly-nameable ones', () => {
	it.each(WIRED)('%s declares a firing point', (name) => {
		expect(oracle_firing.declaration_for(name).firing_point).toBeDefined()
	})

	it('exactly three oracles declare a firing point', () => {
		expect(oracle_firing.firing_oracles()).toHaveLength(WIRED.length)
	})
})

describe('is_package_add — the add, not the bare install', () => {
	it.each([PKG_ADD, 'yarn add react', 'bun add zod', 'npm install lodash', 'npm i lodash'])(
		'reads %j as a package add',
		(command) => {
			expect(oracle_firing.is_package_add(command)).toBe(true)
		},
	)

	it.each(['pnpm install', 'pnpm i', 'npm install', 'pnpm run build', JOSH_GATE])(
		LEAVES_ALONE,
		(command) => {
			expect(oracle_firing.is_package_add(command)).toBe(false)
		},
	)
})

describe('is_followup — the release step', () => {
	it.each([FOLLOWUP, 'pnpm josh followup --merge'])('reads %j as followup', (command) => {
		expect(oracle_firing.is_followup(command)).toBe(true)
	})

	it.each([JOSH_GATE, 'pnpm josh git -y "x"', 'echo followup'])(LEAVES_ALONE, (command) => {
		expect(oracle_firing.is_followup(command)).toBe(false)
	})
})
