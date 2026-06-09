import type { APIRoute } from 'astro';
import { createHash } from 'crypto';

export const prerender = false;

const META_PIXEL_ID = '837162387870629';
const META_ACCESS_TOKEN = import.meta.env.META_CAPI_TOKEN;

function hash(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    // Cal.com webhook payload
    const attendee = body?.payload?.attendees?.[0];
    if (!attendee) {
      return new Response(JSON.stringify({ error: 'No attendee found' }), { status: 400 });
    }

    const email = attendee.email?.trim().toLowerCase();
    const name = attendee.name?.trim();
    const ip = request.headers.get('x-forwarded-for') || '';
    const userAgent = request.headers.get('user-agent') || '';

    // Build Meta CAPI event
    const eventData = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: 'https://www.fulgurance.com/merci',
          user_data: {
            em: email ? [hash(email)] : undefined,
            fn: name ? [hash(name.split(' ')[0])] : undefined,
            ln: name?.split(' ')[1] ? [hash(name.split(' ')[1])] : undefined,
            client_ip_address: ip,
            client_user_agent: userAgent,
          },
        },
      ],
    };

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      }
    );

    const result = await response.json();
    return new Response(JSON.stringify(result), { status: 200 });

  } catch (err) {
    console.error('CAPI error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
};
