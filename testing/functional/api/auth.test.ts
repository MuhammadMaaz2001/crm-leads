import { describe, expect, it } from 'vitest';
import { api, getBaseUrl, loginAsCookie, SEED } from './helpers';

describe('health & config', () => {
  it('GET /api/health', async () => {
    const { status, data } = await api<{ ok: boolean }>('/api/health');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('GET /api/config does not expose an email-domain policy', async () => {
    const { status, data } = await api<Record<string, unknown>>('/api/config');
    expect(status).toBe(200);
    expect(data).not.toHaveProperty('allowAnyEmailDomain');
    expect(data).not.toHaveProperty('allowedEmailDomain');
    expect(data).not.toHaveProperty('allowedEmailDomains');
  });
});

describe('auth', () => {
  it('logs in founder with seed credentials', async () => {
    const session = await loginAsCookie(SEED.founder);
    expect(session.token.length).toBeGreaterThan(20);
    expect(session.user.role).toBe('founder');
    expect(session.user.email).toBe(SEED.founder);
  });

  it('rejects bad password', async () => {
    const { status, data } = await api<{ error: string }>('/api/auth/login', {
      body: { email: SEED.founder, password: 'wrong-password' },
    });
    expect(status).toBe(401);
    expect(data.error).toMatch(/invalid/i);
  });

  it('rejects a malformed email at login', async () => {
    const { status, data } = await api<{ error: string }>('/api/auth/login', {
      body: { email: 'not-an-email', password: 'x' },
    });
    expect(status).toBe(400);
    expect(data.error).toMatch(/valid email/i);
  });

  it('does not reject a non-company email domain at login (unknown user → 401)', async () => {
    const { status } = await api<{ error: string }>('/api/auth/login', {
      body: { email: 'nobody.registered@gmail.com', password: 'x' },
    });
    expect(status).toBe(401);
  });

  it('GET /api/auth/me restores session', async () => {
    const { cookieHeader } = await loginAsCookie(SEED.sdr);

    const me = await api<{
      user: {
        email: string;
        role: string;
      };
    }>('/api/auth/me', {
      headers: {
        cookie: cookieHeader,
      },
    });

    expect(me.status).toBe(200);
    expect(me.data.user.email).toBe(SEED.sdr);
    expect(me.data.user.role).toBe('sdr');
  });

  it('logout ends server session (heartbeat fails)', async () => {
    const session = await loginAsCookie(SEED.sdr);
    const out = await api('/api/auth/logout', {
      method: 'POST',
      session,
      body: { reason: 'manual' },
    });
    expect(out.status).toBe(204);
    const hb = await api('/api/auth/heartbeat', { method: 'POST', session, body: {} });
    expect(hb.status).toBe(401);
  });

  it('heartbeat keeps session alive', async () => {
    const session = await loginAsCookie(SEED.founder);
    const hb = await api('/api/auth/heartbeat', { method: 'POST', session, body: {} });
    expect(hb.status).toBe(200);
  });

  it('login response does not expose the JWT; auth cookie is HttpOnly + SameSite=Lax', async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: SEED.founder, password: 'TestSeed123!' }),
    });
    const data = (await res.json()) as { token?: string };
    expect(res.status).toBe(200);
    expect(data.token).toBeUndefined();

    const authCookie = res.headers.getSetCookie().find((c) => c.startsWith('token='));
    expect(authCookie).toBeDefined();
    expect(authCookie).toContain('HttpOnly');
    expect(authCookie).toContain('SameSite=Lax');
  });

  it('cookie-only authentication works for GET /api/auth/me', async () => {
    const session = await loginAsCookie(SEED.sdr);
    const me = await api<{ user: { email: string } }>('/api/auth/me', {
      headers: { cookie: session.cookieHeader },
    });
    expect(me.status).toBe(200);
    expect(me.data.user.email).toBe(SEED.sdr);
  });

  it('cookie-authenticated mutation without CSRF token is rejected', async () => {
    const session = await loginAsCookie(SEED.founder);
    const res = await api('/api/auth/heartbeat', {
      method: 'POST',
      headers: { cookie: session.cookieHeader },
      body: {},
    });
    expect(res.status).toBe(403);
  });

  it('cookie-authenticated mutation with correct CSRF token succeeds', async () => {
    const session = await loginAsCookie(SEED.founder);
    expect(session.csrfToken).toBeTruthy();

    const res = await api('/api/auth/heartbeat', {
      method: 'POST',
      headers: { cookie: session.cookieHeader, 'x-csrf-token': session.csrfToken },
      body: {},
    });
    expect(res.status).toBe(200);
  });

  it('invalid CSRF token is rejected', async () => {
    const session = await loginAsCookie(SEED.founder);
    const res = await api('/api/auth/heartbeat', {
      method: 'POST',
      headers: { cookie: session.cookieHeader, 'x-csrf-token': 'invalid-token' },
      body: {},
    });
    expect(res.status).toBe(403);
  });
});

