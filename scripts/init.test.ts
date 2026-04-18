import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { init } from './init'

const TEST_DIR = path.join(tmpdir(), 'init-test')
const TEMPLATE_PATH = path.join(TEST_DIR, 'template.properties')
const DEST_PATH = path.join(TEST_DIR, 'sonar-project.properties')
const SONAR_TEMPLATE = 'sonar.projectKey={{PROJECT_KEY}}\nsonar.organization={{ORGANIZATION}}\n'

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('copy_sonar_file_write', () => {
	it('writes substituted content to destination', () => {
		writeFileSync(TEMPLATE_PATH, SONAR_TEMPLATE)
		init.copy_sonar_file_write(TEMPLATE_PATH, DEST_PATH, 'myorg_myrepo', 'myorg')
		const result = readFileSync(DEST_PATH, 'utf8')

		expect(result).toBe('sonar.projectKey=myorg_myrepo\nsonar.organization=myorg\n')
	})

	it('replaces only PROJECT_KEY and ORGANIZATION placeholders', () => {
		const template = `${SONAR_TEMPLATE}sonar.exclusions=.claude/**\n`

		writeFileSync(TEMPLATE_PATH, template)
		init.copy_sonar_file_write(TEMPLATE_PATH, DEST_PATH, 'a_b', 'a')
		const result = readFileSync(DEST_PATH, 'utf8')

		expect(result).toContain('sonar.exclusions=.claude/**')
	})

	it('creates destination file at given path', () => {
		writeFileSync(TEMPLATE_PATH, SONAR_TEMPLATE)
		init.copy_sonar_file_write(TEMPLATE_PATH, DEST_PATH, 'org_repo', 'org')

		expect(existsSync(DEST_PATH)).toBe(true)
	})
})
