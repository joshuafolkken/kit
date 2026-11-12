import { canonical_command } from '#scripts/josh/josh-aliases'
import { COMMAND_MAP, type CommandEntry } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { all_documents, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'

// A flag a document passes to a josh command must be one its registry entry spells — in the synopsis,
// a usage example or a listed flag — so a flag renamed or dropped from a command's usage fails here
// rather than at a reader's run time. The generated usage spans already follow the registry; this
// reaches the prose around them (joshuafolkken/kit#7331).

const UNKNOWN_LINT_FLAG = 'josh lint --bogus'

function registry_texts(entry: CommandEntry): Array<string> {
	const [synopsis] = entry.reference
	const { examples, flags = [] } = entry.usage

	return [
		synopsis,
		...examples.map((example) => example.arguments),
		...flags.flatMap((flag) => flag.names),
	]
}

function registered_flags(name: string): ReadonlySet<string> {
	const entry = COMMAND_MAP[name]
	const texts = entry === undefined ? [] : registry_texts(entry)

	return new Set(texts.flatMap((text) => document_scan.flag_names(text)))
}

// A command the map does not hold is `command-reference.test.ts`'s to report, not this one's.
function unregistered_flags(text: string): Array<string> {
	return document_scan
		.command_flag_references(text)
		.map(({ command, flag }) => ({ command: canonical_command(command), flag }))
		.filter(({ command }) => Object.hasOwn(COMMAND_MAP, command))
		.filter(({ command, flag }) => !registered_flags(command).has(flag))
		.map(({ command, flag }) => `josh ${command} ${flag}`)
}

describe('every flag a document passes to a josh command is registered', () => {
	it.each(all_documents())('%s passes only registered flags', (path) => {
		expect(unregistered_flags(read_document(path))).toStrictEqual([])
	})

	// The guard is only worth keeping if it fails on the thing it exists to catch.
	it('flags a flag the command does not register', () => {
		expect(unregistered_flags(`run \`pnpm ${UNKNOWN_LINT_FLAG}\` first`)).toStrictEqual([
			UNKNOWN_LINT_FLAG,
		])
	})

	it('accepts a flag from the synopsis, an example and the flag list', () => {
		expect(unregistered_flags('`josh lint --changed` or `josh git -y --skip-push`')).toStrictEqual(
			[],
		)
	})

	it('reads a flag with a value by its name', () => {
		expect(unregistered_flags('`josh lint --shard=1`')).toStrictEqual([])
	})

	it('reads an alias as its command', () => {
		expect(unregistered_flags('`josh ga --bogus`')).toStrictEqual(['josh gate --bogus'])
	})

	it('leaves a flag of a chained command to that command', () => {
		expect(unregistered_flags('`pnpm josh lint && pnpm test --watch`')).toStrictEqual([])
	})

	it('reads no flag outside a code span', () => {
		expect(unregistered_flags(UNKNOWN_LINT_FLAG)).toStrictEqual([])
	})
})
