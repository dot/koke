// Admin steps for A1 (ADR 2). There is no admin screen in v1; this wraps `wrangler d1 execute`.
//
//   npm run admin -- [--remote] user add <display name> [--subjects 国語,数学,英語]
//   npm run admin -- [--remote] invite <user_id>          prints the invitation URL
//   npm run admin -- [--remote] devices <user_id>
//   npm run admin -- [--remote] revoke-device <device_id>
//   npm run admin -- [--remote] revoke-user <user_id>
//
// Without --remote it acts on the local database used by `npm run dev`.
// KOKE_ORIGIN sets the origin printed in invitation URLs (default http://localhost:5173).

import { execFileSync } from 'node:child_process'
import { addInvitation, addSubjects, addUser, listDevices, revokeDevice, revokeUser } from '../src/admin/sql.ts'
import { nameKey } from '../src/shared/subject-name.ts'
import { INVITATION_TTL, SUBJECT_NAME_MAX } from '../src/worker/constants.ts'
import { randomToken, sha256 } from '../src/worker/crypto.ts'

const args = process.argv.slice(2)
const remote = args[0] === '--remote'
const [command, ...rest] = remote ? args.slice(1) : args

// --command, not --file: with --remote, --file prints upload progress on stdout ahead of the JSON.
// The SQL holds only hashes, never a code, so passing it as an argument is safe.
function execute(sql: string): Record<string, unknown>[] {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'koke', remote ? '--remote' : '--local', '--command', sql, '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const results = JSON.parse(out) as { results: Record<string, unknown>[] }[]
  return results.flatMap((r) => r.results)
}

function id(value: string | undefined, what: string): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) {
    console.error(`${what} must be a positive integer`)
    process.exit(1)
  }
  return n
}

const now = Date.now()
switch (command) {
  case 'user': {
    // Optional starting subjects (A1): the learner can change them later in the subjects tab.
    const flag = rest.indexOf('--subjects')
    const subjects = flag === -1 ? [] : (rest[flag + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const name = (flag === -1 ? rest.slice(1) : rest.slice(1, flag)).join(' ').trim()
    if (rest[0] !== 'add' || !name || (flag !== -1 && (subjects.length === 0 || rest.length !== flag + 2)) ||
      subjects.some((s) => [...s].length > SUBJECT_NAME_MAX) ||
      new Set(subjects.map(nameKey)).size !== subjects.length) {
      console.error('usage: user add <display name> [--subjects 国語,数学,英語]')
      process.exit(1)
    }
    const [user] = execute(addUser(name, now)) as { user_id: number }[]
    if (subjects.length > 0) execute(addSubjects(user.user_id, subjects, now))
    console.log({ user_id: user.user_id, subjects })
    break
  }
  case 'invite': {
    const userId = id(rest[0], 'user_id')
    const code = randomToken(16)
    const rows = execute(addInvitation(userId, await sha256(code), now, INVITATION_TTL))
    if (rows.length === 0) {
      console.error(`no user ${userId}`)
      process.exit(1)
    }
    const origin = process.env.KOKE_ORIGIN ?? 'http://localhost:5173'
    console.log(`${origin}/invite/${code}`)
    console.log('Single use, valid for 24 hours. Hand it to the learner directly.')
    break
  }
  case 'devices':
    console.table(execute(listDevices(id(rest[0], 'user_id'))))
    break
  case 'revoke-device':
    execute(revokeDevice(id(rest[0], 'device_id'), now))
    console.log('revoked')
    break
  case 'revoke-user':
    execute(revokeUser(id(rest[0], 'user_id'), now))
    console.log('revoked every device, pairing code and unused invitation of this user')
    break
  default:
    console.error('commands: user add <name> [--subjects a,b] | invite <user_id> | devices <user_id> | revoke-device <id> | revoke-user <id>')
    process.exit(1)
}
