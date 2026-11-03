import { describe, expect, it } from 'vitest'
import { workflow_edit } from './workflow-edit'

const is_lane_child = true
const is_outside_lane = false
const WORKFLOW = '.github/workflows/claude-review.yml'

function bash(command: string): { name: string; input: Record<string, unknown> } {
	return { name: 'Bash', input: { command } }
}

function file_tool(
	name: string,
	file_path: string,
): { name: string; input: Record<string, unknown> } {
	return { name, input: { file_path } }
}

const REFUSED_COMMANDS = [
	`sed -i '' 's/a/b/' ${WORKFLOW}`,
	`sed -i.bak 's/a/b/' ${WORKFLOW}`,
	`perl -pi -e 's/a/b/' ${WORKFLOW}`,
	`echo 'exit 0' > ${WORKFLOW}`,
	`echo 'exit 0' >> ${WORKFLOW}`,
	`echo x | tee ${WORKFLOW}`,
	`cp /tmp/pass.yml ${WORKFLOW}`,
	`mv /tmp/pass.yml ${WORKFLOW}`,
	`rm ${WORKFLOW}`,
	`git checkout main -- ${WORKFLOW}`,
	'git checkout origin/main -- .github/workflows',
	`git restore --source main ${WORKFLOW}`,
	`bash -c "echo x > ${WORKFLOW}"`,
	`cat > ${WORKFLOW} <<'EOF'\non: pull_request\nEOF`,
	`echo "$(echo x > ${WORKFLOW})"`,
	`cd /tmp && echo x > /repo/${WORKFLOW}`,
	`(echo x > ${WORKFLOW})`,
	`git -C /repo checkout main ${WORKFLOW}`,
	`echo x > "./${WORKFLOW}"`,
	'cd .github/workflows && echo x > claude-review.yml',
	"cd .github && sed -i '' s/a/b/ workflows/claude-review.yml",
	'pushd /repo/.github',
	'cp -t .github/workflows /tmp/pass.yml',
	'cp --target-directory=.github/workflows /tmp/pass.yml',
	'install -t.github/workflows /tmp/pass.yml',
	`dd if=/tmp/pass.yml of=${WORKFLOW}`,
	`patch ${WORKFLOW} /tmp/pass.patch`,
	`unlink ${WORKFLOW}`,
	`shred -u ${WORKFLOW}`,
]

const ALLOWED_COMMANDS = [
	`cat ${WORKFLOW}`,
	`grep -n pull_request ${WORKFLOW}`,
	`head -20 ${WORKFLOW}`,
	`sed -n 1,20p ${WORKFLOW}`,
	`wc -l < ${WORKFLOW}`,
	`cp ${WORKFLOW} /tmp/review.yml`,
	`git diff main -- ${WORKFLOW}`,
	`git log -- ${WORKFLOW}`,
	`echo "x > ${WORKFLOW}"`,
	'echo x > docs/workflows.md',
	'cd /repo/scripts',
	`dd if=${WORKFLOW} of=/tmp/review.yml`,
]

describe('workflow_edit.is_workflow_edit_call — a lane child', () => {
	it.each(REFUSED_COMMANDS)('refuses the shell write %j', (command) => {
		expect(workflow_edit.is_workflow_edit_call(bash(command), is_lane_child)).toBe(true)
	})

	it.each(['Edit', 'Write'])('refuses an %s of a workflow', (name) => {
		expect(
			workflow_edit.is_workflow_edit_call(file_tool(name, `/repo/${WORKFLOW}`), is_lane_child),
		).toBe(true)
	})

	it.each(ALLOWED_COMMANDS)('passes the read %j', (command) => {
		expect(workflow_edit.is_workflow_edit_call(bash(command), is_lane_child)).toBe(false)
	})

	it.each(['Read', 'Grep'])('passes a %s of a workflow', (name) => {
		expect(workflow_edit.is_workflow_edit_call(file_tool(name, WORKFLOW), is_lane_child)).toBe(
			false,
		)
	})

	it('passes an Edit of a file outside the workflows directory', () => {
		expect(
			workflow_edit.is_workflow_edit_call(
				file_tool('Edit', '.github/dependabot.yml'),
				is_lane_child,
			),
		).toBe(false)
	})
})

describe('workflow_edit.is_workflow_edit_call — not a lane child', () => {
	it.each(REFUSED_COMMANDS)('leaves the shell write %j to an interactive session', (command) => {
		expect(workflow_edit.is_workflow_edit_call(bash(command), is_outside_lane)).toBe(false)
	})

	it.each(['Edit', 'Write'])('leaves an %s of a workflow to an interactive session', (name) => {
		expect(workflow_edit.is_workflow_edit_call(file_tool(name, WORKFLOW), is_outside_lane)).toBe(
			false,
		)
	})
})

describe('workflow_edit.WORKFLOW_EDIT_REASON', () => {
	it('says a workflow-changing Issue is not implemented in a lane', () => {
		expect(workflow_edit.WORKFLOW_EDIT_REASON).toContain('not implemented in a lane')
	})
})
