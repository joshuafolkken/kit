import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { token_shape_fixture } from '#scripts/lib/token-shape-fixture'
import { delivered_rules_harness } from '#tools/rules/delivered-rules-harness'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { credential_body } from './credential-body'
import { delivered_rules } from './delivered-rules'

// joshuafolkken/kit#4682: a `gh api` body typed on the shell is scanned for a token-shaped string
// before the call runs, as a body kit sends is (joshuafolkken/kit#4658). The files are real, so the
// read the rule makes is the live one.

const ISSUE = 'repos/{owner}/kit/issues/5'
const COMMENTS = `${ISSUE}/comments`
const SAMPLE = token_shape_fixture.sample_of('GitHub token')
const work = mkdtempSync(path.join(tmpdir(), 'credential-body-'))
const TOKEN_FILE = path.join(work, 'token.md')
const TOKEN_JSON = path.join(work, 'token.json')
const CLEAN_FILE = path.join(work, 'clean.md')

writeFileSync(TOKEN_FILE, `Ran it with\n\n    export GH_TOKEN=${SAMPLE}\n`)
writeFileSync(TOKEN_JSON, JSON.stringify({ body: `line\n${SAMPLE}` }))
writeFileSync(CLEAN_FILE, 'A classic token starts with `ghp_`.\n')

const harness = delivered_rules_harness.create_harness('rule-guard-credential-')
const NOW_MS = 1_700_000_000_000

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
	harness.cleanup()
})

describe('credential_body.sends_credential — refuses a body holding a token', () => {
	it.each([
		['a -F body file', `gh api ${COMMENTS} -F body=@${TOKEN_FILE}`],
		['a --field body file, quoted', `gh api ${COMMENTS} --field "body=@${TOKEN_FILE}"`],
		['an --input JSON file', `gh api ${COMMENTS} --input ${TOKEN_JSON}`],
		['an attached --input file', `gh api ${COMMENTS} --input=${TOKEN_FILE}`],
		['an inline -f body', `gh api ${COMMENTS} -f 'body=token ${SAMPLE}'`],
		[
			String.raw`an inline body after a typed \n`,
			String.raw`gh api ${COMMENTS} -f 'body=line\n${SAMPLE}'`,
		],
		['an attached --field file', `gh api ${COMMENTS} --field=body=@${TOKEN_FILE}`],
		['a call behind a cd', `cd /tmp && gh api ${COMMENTS} -F body=@${TOKEN_FILE}`],
		['a call after a semicolon', `true; gh api ${COMMENTS} -F body=@${TOKEN_FILE}`],
	])('refuses %s', (_name, command) => {
		expect(credential_body.sends_credential(command)).toBe(true)
	})
})

describe('credential_body.sends_credential — is silent on a body with no token', () => {
	it.each([
		['a clean body file', `gh api ${COMMENTS} -F body=@${CLEAN_FILE}`],
		['a raw field naming the token file', `gh api ${COMMENTS} -f body=@${TOKEN_FILE}`],
		['a missing file', `gh api ${COMMENTS} -F body=@${path.join(work, 'absent.md')}`],
		['a body from standard input', `gh api ${COMMENTS} --input -`],
		['a read', `gh api ${COMMENTS} --jq .body`],
		['a token outside gh api', `echo ${SAMPLE}`],
	])('is silent on %s', (_name, command) => {
		expect(credential_body.sends_credential(command)).toBe(false)
	})
})

describe('credential-body — delivered by the guard', () => {
	beforeEach(() => {
		process.env[delivered_rules.SWITCH_ENV_KEY] = ''
	})

	it.each([
		['own comment', `gh api ${COMMENTS} -F body=@${TOKEN_FILE}`],
		['issue edit', `gh api -X PATCH ${ISSUE} -F body=@${TOKEN_FILE}`],
	])('is the reason a hand-typed %s with a token file receives', (name, command) => {
		const reason = delivered_rules.delivery(harness.payload_of(`cb-${name}`, command), NOW_MS)

		expect(reason).toBe(credential_body.CREDENTIAL_BODY_REASON)
	})

	it('never quotes the value it refused', () => {
		expect(credential_body.CREDENTIAL_BODY_REASON).not.toContain(SAMPLE)
	})
})
