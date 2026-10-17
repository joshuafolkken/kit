import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { describe, expect, it } from 'vitest'
import { review_round2, type RoundTwoAnswer } from './review-round2'

// joshuafolkken/kit#4064: every branch of the round-2 decision carries a stable reason code, printed by
// `--json` and read back by `josh ship`, so the ledger can count decisions by why.

const BASE = '0123456789abcdef0123456789abcdef01234567'
const OTHER_BASE = 'fedcba9876543210fedcba9876543210fedcba98'
const SOURCE = 'src/thing.ts'
const CHANGELOG = 'CHANGELOG.md'
const BEFORE = 'aaa'
const AFTER = 'bbb'
const TREE = { [SOURCE]: BEFORE, [CHANGELOG]: BEFORE }
const SNAPSHOT: FileMapStamp = { taken_at: '2026-10-18T00:00:00.000Z', files: TREE, base: BASE }
const { CODE } = review_round2

function code_of(input: Partial<Parameters<typeof review_round2.decide>[0]>): string {
	return review_round2.decide({
		base: BASE,
		is_round_one_closed: true,
		snapshot: SNAPSHOT,
		tree: TREE,
		...input,
	}).code
}

describe('review_round2.decide — the reason code of each branch', () => {
	it.each([
		['open-finding', { is_round_one_closed: false }, CODE.OPEN_FINDING],
		['no-snapshot', { snapshot: undefined }, CODE.NO_SNAPSHOT],
		['base-moved', { base: OTHER_BASE }, CODE.BASE_MOVED],
		['empty', {}, CODE.EMPTY],
		['inert', { tree: { ...TREE, [CHANGELOG]: AFTER } }, CODE.INERT],
		['live', { tree: { ...TREE, [SOURCE]: AFTER } }, CODE.LIVE],
	])('answers %s', (_label, input, code) => {
		expect(code_of(input)).toBe(code)
	})
})

describe('review_round2 — the JSON a ship reads back', () => {
	const ANSWER: RoundTwoAnswer = { verdict: 'skip', code: CODE.INERT, reason: 'why' }

	it('prints the verdict under its key, with the code and the reason', () => {
		expect(JSON.parse(review_round2.to_json(ANSWER))).toStrictEqual({
			round2: 'skip',
			code: 'inert',
			reason: 'why',
		})
	})

	it('reads back what it printed', () => {
		expect(review_round2.parse_json(`${review_round2.to_json(ANSWER)}\n`)).toStrictEqual(ANSWER)
	})

	it.each([
		['the bare verdict', 'skip'],
		['an unknown code', '{"round2":"skip","code":"other","reason":"why"}'],
		['an unknown verdict', '{"round2":"maybe","code":"inert","reason":"why"}'],
	])('reads %s as no decision', (_label, text) => {
		expect(review_round2.parse_json(text)).toBeUndefined()
	})
})
