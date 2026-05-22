/**
 * Coverage Evidence Match — Anthropic API proxy Worker
 *
 * Accepts POST /  with:
 *   header  X-API-Key: <user's anthropic key>
 *   body    { model, max_tokens, system, messages }
 *
 * Forwards to api.anthropic.com and returns the result with
 * full CORS headers so any browser origin can call it.
 */
export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
      'Access-Control-Max-Age': '86400',
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders,
      })
    }

    const apiKey = request.headers.get('X-API-Key')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { message: 'Missing X-API-Key header' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }

    const body = await request.text()

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body,
    })

    const responseText = await upstream.text()

    return new Response(responseText, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    })
  },
}
