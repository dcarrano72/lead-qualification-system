import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function scoreLead(data) {
  let score = 0;
  const notes = [];

  // Budget scoring
  const budgetPoints = {
    under_5k: 0,
    "5k_15k": 10,
    "15k_30k": 20,
    "30k_60k": 30,
    "60k_plus": 40,
  };
  const b = data.budget_range;
  if (b && b in budgetPoints) {
    score += budgetPoints[b];
    notes.push(`Budget: +${budgetPoints[b]}`);
  } else {
    notes.push("Budget: +0 (missing/unknown)");
  }

  // Timeline scoring
  const timelinePoints = {
    asap: 20,
    "1_3_months": 15,
    "3_6_months": 10,
    just_researching: 0,
  };
  const t = data.timeline;
  if (t && t in timelinePoints) {
    score += timelinePoints[t];
    notes.push(`Timeline: +${timelinePoints[t]}`);
  } else {
    notes.push("Timeline: +0 (missing/unknown)");
  }

  // Decision maker scoring
  const decisionMaker =
    data.decision_maker === true ||
    data.decision_maker === "true" ||
    data.decision_maker === "on";
  if (decisionMaker) {
    score += 20;
    notes.push("Decision maker: +20");
  } else {
    notes.push("Decision maker: +0");
  }

  // Description quality
  const desc = (data.description ?? "").trim();
  if (desc.length >= 50) {
    score += 10;
    notes.push("Description detail: +10");
  } else {
    notes.push("Description detail: +0");
  }

  // Phone present
  const phone = (data.phone ?? "").trim();
  if (phone.length > 0) {
    score += 5;
    notes.push("Phone provided: +5");
  } else {
    notes.push("Phone provided: +0");
  }

  const isQualified = score >= 60;

  return {
    score,
    isQualified,
    notes: notes.join(" | "),
    decisionMaker,
  };
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const data = await req.json();

    if (!data.client_slug) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing client slug" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate client exists
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, slug, company_name, notification_email")
      .eq("slug", data.client_slug)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid client" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Score lead
    const scored = scoreLead(data);

    // Insert lead
    const { error } = await supabase.from("leads").insert([
      {
        client_slug: data.client_slug,
        source: data.source ?? null,

        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,

        project_type: data.project_type ?? null,
        budget_range: data.budget_range ?? null,
        timeline: data.timeline ?? null,
        zip: data.zip ?? null,

        decision_maker: scored.decisionMaker,
        description: data.description ?? null,

        score: scored.score,
        is_qualified: scored.isQualified,
        qualification_notes: scored.notes,
      },
    ]);

    if (error) {
      console.error("Insert error:", error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        score: scored.score,
        is_qualified: scored.isQualified,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Function error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Bad request" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
};