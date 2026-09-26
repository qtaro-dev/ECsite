import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const githubEnv = process.env.GITHUB_ENV;
if (!apiUrl || !serviceRoleKey || !githubEnv) throw new Error('Local Supabase and GitHub Actions environment are required');

const email = 't28-member@example.test';
const password = randomBytes(32).toString('base64url');
const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const body = await response.json();
if (!response.ok || !body.id) throw new Error(`Could not create local T28 test account (${response.status})`);
process.stdout.write(`::add-mask::${password}\n`);
await appendFile(githubEnv, `T28_MEMBER_EMAIL=${email}\nT28_MEMBER_PASSWORD=${password}\n`, { mode: 0o600 });
