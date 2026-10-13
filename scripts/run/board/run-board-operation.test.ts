import { describe, expect, it } from 'vitest'
import { run_board_operation, type Operation } from './run-board-operation'

// joshuafolkken/kit#3757: the newest operation of a session, read off the end of its log — the tool
// and what it was pointed at, never the session's own description of the call.

const AT = '2026-10-13T09:00:00.000Z'
const LATER = '2026-10-13T09:00:05.000Z'
const AT_MS = Date.parse(AT)
const ROOT = '/work/kit'
const COMMAND = 'pnpm josh test:related'
const UNDATED = JSON.stringify({
	type: 'assistant',
	message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
})
const DESCRIPTION = '関連するテストを実行する'
const JAPANESE = /[぀-ヿ一-鿿]/u
const LONG_LINE_LENGTH = 50_000

interface Call {
	name: string
	input: unknown
}

function line_of(calls: ReadonlyArray<Call>, timestamp: string = AT): string {
	const content = calls.map((call) => ({ type: 'tool_use', id: 'toolu_1', ...call }))

	return JSON.stringify({ type: 'assistant', timestamp, message: { role: 'assistant', content } })
}

function bash(command: string, timestamp: string = AT): string {
	return line_of([{ name: 'Bash', input: { command, description: DESCRIPTION } }], timestamp)
}

function filed(name: string, file_path: string): string {
	return line_of([{ name, input: { file_path } }])
}

function latest_of(...lines: ReadonlyArray<string>): Operation | undefined {
	return run_board_operation.latest_of(lines.join('\n'), ROOT)
}

describe('run_board_operation.latest_of — what a call is pointed at', () => {
	it('reads a command as the tool and the head of the command, with its time', () => {
		expect(latest_of(bash(COMMAND))).toStrictEqual({
			kind: 'Bash',
			target: COMMAND,
			at_ms: AT_MS,
		})
	})

	it.each(['Edit', 'Write', 'Read'])('reads %s as the file’s path from the checkout', (name) => {
		const operation = latest_of(filed(name, `${ROOT}/scripts/lane/lane-open.ts`))

		expect(operation).toMatchObject({ kind: name, target: 'scripts/lane/lane-open.ts' })
	})

	it('draws a file outside the checkout by its name alone', () => {
		expect(latest_of(filed('Read', '/Users/someone/.claude/notes.md'))?.target).toBe('notes.md')
	})

	it('reads any other tool as the tool alone', () => {
		const operation = latest_of(line_of([{ name: 'Agent', input: { prompt: DESCRIPTION } }]))

		expect(operation).toStrictEqual({ kind: 'Agent', target: undefined, at_ms: AT_MS })
	})

	it('reads a call whose input is no object as the tool alone', () => {
		expect(latest_of(line_of([{ name: 'Bash', input: 'ls' }]))?.target).toBeUndefined()
	})
})

describe('run_board_operation.latest_of — what a command shows', () => {
	it('cuts a command at the limit', () => {
		const target = latest_of(bash(`pnpm josh notify --body=${'x'.repeat(200)}`))?.target ?? ''

		expect(target).toHaveLength(run_board_operation.TARGET_LIMIT + '…'.length)
		expect(target.endsWith('…')).toBe(true)
	})

	it('keeps only the first line, its spaces folded', () => {
		expect(latest_of(bash('  git   status\ngit stash list'))?.target).toBe('git status')
	})

	it('leaves out the variables set ahead of the command', () => {
		const operation = latest_of(bash('GH_TOKEN=ghp_secret CI=1 gh api repos'))

		expect(operation?.target).toBe('gh api repos')
	})

	it('stops at the first character that is not ASCII, and never writes the description', () => {
		const operation = latest_of(bash('git commit -m "修正する"'))

		expect(operation?.target).toBe('git commit -m "')
		expect(JSON.stringify(operation)).not.toMatch(JAPANESE)
	})
})

describe('run_board_operation.latest_of — a variable whose value is quoted', () => {
	it('leaves out the whole value, the spaces inside its quotes included', () => {
		const operation = latest_of(bash(`MSG="hello world" NOTE='a b' pnpm josh notify`))

		expect(operation?.target).toBe('pnpm josh notify')
	})

	it.each([
		['holds an escaped quote', String.raw`PAYLOAD="{\"a\": 1}" node x.js`, 'node x.js'],
		['runs over a line break', 'BODY="line one\nline two" gh issue comment', 'gh issue comment'],
		['is a command of its own', 'SHA=$(git rev-parse HEAD) && echo $SHA', 'echo $SHA'],
		['is a command in backticks', 'SHA=`git rev-parse HEAD`; git show $SHA', 'git show $SHA'],
		['stands on a line of its own', 'TOKEN=ghp_secret\ngh api user', 'gh api user'],
	])('leaves out a value that %s', (_name, command, target) => {
		expect(latest_of(bash(command))?.target).toBe(target)
	})

	it.each([
		['a quote that never closes', 'MSG="hello world pnpm josh gate'],
		['a variable and no command', 'TOKEN=ghp_secret'],
	])('draws the tool alone for %s', (_name, command) => {
		expect(latest_of(bash(command))?.target).toBeUndefined()
	})
})

describe('run_board_operation.latest_of — which call is the newest', () => {
	it('reads the last line that holds a call, and the last call of that line', () => {
		const both = line_of(
			[
				{ name: 'Read', input: { file_path: `${ROOT}/a.ts` } },
				{ name: 'Read', input: { file_path: `${ROOT}/b.ts` } },
			],
			LATER,
		)
		const result = JSON.stringify({ type: 'user', timestamp: LATER, message: { content: [] } })

		expect(latest_of(bash('ls'), both, result)).toMatchObject({
			target: 'b.ts',
			at_ms: Date.parse(LATER),
		})
	})

	it('drops a first line cut mid-way and reads the call after it', () => {
		const cut = bash('pnpm josh gate', LATER).slice(20)

		expect(latest_of(cut, bash('ls'))?.target).toBe('ls')
	})

	it('reads past a line of tens of thousands of characters that holds no call', () => {
		const long = JSON.stringify({
			type: 'user',
			timestamp: LATER,
			text: 'x'.repeat(LONG_LINE_LENGTH),
		})

		expect(latest_of(bash('ls'), long)?.target).toBe('ls')
	})
})

describe('run_board_operation.latest_of — a log that holds no operation', () => {
	it.each([
		['an empty log', ''],
		[
			'a log with no call',
			JSON.stringify({ type: 'assistant', timestamp: AT, message: { content: [] } }),
		],
		['a line that is not JSON', '{"tool_use" broken'],
		['a call with no time', UNDATED],
		['a call whose time is no date', bash('ls', 'yesterday')],
	])('reads no operation from %s', (_name, tail) => {
		expect(latest_of(tail)).toBeUndefined()
	})
})

describe('run_board_operation.words_of', () => {
	it('writes the tool, then what it was pointed at', () => {
		expect(run_board_operation.words_of({ kind: 'Bash', target: 'ls', at_ms: AT_MS })).toBe(
			'Bash ls',
		)
	})

	it('writes the tool alone where it was pointed at nothing', () => {
		const operation = { kind: 'Agent', target: undefined, at_ms: AT_MS }

		expect(run_board_operation.words_of(operation)).toBe('Agent')
	})
})
