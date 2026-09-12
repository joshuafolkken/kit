import { investigation_reads } from '#scripts/delegation/investigation-reads'
import { time_batch_guard } from '#scripts/time/time-batch-guard'
import { time_transcript_line } from '#scripts/time/time-transcript-line'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_value, type RuleReading } from './rule-value'

const TIMESTAMP = '2026-09-09T00:00:00.000Z'
const NEXT_TIMESTAMP = '2026-09-09T00:00:01.000Z'
const LATER_TIMESTAMP = '2026-09-09T00:00:02.000Z'
const WIP_CAP = 'wip-cap'
const ISSUE_COMMENTS = 'issue-comments'

const FILING = 'gh api repos/o/r/issues -f title=x'
const COUNT = 'gh api repos/o/r/issues?state=open --jq length'
const BODY_READ = 'gh api repos/o/r/issues/12'
const COMMENTS_READ = 'gh api repos/o/r/issues/12/comments'

// A rule whose trigger is the violation itself, so it declares `reaches` (joshuafolkken/kit#1643).
const SHELL_BODY = 'shell-body'
const BODY_BY_PATH = 'pnpm josh followup --notify-message-file /tmp/body.md'

function tool_use_block(command: string, index: number): Record<string, unknown> {
	return { type: 'tool_use', id: `toolu_${String(index)}`, name: 'Bash', input: { command } }
}

function assistant_line(
	blocks: ReadonlyArray<unknown>,
	timestamp: string,
	message_id: string,
): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp,
		message: { id: message_id, content: blocks },
	})
}

// One transcript line carrying one tool call, in the shape `time_transcript_line.parse_line` reads.
// **It carries no message id, so it is a turn of its own** — the id is what joins lines into one
// turn, and a fixture sharing one across every call would make every session read as one batched
// turn (joshuafolkken/kit#1792).
function call_line(command: string, timestamp: string = TIMESTAMP): string {
	const blocks = [tool_use_block(command, 0)]

	return assistant_line(blocks, timestamp, time_transcript_line.NO_MESSAGE_ID)
}

// The rule delivered by a binary of its own, so `rule:value` reads it from `MEASURED_RULES` while
// `rule:guard` never delivers it (joshuafolkken/kit#1792).
const BATCHING = 'batching'
// The second rule delivered by a binary of its own (joshuafolkken/kit#1764).
const INVESTIGATION = 'investigation'
const BATCHED_MESSAGE_ID = 'msg_batched'
const READ_A = 'cat docs/josh-commands.md'
const READ_B = 'cat CLAUDE.md'

// A subagent dispatch, which is what keeping the investigation rule looks like — there is no shell
// command to match, so the row reads the tool name instead (joshuafolkken/kit#1764).
function delegation_line(timestamp: string = TIMESTAMP): string {
	const block = { type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: {} }

	return assistant_line([block], timestamp, time_transcript_line.NO_MESSAGE_ID)
}

// One transcript line issuing several calls — the turn a run keeping the batching rule produces, and
// the one shape `call_line` cannot express.
function batched_line(commands: ReadonlyArray<string>, timestamp: string = TIMESTAMP): string {
	const blocks = commands.map((command, index) => tool_use_block(command, index))

	return assistant_line(blocks, timestamp, BATCHED_MESSAGE_ID)
}

// The shape Claude Code actually writes: one line per content block, the message id repeated on each.
// One turn, spread across as many lines as it issued calls.
function turn_lines(commands: ReadonlyArray<string>): string {
	return commands
		.map((command, index) =>
			assistant_line([tool_use_block(command, index)], TIMESTAMP, BATCHED_MESSAGE_ID),
		)
		.join('\n')
}

function result_line(content: string, timestamp: string = TIMESTAMP): string {
	return JSON.stringify({
		type: 'user',
		timestamp,
		message: { content: [{ type: 'tool_result', content, is_error: true }] },
	})
}

function session(...commands: ReadonlyArray<string>): string {
	return commands.map((command) => call_line(command)).join('\n')
}

