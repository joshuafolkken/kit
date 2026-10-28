import { describe, expect, it } from 'vitest'
import { piped_verification } from './piped-verification'
import { piped_verification_shapes, type ShapeCounts } from './piped-verification-shapes'
import { rule_value_fixture } from './rule-value-fixture'

// The refusal breakdown `josh rule:value --fresh` prints (joshuafolkken/kit#5266): which filter drew
// each `piped-verification` refusal, so the next shape to move to the rewrite is read off a count.

const REASON = piped_verification.PIPED_VERIFICATION_REASON
const HARNESS_LABEL = 'PreToolUse:Bash hook error: '
const { SHAPE } = piped_verification_shapes
const HEADED_GATE = 'pnpm josh gate | head'
const QUIET_GREP_LINT = 'pnpm josh lint | grep -q x'

describe('shape_of — the filter a refusal is named by', () => {
	it.each([
		['pnpm josh lint:related | head -5', SHAPE.head],
		['git status; pnpm josh gate | head -40', SHAPE.head],
		['pnpm josh gate | grep -q failed', SHAPE.grep],
		["pnpm josh gate | awk 'NR > 3'", SHAPE.script],
		['pnpm josh gate | sed 10q', SHAPE.script],
		['pnpm josh gate | tee /tmp/gate.log', SHAPE.script],
		['pnpm josh gate | tail -5; cat <<EOF\nx\nEOF', SHAPE.chain],
		['pnpm josh gate 2>/dev/null | tail -5', SHAPE.other],
	])('names %j %j', (command, shape) => {
		expect(piped_verification_shapes.shape_of(command)).toBe(shape)
	})
})

describe('refused_commands — the calls the refusals answered', () => {
	it('pairs each refusal with its call by id, under the harness label or without it', () => {
		const text = [
			rule_value_fixture.answered_call(HEADED_GATE, 1, `${HARNESS_LABEL}${REASON}`),
			rule_value_fixture.answered_call('ls nope', 2, 'ls: nope: No such file'),
			rule_value_fixture.answered_call(QUIET_GREP_LINT, 3, REASON),
		].join('\n')

		expect(piped_verification_shapes.refused_commands(text)).toStrictEqual([
			HEADED_GATE,
			QUIET_GREP_LINT,
		])
	})

	it('reads nothing from a transcript that carries no refusal of this rule', () => {
		expect(
			piped_verification_shapes.refused_commands(rule_value_fixture.session('ls')),
		).toStrictEqual([])
	})
})

describe('count and render — the line the candidates print', () => {
	it('counts each shape and prints every shape, zero included', () => {
		const counts: ShapeCounts = new Map()
		const refusal = rule_value_fixture.answered_call(HEADED_GATE, 1, REASON)

		piped_verification_shapes.count(refusal, counts)
		piped_verification_shapes.count(refusal, counts)

		expect(piped_verification_shapes.render(counts)).toBe(
			`${piped_verification_shapes.HEADING} head 2 · grep 0 · awk|sed|tee 0 · chain 0 · other 0`,
		)
	})
})
