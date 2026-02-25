export default async (req) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const data = await req.json();

    // For now: just confirm we received it
    console.log("Lead received:", data);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: "Bad JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
};