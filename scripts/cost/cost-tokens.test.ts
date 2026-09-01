import { describe, expect, it } from 'vitest'
import { cost_tokens } from './cost-tokens'

const ASCII_PER_TOKEN = cost_tokens.ASCII_CHARS_PER_TOKEN
const NINE_ASCII = 'abcdefghi'
const THREE_JAPANESE = 'あいう'
const EMOJI = '😀'
const BYTE_BUDGET = 60_000

describe('estimate — the two-term approximation', () => {
	it('answers zero for empty text', () => {
		expect(cost_tokens.estimate('')).toBe(0)
	})

	it('divides ASCII by the calibrated characters per token', () => {
		expect(cost_tokens.estimate(NINE_ASCII)).toBe(NINE_ASCII.length / ASCII_PER_TOKEN)
	})

	// The half a single ratio gets wrong: three bytes each, but one token each.
	it('charges one token per wide character', () => {
		expect(cost_tokens.estimate(THREE_JAPANESE)).toBe(THREE_JAPANESE.length)
	})

	it('adds the two terms for mixed text', () => {
		expect(cost_tokens.estimate(NINE_ASCII + THREE_JAPANESE)).toBe(
			NINE_ASCII.length / ASCII_PER_TOKEN + THREE_JAPANESE.length,
		)
	})

	// Iterated by code point, so an astral character is one wide character and not the two UTF-16
	// units it is stored as.
	it('counts an astral character once', () => {
		expect(cost_tokens.count_chars(EMOJI)).toStrictEqual({ ascii_chars: 0, wide_chars: 1 })
		expect(cost_tokens.estimate(EMOJI)).toBe(1)
	})
})

describe('count_chars — the ASCII split', () => {
	it('splits on the ASCII boundary', () => {
		expect(cost_tokens.count_chars(NINE_ASCII + THREE_JAPANESE)).toStrictEqual({
			ascii_chars: NINE_ASCII.length,
			wide_chars: THREE_JAPANESE.length,
		})
	})
})

describe('ascii_bytes_to_tokens — the budget conversion', () => {
	// It has to be exactly `estimate` of an ASCII document of that size, or a budget expressed in
	// both units would disagree with itself at the boundary.
	it('agrees with estimate on an ASCII document of that size', () => {
		expect(cost_tokens.ascii_bytes_to_tokens(BYTE_BUDGET)).toBe(
			cost_tokens.estimate('a'.repeat(BYTE_BUDGET)),
		)
	})
})
