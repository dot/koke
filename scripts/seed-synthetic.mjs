// Generates a synthetic history as SQL for measuring query cost (#3), e.g.:
//   node scripts/seed-synthetic.mjs --years 3 > /tmp/seed.sql
//   npx wrangler d1 execute koke --local --file /tmp/seed.sql
// Learners, sessions and revisions are invented; no real data is involved.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const LEARNERS = Number(args.learners ?? 5);
const YEARS = Number(args.years ?? 3);
const SESSIONS_PER_DAY = Number(args.sessions ?? 5);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const END = Date.UTC(2026, 10, 15);
const START = END - YEARS * 365 * DAY;

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const out = [];
let sessionId = 0;
let subjectId = 0;
for (let u = 1; u <= LEARNERS; u++) {
  out.push(`INSERT INTO users (user_id, display_name, created_at) VALUES (${u}, 'learner ${u}', ${START});`);
  const subjects = [];
  for (let p = 0; p < 5; p++) {
    subjectId++;
    subjects.push(subjectId);
    out.push(
      `INSERT INTO subjects (subject_id, user_id, name, position, created_at) VALUES (${subjectId}, ${u}, 'subject ${p}', ${p}, ${START});`,
    );
  }
  for (let day = START; day < END; day += DAY) {
    // 16:00 JST onwards, one session after another.
    let t = day + 7 * 60 * MIN;
    for (let s = 0; s < SESSIONS_PER_DAY; s++) {
      sessionId++;
      const started = t + randInt(0, 30) * MIN;
      const ended = started + randInt(15, 90) * MIN;
      const subject = rand() < 0.1 ? "NULL" : subjects[randInt(0, 4)];
      out.push(`INSERT INTO sessions (session_id, user_id, created_at) VALUES (${sessionId}, ${u}, ${started});`);
      let rev = 1;
      const row = (fields) =>
        `INSERT INTO session_revisions (session_id, rev, user_id, subject_id, started_at, ended_at, away_at, prompted_at, deleted, source, created_at) VALUES (${sessionId}, ${rev++}, ${u}, ${subject}, ${started}, ${fields.ended ?? "NULL"}, ${fields.away ?? "NULL"}, NULL, 0, '${fields.source}', ${fields.at});`;
      out.push(row({ source: "app", at: started }));
      // Phone locked or switched away a few times while studying on paper.
      const aways = randInt(4, 8);
      for (let a = 1; a <= aways; a++) {
        const at = started + Math.floor(((ended - started) * a) / (aways + 1));
        out.push(row({ source: "away", away: at, at }));
      }
      out.push(row({ source: "app", ended, at: ended }));
      t = ended + randInt(5, 20) * MIN;
    }
  }
}
process.stdout.write(out.join("\n") + "\n");