describe('RBAC', () => {
  it('SDR cannot list users; founder can', async () => {
    const sdrSession = await loginAsCookie(SEED.sdr);
    expect((await api('/api/users', { session: sdrSession })).status).toBe(403);

    const founderSession = await loginAsCookie(SEED.founder);
    const res = await api<{ users: { email: string }[] }>('/api/users', {
      session: founderSession,
    });
    expect(res.status).toBe(200);
    expect(res.data.users.some((u) => u.email === SEED.founder)).toBe(true);
  });

  it('founder can create users on any valid email domain and they can log in', async () => {
    const founderSession = await loginAsCookie(SEED.founder);
    const run = Date.now().toString(36);
    const password = 'AnyDomain123!';
    const emails = [
      `anydomain.${run}@gmail.com`,
      `anydomain.${run}@outlook.com`,
      `anydomain.${run}@acme-corp.io`,
    ];

    for (const email of emails) {
      const created = await api<{ user: { email: string; role: string } }>('/api/users', {
        method: 'POST',
        session: founderSession,
        body: { email, name: 'Any Domain', password, role: 'sdr' },
      });
      expect(created.status).toBe(201);
      expect(created.data.user.email).toBe(email);

      const session = await loginAsCookie(email, password);
      expect(session.user.email).toBe(email);
    }
  });

  it('creating a user with a malformed email is rejected', async () => {
    const founderSession = await loginAsCookie(SEED.founder);
    const res = await api<{ error: string }>('/api/users', {
      method: 'POST',
      session: founderSession,
      body: { email: 'bad@nodot', name: 'Bad', password: 'AnyDomain123!', role: 'sdr' },
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/valid email/i);
  });

  it('non-admins still cannot create users', async () => {
    const sdrSession = await loginAsCookie(SEED.sdr);
    const res = await api('/api/users', {
      method: 'POST',
      session: sdrSession,
      body: { email: 'x@gmail.com', name: 'X', password: 'AnyDomain123!', role: 'sdr' },
    });
    expect(res.status).toBe(403);
  });

  it('SDR cannot access activity overview', async () => {
    const session = await loginAsCookie(SEED.sdr);
    expect((await api('/api/activity/overview?userId=all', { session })).status).toBe(403);
  });

  it('SDR cannot delete companies', async () => {
    const founderSession = await loginAsCookie(SEED.founder);
    const boot = await api<{ companies: { id: string }[] }>('/api/bootstrap', {
      session: founderSession,
    });
    const companyId = boot.data.companies[0]?.id;
    expect(companyId).toBeTruthy();

    const sdrSession = await loginAsCookie(SEED.sdr);
    expect(
      (await api(`/api/companies/${companyId}`, { method: 'DELETE', session: sdrSession })).status
    ).toBe(403);
  });
});
