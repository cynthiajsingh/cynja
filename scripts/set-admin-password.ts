import path from 'node:path';
import { createInterface } from 'node:readline';
import { AuthService } from '../src/server/auth/service.ts';
import { databaseUrl, localDataDir } from '../src/server/config.ts';
import { ValidationError } from '../src/server/errors.ts';
import { migrate } from '../src/server/db/migrator.ts';
import { createPgDb } from '../src/server/db/pg.ts';
import type { Db } from '../src/server/db/types.ts';

const args = process.argv.slice(2);
const local = args.includes('--local');
const userArg = args.find((a) => a.startsWith('--username='))?.split('=')[1];

/** Reads a line without echoing it (for passwords). Falls back to piped stdin. */
function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (hidden && process.stdin.isTTY) {
      const write = (rl as unknown as { _writeToOutput: (s: string) => void });
      write._writeToOutput = (s: string) => {
        // A paste can arrive as one redraw of prompt + text; mask everything after the prompt.
        if (s.includes(question)) process.stdout.write(question + '*'.repeat(Math.max(0, s.length - s.indexOf(question) - question.length)));
        else if (s === '\r\n' || s === '\n') process.stdout.write('\n');
        else process.stdout.write('*'.repeat(s.length));
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function openDb(): Promise<Db> {
  if (local) {
    const { createPgliteDb } = await import('../src/server/db/pglite.ts');
    const db = await createPgliteDb(path.resolve(process.cwd(), localDataDir(), 'pglite'));
    await migrate(db);
    return db;
  }
  // Ask for the connection string when it isn't in the environment, so nobody has to quote it in a shell.
  const raw = databaseUrl() ?? (await ask('Paste the DATABASE_URL value from Netlify, then press Enter: ', true)).trim();
  if (!raw) {
    console.error('No connection string given. Copy DATABASE_URL from Netlify, or pass --local for development.');
    process.exit(1);
  }
  // Tolerate pasted snippets such as `psql 'postgresql://…'` or `DATABASE_URL="postgresql://…"`.
  const url = raw.match(/postgres(?:ql)?:\/\/[^\s'"]+/)?.[0];
  if (!url) {
    const preview = raw.replace(/(\/\/[^:]+:)[^@]+@/, '$1****@').slice(0, 40);
    console.error(`DATABASE_URL does not contain a postgresql:// connection string. It starts with: ${preview}`);
    console.error('In Neon, click Connect, choose "Connection string", copy it, and set it again.');
    process.exit(1);
  }
  const target = new URL(url);
  console.log(`Database: ${target.hostname}${target.pathname}`);
  const db = createPgDb(url);
  await migrate(db);
  return db;
}

const db = await openDb();
try {
  const auth = new AuthService(db);
  const exists = await auth.adminExists();
  console.log(exists ? 'Resetting the admin password. Every signed-in session will be signed out.' : 'Creating the admin account.');
  const username = userArg ?? ((await ask('Username [cynthia]: ')).trim() || 'cynthia');
  const password = process.env.ADMIN_PASSWORD ?? (await ask('New password (min 12 characters): ', true));
  if (!process.env.ADMIN_PASSWORD) {
    const again = await ask('Repeat password: ', true);
    if (again !== password) {
      console.error('Passwords do not match. Nothing was changed.');
      process.exit(1);
    }
  }
  const admin = await auth.setAdminPassword(username, password);
  console.log(`Done. Sign in at /admin/login as "${admin.username}".`);
} catch (err) {
  console.error(err instanceof ValidationError ? `Not changed: ${err.message} ${Object.values(err.fields).join(' ')}` : err);
  process.exitCode = 1;
} finally {
  await db.close();
}
