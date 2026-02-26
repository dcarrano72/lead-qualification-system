import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

function scoreLead(data) {
  let score = 0;
  const notes = [];

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

  const desc = (data.description ?? "").trim();
  if (desc.length >= 50) {
    score += 10;
    notes.push("Description detail: +10");
  } else {
    notes.push("Description detail: +0");
  }

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

function label(v) {
  if (!v) return "—";
  // pretty-print select values like "60k_plus" -> "60k plus"
  return String(v).replace(/_/g, " ");
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

    // Validate client exists + get notification email
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
    const insertPayload = {
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
    };

    const { data: inserted, error: insertError } = await supabase
      .from("leads")
      .insert([insertPayload])
      .select("id, created_at")
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ ok: false, error: insertError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Email (send for both qualified + unqualified)
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const leadName = `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "New Lead";

    const subjectPrefix = scored.isQualified ? "✅ Qualified" : "⚠️ Unqualified";
    const subject = `${subjectPrefix} Lead (Score ${scored.score}) — ${label(
      data.project_type
    )}`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>${subjectPrefix} Lead</h2>
        <p><strong>Client:</strong> ${client.company_name} (${client.slug})</p>
        <p><strong>Score:</strong> ${scored.score}<br/>
           <strong>Notes:</strong> ${scored.notes}</p>

        <hr/>

        <p><strong>Name:</strong> ${leadName}<br/>
           <strong>Email:</strong> ${data.email ?? "—"}<br/>
           <strong>Phone:</strong> ${data.phone ?? "—"}<br/>
           <strong>ZIP:</strong> ${data.zip ?? "—"}</p>

        <p><strong>Project:</strong> ${label(data.project_type)}<br/>
           <strong>Budget:</strong> ${label(data.budget_range)}<br/>
           <strong>Timeline:</strong> ${label(data.timeline)}<br/>
           <strong>Decision maker:</strong> ${scored.decisionMaker ? "Yes" : "No"}<br/>
           <strong>Source:</strong> ${data.source ?? "—"}</p>

        <p><strong>Description:</strong><br/>
        ${String(data.description ?? "—").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>

        <hr/>
        <p style="color:#666; font-size: 12px;">
          Lead ID: ${inserted?.id ?? "—"}<br/>
          Received: ${inserted?.created_at ?? "—"}
        </p>
      </div>
    `;

    const { error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: [client.notification_email],
      subject,
      html,
    });

    if (emailError) {
      // Don't fail the request if email fails—lead is already saved.
      console.error("Resend error:", emailError);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        score: scored.score,
        is_qualified: scored.isQualified,
        emailed: !emailError,
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