function reading_for(id: string, runs: ReadonlyArray<ReadonlyArray<string>>): RuleReading {
	const found = rule_value.measure(runs).find((reading) => reading.id === id)

	if (found === undefined) throw new Error(`no reading for ${id}`)

	return found
}

describe('rule_value.measure — what the carried text earns unaided', () => {
	it('counts only sessions whose trigger was actually reached', () => {
		expect(reading_for(WIP_CAP, [[session('ls')], [session(FILING)]]).sessions).toBe(1)
	})

	it('reads a run and its delegated units as one timeline, never as separate runs', () => {
		// The parent counted, the unit it delegated filed. Scored per file this is two runs, one of
		// them "trigger reached, not kept"; scored per run it is one run that kept the rule.
		const reading = reading_for(WIP_CAP, [[session(COUNT), session(FILING)]])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(1)
	})

	it('orders a run by timestamp, not by the order its transcripts were handed in', () => {
		// `list_sessions` returns newest first, so the parent that filed can arrive ahead of the unit
		// that counted. Read back to back that scores "trigger reached, not kept"; read as one
		// timeline it is a run that kept the rule.
		const filed = call_line(FILING, '2026-09-09T00:00:09.000Z')
		const counted = call_line(COUNT, NEXT_TIMESTAMP)
		const reading = reading_for(WIP_CAP, [[filed, counted]])

		expect(reading.unaided_kept).toBe(1)
	})

	it('credits keeping the rule when it happened before the trigger fired', () => {
		expect(reading_for(WIP_CAP, [[session(COUNT, FILING)]]).unaided_kept).toBe(1)
	})

	it('does not credit compliance that came after the trigger', () => {
		// The refusal is what produced the count here, so it is the delivery's contribution and not
		// the carried text's — the distinction the whole measurement rests on.
		const reading = reading_for(WIP_CAP, [[session(FILING, COUNT)]])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(0)
	})
})

// **The denominator is the situation the rule governs, which is its trigger only where that trigger
// is a neutral act** (joshuafolkken/kit#1643).
describe('rule_value.measure — the situation a rule governs', () => {
	it('leaves the denominator at the trigger for a rule that declares no reached-situation test', () => {
		// wip-cap's trigger is the filing, which a run keeping the rule makes too — so a run that
		// counted and never filed never reached the rule at all and must stay out of the denominator.
		expect(reading_for(WIP_CAP, [[session(COUNT)]]).sessions).toBe(0)
	})

	it('counts a run that reached the situation compliantly, though its trigger never fired', () => {
		// shell-body fires only on the violation, so without `reaches` a run that passed every body by
		// path would drop out of the reading and the rate would be taken over runs that broke the rule.
		const reading = reading_for(SHELL_BODY, [[session(BODY_BY_PATH)]])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(1)
	})
})

describe('rule_value.measure — the comments rule', () => {
	it('scores the comments rule from a comments read that preceded the body read', () => {
		const kept = reading_for(ISSUE_COMMENTS, [[session(COMMENTS_READ, BODY_READ)]])
		const missed = reading_for(ISSUE_COMMENTS, [[session(BODY_READ)]])

		expect(kept.unaided_kept).toBe(1)
		expect(missed.unaided_kept).toBe(0)
	})
})

