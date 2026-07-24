// Thin MailerLite (connect.mailerlite.com) REST client. fetch is injected so the
// logic is unit-testable without network. Every method throws on non-2xx with the
// status + a short body snippet (never logs the token).
const BASE = 'https://connect.mailerlite.com/api';

export function mailerlite(token, fetchImpl = fetch) {
  async function req(method, path, body) {
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`MailerLite ${method} ${path} → ${res.status}: ${snippet}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    async listActiveSubscribers() {
      const out = [];
      let cursor = null;
      do {
        const qs = `limit=100&filter[status]=active${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page = await req('GET', `/subscribers?${qs}`);
        for (const s of page.data || []) out.push({ id: s.id, email: s.email, fields: s.fields || {} });
        cursor = page.meta && page.meta.next_cursor ? page.meta.next_cursor : null;
      } while (cursor);
      return out;
    },
    async listFields() {
      const r = await req('GET', '/fields?limit=100');
      return (r.data || []).map((x) => ({ id: x.id, key: x.key, name: x.name }));
    },
    async createField(name) {
      const r = await req('POST', '/fields', { name, type: 'text' });
      return { id: r.data.id, key: r.data.key, name: r.data.name };
    },
    async ensureGroup(name) {
      const r = await req('GET', `/groups?filter[name]=${encodeURIComponent(name)}&limit=100`);
      const found = (r.data || []).find((g) => g.name === name);
      if (found) return { id: found.id, name: found.name };
      const c = await req('POST', '/groups', { name });
      return { id: c.data.id, name: c.data.name };
    },
    async setSubscriberGroup(subscriberId, groupId) {
      await req('POST', `/subscribers/${subscriberId}/groups/${groupId}`);
    },
    async createCampaign({ name, subject, fromName, from, html, groupId }) {
      const r = await req('POST', '/campaigns', {
        name,
        type: 'regular',
        emails: [{ subject, from_name: fromName, from, content: html }],
        groups: [groupId],
      });
      return { id: r.data.id };
    },
    async sendCampaign(id) {
      await req('POST', `/campaigns/${id}/schedule`, { delivery: 'instant' });
    },
  };
}
