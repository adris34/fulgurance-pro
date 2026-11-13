import type { APIRoute } from 'astro';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const prerender = false;

// Ensemble de données Meta « Fulgurance.com » (pros).
const META_DATASET_ID = '1728638377582461';
const GRAPH_VERSION = 'v21.0';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta.env as Record<string, string | undefined>)[name];
}

/** Téléphone au format E.164 sans « + » (France par défaut), puis hash. */
function normalizePhone(raw: string): string | undefined {
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (digits.startsWith('+')) return digits.slice(1) || undefined;
  if (digits.startsWith('0')) return '33' + digits.slice(1);
  return digits || undefined;
}

/** Cherche le téléphone dans la réservation Cal (le nom du champ varie selon la configuration). */
function findPhone(payload: any, attendee: any): string | undefined {
  const direct = attendee?.phoneNumber ?? payload?.responses?.attendeePhoneNumber?.value;
  if (typeof direct === 'string' && direct) return direct;
  const responses = payload?.responses ?? {};
  for (const [key, field] of Object.entries<any>(responses)) {
    if (/phone|tel/i.test(key) && typeof field?.value === 'string' && field.value) return field.value;
  }
  return undefined;
}

function validSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const token = env('META_CAPI_TOKEN');
  const secret = env('CAL_WEBHOOK_SECRET');
  if (!token || !secret) {
    console.error('cal-webhook: META_CAPI_TOKEN ou CAL_WEBHOOK_SECRET manquant');
    return json({ error: 'Not configured' }, 500);
  }

  const rawBody = await request.text();
  if (!validSignature(rawBody, request.headers.get('x-cal-signature-256'), secret)) {
    return json({ error: 'Invalid signature' }, 401);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Seules les nouvelles réservations déclenchent « Schedule ».
  if (body?.triggerEvent !== 'BOOKING_CREATED') return json({ ignored: body?.triggerEvent ?? 'unknown' });

  const payload = body.payload ?? {};
  const attendee = payload.attendees?.[0];
  const email = attendee?.email?.trim().toLowerCase();
  if (!attendee || !email) return json({ error: 'No attendee email' }, 400);

  const [firstName, ...rest] = String(attendee.name ?? '').trim().toLowerCase().split(/\s+/);
  const lastName = rest.join(' ');
  const phone = findPhone(payload, attendee);
  const phoneNormalized = phone ? normalizePhone(phone) : undefined;

  const event = {
    event_name: 'Schedule',
    event_time: Math.floor(Date.now() / 1000),
    // Identifiant de la réservation : Meta ignore un événement envoyé deux fois.
    event_id: String(payload.uid ?? payload.bookingId ?? sha256(rawBody)),
    // Événement envoyé par le serveur (pas par le navigateur du visiteur).
    action_source: 'system_generated',
    user_data: {
      em: [sha256(email)],
      ...(phoneNormalized && { ph: [sha256(phoneNormalized)] }),
      ...(firstName && { fn: [sha256(firstName)] }),
      ...(lastName && { ln: [sha256(lastName)] }),
      country: [sha256('fr')],
      external_id: [sha256(email)],
    },
    custom_data: {
      event_source: 'crm',
      lead_event_source: 'Cal.com',
    },
  };

  const testCode = env('META_TEST_EVENT_CODE');
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${META_DATASET_ID}/events?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], ...(testCode && { test_event_code: testCode }) }),
    }
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('cal-webhook: Meta a refusé l\'événement', response.status, JSON.stringify(result));
    return json({ error: 'Meta error', details: result }, 502);
  }
  return json({ ok: true, events_received: result.events_received, test: Boolean(testCode) });
};
