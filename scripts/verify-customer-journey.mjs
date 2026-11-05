import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { getPrismaClient } from '../src/db/connect.js';

async function runJourney() {
  console.log('--- Starting Customer Journey Verification on zaevi_test ---');

  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.endsWith('zaevi_test')) {
    throw new Error('Safety guard: journey verification can only run on zaevi_test');
  }

  const prisma = getPrismaClient();
  const app = createApp({
    prisma,
    logger: { log() {}, error() {} },
    sessionSecret: 'e2e-verification-secret-32-characters-minimum',
    authRateLimit: false,
    loginRateLimit: false,
  });

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Ephemeral verification server listening at ${baseUrl}`);

  let cookieHeader = '';
  let csrfToken = '';

  function saveCookies(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    if (raw && raw.length) {
      const parts = raw.map(c => c.split(';')[0]);
      cookieHeader = parts.join('; ');
      for (const p of parts) {
        if (p.startsWith('zaevi.csrf=')) {
          csrfToken = p.split('=')[1];
        }
      }
    }
  }

  try {
    // 1. Verify CMS Settings Public Endpoint
    console.log('\n[Step 1] Verify CMS Public Settings endpoint...');
    const cmsRes = await fetch(`${baseUrl}/api/cms/settings/public`);
    assert.equal(cmsRes.status, 200, 'CMS /settings/public returns 200');
    const cmsData = await cmsRes.json();
    assert.ok(cmsData.data, 'CMS data object present');
    assert.ok(!('updatedBy' in cmsData.data), 'internal updatedBy field is excluded');
    console.log(`✓ CMS public settings OK (siteName: "${cmsData.data.siteName}")`);

    // 1b. Verify CMS Settings Alias Endpoint (/api/cms/settings)
    console.log('\n[Step 1b] Verify CMS /settings alias endpoint...');
    const cmsAliasRes = await fetch(`${baseUrl}/api/cms/settings`);
    assert.equal(cmsAliasRes.status, 200, 'CMS /settings alias returns 200');
    console.log('✓ CMS /settings alias OK');

    // 2. Pre-auth CSRF token acquisition
    console.log('\n[Step 2] Obtain initial CSRF cookie...');
    const initRes = await fetch(`${baseUrl}/api/auth/me`);
    saveCookies(initRes);
    assert.equal(initRes.status, 200);
    const initMe = await initRes.json();
    assert.equal(initMe.data, null, 'Unauthenticated user returns null profile');
    console.log(`✓ Initial state confirmed unauthenticated (CSRF token: ${csrfToken ? 'acquired' : 'none'})`);

    // 3. Register a New Customer Account
    const testEmail = `journey-${Date.now()}@zaevi.test`;
    const testPassword = 'LuxuryPassword123!';
    console.log(`\n[Step 3] Registering customer: ${testEmail}...`);

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: 'Lady Eleanor',
        phone: '+91 98200 88888',
      }),
    });
    saveCookies(regRes);
    assert.equal(regRes.status, 201, 'Registration returns 201 Created');
    const regData = await regRes.json();
    assert.equal(regData.data.email, testEmail);
    assert.equal(regData.data.name, 'Lady Eleanor');
    assert.ok(!('passwordHash' in regData.data), 'Password hash never disclosed');
    console.log(`✓ Customer registered (ID: ${regData.data.id})`);

    // 4. Login with Created Account
    console.log('\n[Step 4] Logging in with customer credentials...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    saveCookies(loginRes);
    assert.equal(loginRes.status, 200, 'Login returns 200 OK');
    const loginData = await loginRes.json();
    assert.equal(loginData.data.email, testEmail);
    console.log(`✓ Login successful, session established`);

    // 5. Verify Authenticated Customer Profile
    console.log('\n[Step 5] Fetching current profile (/api/auth/me)...');
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Cookie': cookieHeader },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.data.email, testEmail);
    assert.equal(meData.data.role, 'customer');
    console.log(`✓ Profile verified: ${meData.data.name} (${meData.data.email})`);

    // 6. Test Logout with CSRF Protection
    console.log('\n[Step 6] Testing Logout flow...');
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Cookie': cookieHeader,
        'x-csrf-token': csrfToken,
      },
    });
    saveCookies(logoutRes);
    assert.equal(logoutRes.status, 200, 'Logout returns 200 OK');

    const afterLogoutRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Cookie': cookieHeader },
    });
    const afterLogoutData = await afterLogoutRes.json();
    assert.equal(afterLogoutData.data, null, 'Session invalidated after logout');
    console.log('✓ Logout confirmed, session successfully invalidated');

    // 7. Cleanup test customer
    await prisma.customer.deleteMany({ where: { email: testEmail } });
    console.log('\n✓ Test customer cleaned up from zaevi_test');

    console.log('\n=== ALL CUSTOMER JOURNEY CHECKS PASSED SUCCESSFULLY ===');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runJourney().catch((err) => {
  console.error('\n❌ Customer journey verification failed:', err);
  process.exit(1);
});

