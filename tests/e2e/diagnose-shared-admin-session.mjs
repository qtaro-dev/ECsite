// Local CI diagnostic only: never log credentials or response bodies.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || !process.env.CI || new URL(url).hostname !== '127.0.0.1') throw new Error('Local CI Supabase required');
const headers = { apikey: key, 'content-type': 'application/json' };
async function login() {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers,
    body: JSON.stringify({ email: process.env.T36_ADMIN_EMAIL, password: process.env.T36_ADMIN_PASSWORD }) });
  if (!response.ok) throw new Error(`Diagnostic login failed: ${response.status}`);
  return (await response.json()).access_token;
}
const first = await login();
const second = await login();
const userStatus = async (token) => (await fetch(`${url}/auth/v1/user`, { headers: { ...headers, authorization: `Bearer ${token}` } })).status;
console.log(`Shared-admin diagnostic before global logout: ${await userStatus(second)}`);
const logout = await fetch(`${url}/auth/v1/logout?scope=global`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${first}` } });
console.log(`Shared-admin diagnostic global logout: ${logout.status}`);
console.log(`Shared-admin diagnostic other session after global logout: ${await userStatus(second)}`);