describe('rule_value.measure — refusals and unmeasurable rules', () => {
	it('counts a delivered refusal from the reason the hook wrote back', () => {
		const text = `${session(FILING)}\n${result_line(delivered_rules.WIP_CAP_REASON)}`

		expect(reading_for(WIP_CAP, [[text]]).refusals).toBe(1)
	})

	it("does not read another rule's refusal as this one's", () => {
		const text = `${session(FILING)}\n${result_line(delivered_rules.SHELL_BODY_REASON)}`

		expect(reading_for(WIP_CAP, [[text]]).refusals).toBe(0)
	})

	it('does not read a session that merely opened the source file as a refusal', () => {
		// Every signature exists verbatim in the module its rule is written in, so a `Read` of it
		// carries the text
		// in a result whose `is_error` is false. Counting that would inflate the column with sessions
		// that were editing the enumeration rather than being refused by it.
		const read_result = JSON.stringify({
			type: 'user',
			timestamp: TIMESTAMP,
			message: {
				content: [
					{ type: 'tool_result', content: delivered_rules.WIP_CAP_REASON, is_error: false },
				],
			},
		})

		expect(reading_for(WIP_CAP, [[`${session(FILING)}\n${read_result}`]]).refusals).toBe(0)
	})

	it('never reports more refusals than runs that reached the trigger', () => {
		const text = `${session('ls')}\n${result_line(delivered_rules.WIP_CAP_REASON)}`
		const reading = reading_for(WIP_CAP, [[text]])

		expect(reading.refusals).toBeLessThanOrEqual(reading.sessions)
	})
})

describe('rule_value.measure — a refusal is read from the block, not from the raw line', () => {
	it('reads a refusal whose errored flag was serialized with a space after the colon', () => {
		// The test this replaced matched `"is_error":true` against the raw line, so one whitespace in
		// the serializer would take every rule's `refused` column to zero — indistinguishable from a
		// hook that never fired (joshuafolkken/kit#1642).
		const spaced = `{"type":"user","timestamp":"${TIMESTAMP}","message":{"content":[{"type":"tool_result","content":${JSON.stringify(delivered_rules.WIP_CAP_REASON)},"is_error": true}]}}`

		expect(reading_for(WIP_CAP, [[`${session(FILING)}\n${spaced}`]]).refusals).toBe(1)
	})

	it('does not lend an errored block its successful neighbor on the same line', () => {
		// Two results in one line: the refusal text sits in the one that succeeded. Matching the line
		// rather than the block scored it a refusal.
		const mixed = JSON.stringify({
			type: 'user',
			timestamp: TIMESTAMP,
			message: {
				content: [
					{ type: 'tool_result', content: 'unrelated failure', is_error: true },
					{ type: 'tool_result', content: delivered_rules.WIP_CAP_REASON, is_error: false },
				],
			},
		})

		expect(reading_for(WIP_CAP, [[`${session(FILING)}\n${mixed}`]]).refusals).toBe(0)
	})

	it('does not read one errored dump of the enumeration as a refusal by every rule', () => {
		// `cat scripts/rules/delivered-rules.ts && false` writes one errored result carrying every
		// rule's reason verbatim, and the containment test credited a refusal to all six at once. A
		// refusal opens with its reason; the source file opens with its imports.
		const reasons = delivered_rules.DELIVERED_RULES.map((rule) => rule.reason).join('\n')
		const file_dump = `import { z } from 'zod'\n\n${reasons}\n`
		const dump = [[`${session(FILING, BODY_READ)}\n${result_line(file_dump)}`]]

		for (const reading of rule_value.measure(dump)) expect(reading.refusals).toBe(0)
	})

	it('keeps enough of an errored body for a reason signature to be recognized in it', () => {
		// A cross-module invariant with nothing else asserting it: `ERROR_TEXT_LIMIT` bounds retention
		// and lives in a module that knows nothing about rule signatures, so lowering it below
		// REASON_SIGNATURE_LENGTH would make `startsWith` never match and take every `refused` column
		// silently to zero — the very reading this change exists to make trustworthy.
		expect(time_transcript_line.ERROR_TEXT_LIMIT).toBeGreaterThanOrEqual(
			rule_value.REASON_SIGNATURE_LENGTH,
		)
	})
})

