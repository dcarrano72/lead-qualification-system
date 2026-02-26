import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const data = await req.json();

    // Normalize checkbox value (FormData sends "true" when checked, and omits it when unchecked)
    const decisionMaker =
      data.decision_maker === true ||
      data.decision_maker === "true" ||
      data.decision_maker === "on";

    const { error } = await supabase.from("leads").insert([
      {
        client_slug: data.client_slug ?? null,
        source: data.source ?? null,

        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,

        project_type: data.project_type ?? null,
        budget_range: data.budget_range ?? null,
        timeline: data.timeline ?? null,
        zip: data.zip ?? null,

        decision_maker: decisionMaker,
        description: data.description ?? null,
      },
    ]);

    if (error) {
      console.error("Insert error:", error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Function error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Bad request" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
};