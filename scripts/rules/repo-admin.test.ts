import { describe, expect, it } from 'vitest'
import { repo_admin } from './repo-admin'

// joshuafolkken/kit#4650: a write to the repository's administration — the rulesets, the branch
// protection, the collaborators and invitations, the secrets and variables, the webhooks and deploy
// keys, and the repository settings — in every spelling of the method and the body. A `DELETE` is
// `destructive-command`'s, so this row stays silent on it.

const REPO = 'repos/joshuafolkken/kit'

describe('repo_admin.is_repo_admin_write — refuses a gh api write', () => {
	it.each([
		['-X PUT, -f', `gh api -X PUT ${REPO}/rulesets/1 -f enforcement=disabled`],
		['--method PUT, -F', `gh api --method PUT ${REPO}/rulesets/1 -F enforcement=disabled`],
		['--method=PUT, --input', `gh api --method=PUT ${REPO}/rulesets/1 --input ruleset.json`],
		['-XPUT, no body', `gh api -XPUT ${REPO}/collaborators/attacker`],
		['-X=PUT, no body', `gh api -X=PUT ${REPO}/collaborators/attacker`],
		['implicit POST, -f', `gh api ${REPO}/rulesets -f name=x`],
		['implicit POST, --input', `gh api ${REPO}/hooks --input hook.json`],
		['branch protection', `gh api -X PUT ${REPO}/branches/main/protection --input p.json`],
		[
			'protection subpath',
			`gh api -X PATCH ${REPO}/branches/main/protection/required_status_checks`,
		],
		['invitations', `gh api -X PATCH ${REPO}/invitations/7 -f permissions=admin`],
		['actions secret', `gh api -X PUT ${REPO}/actions/secrets/TOKEN -f encrypted_value=x`],
		['actions variable', `gh api ${REPO}/actions/variables -f name=X -f value=y`],
		['dependabot secret', `gh api -X PUT ${REPO}/dependabot/secrets/TOKEN -f encrypted_value=x`],
		['environment secret', `gh api -X PUT ${REPO}/environments/prod/secrets/TOKEN -F x=y`],
		['deploy key', `gh api ${REPO}/keys -f key=ssh-ed25519 -F read_only=false`],
		['repository PATCH', `gh api -X PATCH ${REPO} -f default_branch=x`],
		['repository PATCH, leading slash', `gh api --method PATCH /${REPO}/ -F private=false`],
		['placeholder owner', 'gh api -X PUT repos/{owner}/{repo}/collaborators/x'],
		['quoted path', `gh api -X PUT '${REPO}/rulesets/1' --input r.json`],
		['wrapped', `env GH_TOKEN=x gh api -X PUT ${REPO}/rulesets/1 -f enforcement=disabled`],
		['chained', `git status && gh api -X PUT ${REPO}/collaborators/x`],
	])('%s', (_name, command) => {
		expect(repo_admin.is_repo_admin_write(command)).toBe(true)
	})
})

// The spellings round 1 of the review traced past the first cut: a full URL, a repository selector,
// the endpoints beyond the Issue's list, and the GraphQL mutations that do the same.
describe('repo_admin.is_repo_admin_write — refuses the wider admin surface', () => {
	it.each([
		['full URL', `gh api -X PUT https://api.github.com/${REPO}/collaborators/x`],
		['full URL PATCH', `gh api --method PATCH https://api.github.com/${REPO} -F private=false`],
		['transfer', `gh api ${REPO}/transfer -f new_owner=elsewhere`],
		['actions permissions', `gh api -X PUT ${REPO}/actions/permissions -F enabled=true`],
		['environment', `gh api -X PUT ${REPO}/environments/prod --input env.json`],
		['repository selector', `gh api -R joshuafolkken/kit -X PUT ${REPO}/rulesets/1 -F x=y`],
		[
			'GraphQL mutation',
			"gh api graphql -f query='mutation { updateRepository(input: {}) { x } }'",
		],
		[
			'multi-line GraphQL',
			"gh api graphql -f query='mutation {\n deleteBranchProtectionRule(x) }'",
		],
	])('%s', (_name, command) => {
		expect(repo_admin.is_repo_admin_write(command)).toBe(true)
	})
})

describe('repo_admin.is_repo_admin_write — refuses a gh CLI write', () => {
	it.each([
		'gh secret set TOKEN --body x',
		'gh secret delete TOKEN',
		'gh variable set X --body y',
		'gh variable delete X',
		'gh repo edit --visibility public --accept-visibility-change-consequences',
		'gh repo edit --default-branch x',
		'gh repo deploy-key add key.pub --allow-write',
		'gh repo deploy-key delete 5',
		'sudo gh secret set TOKEN',
		'gh -R joshuafolkken/kit secret set X --body y',
		'gh --repo joshuafolkken/kit variable set X --body y',
		'gh -R joshuafolkken/kit repo edit --visibility public',
	])('%j', (command) => {
		expect(repo_admin.is_repo_admin_write(command)).toBe(true)
	})
})

describe('repo_admin.is_repo_admin_write — is silent on', () => {
	it.each([
		['a ruleset read', `gh api ${REPO}/rulesets`],
		['an explicit GET', `gh api -X GET ${REPO}/collaborators -f per_page=100`],
		['a DELETE — destructive-command', `gh api -X DELETE ${REPO}/collaborators/x`],
		['a repository read', `gh api ${REPO}`],
		['a repository POST elsewhere', `gh api ${REPO}/issues -f title=x`],
		['a pulls PATCH', `gh api -X PATCH ${REPO}/pulls/5 -F body=@b.md`],
		['a smuggled path', `gh api ${REPO}/issues -f x=${REPO}/hooks`],
		['a non-admin path sharing a prefix', `gh api ${REPO}/keys-extra -f x=y`],
		['a secret listing', 'gh secret list'],
		['a variable read', 'gh variable get X'],
		['a ruleset view', 'gh ruleset view 1'],
		['a repository view', 'gh repo view'],
		['a deploy-key listing', 'gh repo deploy-key list'],
		['a quoted mention', 'echo "gh secret set TOKEN"'],
		['a full-URL read', `gh api https://api.github.com/${REPO}/rulesets`],
		['a GraphQL query', "gh api graphql -f query='query { repository { name } }'"],
		['a selected secret listing', 'gh -R joshuafolkken/kit secret list'],
	])('%s', (_name, command) => {
		expect(repo_admin.is_repo_admin_write(command)).toBe(false)
	})
})
