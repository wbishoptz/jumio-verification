export async function onRequest(context) {
  const JUMIO_TOKEN = context.env.JUMIO_TOKEN;
  const JUMIO_SECRET = context.env.JUMIO_SECRET;
  const DATACENTER = 'https://netverify.com/api/v4'; // Default global datacenter

  if (!JUMIO_TOKEN || !JUMIO_SECRET) {
    return new Response(JSON.stringify({ error: "Missing API Keys in Cloudflare" }), { status: 500 });
  }

  const { request } = context;
  const auth = btoa(`${JUMIO_TOKEN}:${JUMIO_SECRET}`);

  // 1. START SCAN (POST)
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const response = await fetch(`${DATACENTER}/initiate`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Cloudflare Worker'
        },
        body: JSON.stringify({
          customerInternalReference: crypto.randomUUID(),
          userReference: body.userEmail || "guest_user",
          successUrl: "https://example.com/success", // Required params, but we handle via callback
          errorUrl: "https://example.com/error"
        })
      });
      const data = await response.json();
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // 2. GET RESULTS (GET)
  if (request.method === "GET") {
    const url = new URL(request.url);
    const scanRef = url.searchParams.get("scanReference");
    
    if (!scanRef) return new Response("Missing Reference", { status: 400 });

    const response = await fetch(`${DATACENTER}/transactions/${scanRef}`, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}` }
    });
    
    const data = await response.json();
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response("Method not allowed", { status: 405 });
}