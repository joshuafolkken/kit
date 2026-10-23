// cspell:words xoxb

import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { token_shape } from './token-shape'
import { token_shape_fixture } from './token-shape-fixture'

// joshuafolkken/kit#4658: a credential an agent pasted into an outbound body is refused before it is
// sent, and the run board hides one, through one in-process list of shapes.

const SUBJECT = 'The Issue comment'
const SHAPE_NAMES = token_shape.SHAPES.map((shape) => shape.name)
const REFUSED_PREFIXES = ['ghp_', 'github_pat_', 'sk-ant-', 'xoxb-']
const SECRETLINT_TIMEOUT_MS = 60_000

const SECRETLINT_MESSAGE = z.object({ ruleId: z.string() })
const SECRETLINT_REPORT = z.array(z.object({ messages: z.array(SECRETLINT_MESSAGE) }))

async function secretlint_rules(text: string): Promise<Array<string>> {
	const { stdout } = await execa('secretlint', ['--stdinFileName=body.md', '--format=json'], {
		input: text,
		preferLocal: true,
		reject: false,
	})

	return SECRETLINT_REPORT.parse(JSON.parse(stdout)).flatMap((file) =>
		file.messages.map((message) => message.ruleId),
	)
}

function is_refused(sample: string, prefix: string): boolean {
	return sample.startsWith(prefix) && token_shape.find(sample) !== undefined
}

describe('token_shape.refuse', () => {
	it.each(SHAPE_NAMES)('refuses a body holding a %s, naming the shape not the value', (name) => {
		const sample = token_shape_fixture.sample_of(name)
		const body = `Ran it with\n\n    export GH_TOKEN=${sample}\n`

		expect(() => {
			token_shape.refuse(body, SUBJECT)
		}).toThrow(`${SUBJECT} holds a ${name}-shaped`)
		expect(() => {
			token_shape.refuse(body, SUBJECT)
		}).not.toThrow(sample)
	})

	it.each(REFUSED_PREFIXES)('covers the %s prefix the Issue names', (prefix) => {
		const samples = token_shape_fixture.TOKEN_SAMPLES.map((entry) => entry.sample)

		expect(samples.some((sample) => is_refused(sample, prefix))).toBe(true)
	})

	it('lets a body through that only names a prefix', () => {
		const body = 'A classic token starts with `ghp_`; a Slack bot one with `xoxb-`.'

		expect(() => {
			token_shape.refuse(body, SUBJECT)
		}).not.toThrow()
	})
})

describe('token_shape.redact', () => {
	it('replaces every credential and keeps the text around it', () => {
		const github = token_shape_fixture.sample_of('GitHub token')
		const slack = token_shape_fixture.sample_of('Slack token')

		expect(token_shape.redact(`-H "Authorization: token ${github}" ${slack}`)).toBe(
			`-H "Authorization: token ${token_shape.REDACTED}" ${token_shape.REDACTED}`,
		)
	})
})

// The shapes restate the preset's patterns, so the preset itself is asked: a shape it has a rule for
// is flagged by that rule, and kit's own shape by none, so a drift either way fails here.
describe('token_shape.SHAPES — agrees with the secretlint preset', () => {
	it.each(token_shape.SHAPES)(
		'$name is flagged by the rule it names',
		async (shape) => {
			const rules = await secretlint_rules(token_shape_fixture.sample_of(shape.name))

			expect(rules).toStrictEqual(shape.secretlint === undefined ? [] : [shape.secretlint])
		},
		SECRETLINT_TIMEOUT_MS,
	)
})
