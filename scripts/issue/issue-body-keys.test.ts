import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { issue_body_keys } from './issue-body-keys'

const SCRIPTS_ROOT = path.join(import.meta.dirname, '..')
const TABLE_FILE = path.join('issue', 'issue-body-keys.ts')
// A declaration key (`- <key>:`) or a heading (`## <heading>`) written in a non-ASCII script.
const KEY_LITERAL = /- (?<key>\P{ASCII}[^\n:'"`]{0,15}):/gu
const HEADING_LITERAL = /(?<!#)#{2,3} (?<heading>\P{ASCII}+)/gu
// Text that is not the Issue body, so the table does not hold it: pull request bodies, comments a
// command posts and park notes.
const OTHER_BODY_TEXT: ReadonlySet<string> = new Set([
	'- 理由:',
	'- 範囲（paths）:',
	'- 層:',
	'- 必要な権限:',
	'- 規模承認のパス:',
	'- 規模承認の行数:',
	'- 規模承認のファイル数:',
	'## 実機証跡',
	'## 受け入れ条件の対応',
	'## 規模承認（',
	'## 追加要件',
	'## 消えたテストの処置',
	'### 検証方法',
	'### 選択肢',
	'### 推奨',
	'### 影響を受ける既存の利用者',
])

function source_files(): ReadonlyArray<string> {
	return readdirSync(SCRIPTS_ROOT, { recursive: true, encoding: 'utf8' }).filter(
		(file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== TABLE_FILE,
	)
}

function literals_in(text: string): ReadonlyArray<string> {
	const keys = [...text.matchAll(KEY_LITERAL)].map((match) => `- ${match.groups?.['key'] ?? ''}:`)
	const headings = [...text.matchAll(HEADING_LITERAL)].map((match) => match[0])

	return [...keys, ...headings].filter((literal) => !OTHER_BODY_TEXT.has(literal))
}

function stray_literals(): ReadonlyArray<string> {
	return source_files().flatMap((file) => {
		const text = readFileSync(path.join(SCRIPTS_ROOT, file), 'utf8')

		return literals_in(text).map((literal) => `${file}: ${literal}`)
	})
}

describe('issue_body_keys', () => {
	it('writes a key as a declaration prefix', () => {
		expect(issue_body_keys.prefix('size')).toBe('- 規模見積もり:')
	})

	it('writes a declaration line with its fixed value', () => {
		expect(issue_body_keys.line('kind', 'non_bug')).toBe('- 種別: 非不具合')
	})

	it('writes a template heading', () => {
		expect(issue_body_keys.heading('background')).toBe('## 背景')
	})

	it('leaves no Issue body key or heading literal in scripts outside the table', () => {
		expect(stray_literals()).toStrictEqual([])
	})
})
