import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { delivered_rules } from './delivered-rules'

// The payload machinery two delivery suites share (joshuafolkken/kit#2119). `delivered-rules.test.ts`
// had it first; the filing rules — the scout gate and the per-run cap — need the same temp transcript,
// payload envelope and per-rule stamp cleanup, so a second copy in `delivered-rules-filing.test.ts`
// would be the clone `CLAUDE.md` prohibits. Each suite calls `create_harness()` once, so each gets its
// own work directory and its own tracked transcripts.

const PRE_TOOL_USE = 'PreToolUse'
const BASH_TOOL = 'Bash'

interface Harness {
	// The temp directory this harness's transcripts live under.
	work: string
	// Every transcript file written, so a suite can clean the batching stamp keyed on each of them.
	written: ReadonlySet<string>
	transcript_for: (name: string, text?: string) => string
	payload_for: (transcript: string, command: string, tool_name?: string) => string
	payload_of: (name: string, command: string, tool_name?: string, history?: string) => string
	// Removes every rule's once-per-run stamp for every written transcript, then the work directory.
	cleanup: () => void
}

function payload_for(transcript: string, command: string, tool_name = BASH_TOOL): string {
	return JSON.stringify({
		hook_event_name: PRE_TOOL_USE,
		transcript_path: transcript,
		tool_name,
		tool_input: { command },
	})
}

function create_harness(prefix = 'rule-guard-'): Harness {
	const work = mkdtempSync(path.join(tmpdir(), prefix))
	const written = new Set<string>()

	// The trigger reads the call, never the history, so an empty transcript is the honest fixture — it
	// proves the decision came from the command rather than from anything behind it.
	function transcript_for(name: string, text = ''): string {
		const target = path.join(work, `${name}.jsonl`)

		writeFileSync(target, text)
		written.add(target)

		return target
	}

	// `history` is the transcript behind the call, empty for a case that reads only the command.
	function payload_of(name: string, command: string, tool_name = BASH_TOOL, history = ''): string {
		return payload_for(transcript_for(name, history), command, tool_name)
	}

	function cleanup(): void {
		for (const transcript of written) {
			for (const rule of delivered_rules.DELIVERED_RULES) {
				rmSync(delivered_rules.delivery_path(rule.id, transcript), { force: true })
			}
		}

		rmSync(work, { recursive: true, force: true })
	}

	return { work, written, transcript_for, payload_for, payload_of, cleanup }
}

const delivered_rules_harness = { create_harness }

export type { Harness }
export { delivered_rules_harness }