describe('rule_value.measure — rules nothing can score', () => {
	it('reports a rule that declares no compliance test as unmeasured, never as zero', () => {
		// Scoring it 0 would read as "never kept", which is a claim the missing predicate cannot make.
		// Every enumerated row declares one since joshuafolkken/kit#1643, so the guarantee is asserted
		// against the reading rather than against whichever row happened to lack a predicate.
		const unmeasured: RuleReading = {
			id: 'unmeasured',
			sessions: 3,
			unaided_kept: 0,
			refusals: 0,
			is_measurable: false,
		}

		expect(rule_value.unaided_rate(unmeasured)).toBeUndefined()
	})

	// **Every rule but the one that cannot have a compliance test** (joshuafolkken/kit#1764). The
	// investigation row declares none on purpose — no call-shaped test can tell a delegation of the
	// reading from any other dispatch — and the module's doctrine is that such a rule reads unmeasured
	// rather than as compliant. Naming it exactly keeps the guard over every other row, the batching
	// one included, rather than exempting a whole registry to make room for one exception.
	it('declares a compliance test on every rule but the one that cannot have one', () => {
		const unmeasured = rule_value
			.measure([[session(FILING)]])
			.filter((reading) => !reading.is_measurable)
			.map((reading) => reading.id)

		expect(unmeasured).toStrictEqual([INVESTIGATION])
	})
})

describe('rule_value.measure — the rates it reports', () => {
	it('gives no rate for a rule no session reached', () => {
		const reading = reading_for(WIP_CAP, [[session('ls')]])

		expect(rule_value.unaided_rate(reading)).toBeUndefined()
	})

	it('reports the unaided rate as a percentage of the sessions that reached the trigger', () => {
		const runs = [[session(COUNT, FILING)], [session(FILING)], [session(FILING)]]

		expect(rule_value.unaided_rate(reading_for(WIP_CAP, runs))).toBe(33)
	})

	it('survives a line that is not JSON', () => {
		expect(() => rule_value.measure([[`not json\n${session(FILING)}`]])).not.toThrow()
	})

	it('keeps every reason signature distinct, so refusals are not cross-attributed', () => {
		// `observe_refusal` identifies the speaker by the first REASON_SIGNATURE_LENGTH characters. If
		// two reasons ever shared an opening that long, one rule's refusals would be credited to the
		// other with nothing failing.
		const signatures = delivered_rules.MEASURED_RULES.map((rule) =>
			rule.reason.slice(0, rule_value.REASON_SIGNATURE_LENGTH),
		)

		expect(new Set(signatures).size).toBe(signatures.length)
	})

	it('reads every enumerated rule, so a new row is measured rather than silently skipped', () => {
		const ids = rule_value.measure([[session('ls')]]).map((reading) => reading.id)
		const enumerated = delivered_rules.MEASURED_RULES.map((rule) => rule.id)

		expect(ids).toStrictEqual(enumerated)
	})
})

describe('rule_value.measure — the batching guard, which delivers itself', () => {
	// **The regression this row exists to keep from being bought twice** (joshuafolkken/kit#1792).
	// Every member of `DELIVERED_RULES` becomes a live `PreToolUse` guard, so a batching row added
	// there would refuse a violation the batching guard is already refusing — two records written for
	// one call, of which Claude Code surfaces one.
	it('is measured without being delivered a second time', () => {
		const delivered = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)
		const measured = delivered_rules.MEASURED_RULES.map((rule) => rule.id)

		expect(delivered).not.toContain(BATCHING)
		expect(measured).toContain(BATCHING)
	})

	it('credits a refusable call that went out beside the calls that did not need its result', () => {
		const reading = reading_for(BATCHING, [[batched_line([READ_A, READ_B])]])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(1)
	})

	it('counts a run that only ever issued lone calls as reached but never as kept', () => {
		const reading = reading_for(BATCHING, [[session(READ_A, READ_B)]])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(0)
	})

	it('counts the guard refusal, which is the reading the table had no row for', () => {
		const run = [[`${session(READ_A)}\n${result_line(time_batch_guard.REASON)}`]]

		expect(reading_for(BATCHING, run).refusals).toBe(1)
	})

	// The row declares no call-shaped trigger, so the refusal is what closes the unaided window. Read
	// without that, a run made to batch by the hook would be scored as one the carried text convinced.
	it('does not credit the batching the refusal itself produced', () => {
		const refusal = result_line(time_batch_guard.REASON, NEXT_TIMESTAMP)
		const reissued = batched_line([READ_A, READ_B], LATER_TIMESTAMP)
		const reading = reading_for(BATCHING, [[`${call_line(READ_A)}\n${refusal}\n${reissued}`]])

		expect(reading.refusals).toBe(1)
		expect(reading.unaided_kept).toBe(0)
	})
})

