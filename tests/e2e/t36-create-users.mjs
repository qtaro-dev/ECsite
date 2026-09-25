import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const githubEnv = process.env.GITHUB_ENV;
if (!apiUrl || !serviceRoleKey || !githubEnv) throw new Error('Local Supabase and GitHub Actions environment are required');

async function createUser(email) {
  const password = randomBytes(32).toString('base64url');
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.id) throw new Error(`Could not create local T36 test account (${response.status})`);
  return { email, password };
}

const [admin, member] = await Promise.all([
  createUser('t36-admin@example.test'),
  createUser('t36-member@example.test'),
]);
const envLines = [
  `T36_ADMIN_EMAIL=${admin.email}`,
  `T36_ADMIN_PASSWORD=${admin.password}`,
  `T36_MEMBER_EMAIL=${member.email}`,
  `T36_MEMBER_PASSWORD=${member.password}`,
];
for (const line of envLines.filter((entry) => entry.includes('_PASSWORD='))) {
  process.stdout.write(`::add-mask::${line.slice(line.indexOf('=') + 1)}\n`);
}
await appendFile(githubEnv, `${envLines.join('\n')}\n`, { mode: 0o600 });