// **A turn is a message id, not a line** — the reading `batches_the_turn` rests on entirely.
describe('rule_value.measure — what counts as one turn', () => {
	// **The defect the first reading of this row exposed** (joshuafolkken/kit#1792). Read per line, a
	// batched turn is two turns of one call: over 297 recorded runs the row scored 3 kept of 276
	// against 47 refusals, which is the near-zero reading `reaches` exists to prevent, reached through
	// the one door it does not cover.
	it('reads one turn from the lines Claude Code splits it across', () => {
		const reading = reading_for(BATCHING, [[turn_lines([READ_A, READ_B])]])

		expect(reading.unaided_kept).toBe(1)
	})

	// **The lines a turn is split across are not adjacent**, which is why the fold is keyed by id
	// rather than taken against the entry before it: the first call's result, and the attachments
	// Claude Code writes beside it, all land between the two blocks of one message. Folded by
	// adjacency, 520 multi-call messages in this checkout's last 8 sessions came back as 58 turns.
	it('reads one turn across the records the transcript writes between its blocks', () => {
		const opened = assistant_line([tool_use_block(READ_A, 0)], TIMESTAMP, BATCHED_MESSAGE_ID)
		const between = result_line('ok', NEXT_TIMESTAMP)
		const closed = assistant_line([tool_use_block(READ_B, 1)], LATER_TIMESTAMP, BATCHED_MESSAGE_ID)
		const reading = reading_for(BATCHING, [[`${opened}\n${between}\n${closed}`]])

		expect(reading.unaided_kept).toBe(1)
	})
})

// The second rule delivered by a binary of its own, and the one whose subject is the largest
// contributor any mechanism here addresses (joshuafolkken/kit#1764).
describe('rule_value.measure — the investigation guard, which delivers itself', () => {
	// A row in `DELIVERED_RULES` would refuse a violation `josh investigation:guard` is already
	// refusing — two records written for one call, of which Claude Code surfaces one.
	it('is scored from the measured registry and delivered from neither', () => {
		expect(delivered_rules.DELIVERED_RULES.map((rule) => rule.id)).not.toContain(INVESTIGATION)
		expect(delivered_rules.MEASURED_RULES.map((rule) => rule.id)).toContain(INVESTIGATION)
	})

	it('counts a run that read a subject file in the main line as having reached the rule', () => {
		expect(reading_for(INVESTIGATION, [[session(READ_A)]]).sessions).toBe(1)
	})

	it('counts the guard refusal, which is the delivery the table had no row for', () => {
		const refusal = result_line(investigation_reads.REASON, NEXT_TIMESTAMP)
		const run = [[`${call_line(READ_A)}\n${refusal}\n${delegation_line(LATER_TIMESTAMP)}`]]

		expect(reading_for(INVESTIGATION, run).refusals).toBe(1)
	})

	// **A dispatch is not evidence the reading was delegated**, because the guard's own reset credits
	// any subagent call — so a row scored on one would read near 100% for a rule this Issue measures as
	// let through on a third of all reads. Unmeasured is the module's answer to a rule nothing can
	// score, and `josh time`'s `Investigation reads:` block is where the compliance reading lives.
	it('reports no unaided rate, because no call-shaped test can say the rule was kept', () => {
		const reading = reading_for(INVESTIGATION, [[`${call_line(READ_A)}\n${delegation_line()}`]])

		expect(reading.is_measurable).toBe(false)
		expect(rule_value.unaided_rate(reading)).toBeUndefined()
	})
})
