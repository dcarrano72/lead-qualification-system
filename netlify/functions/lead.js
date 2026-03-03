import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Industry-aware scoring presets.
 * You can tune these numbers safely without changing logic.
 */
const SCORING_PRESETS = {
  roofing: {
  threshold: 55,
  budget: {
    under_5k: 0,
    "5k_15k": 10,
    "15k_30k": 30,
    "30k_50k": 35,
    "50k_plus": 40,
    unknown: 5,
  },
  timeline: {
    asap: 30,
    "1_3_months": 20,
    "3_6_months": 10,
    just_researching: 0,
  },
  points: {
    decisionMaker: 25,
    descriptionPresent: 5,
    phonePresent: 5,
  },
},

  remodeling: {
    threshold: 60,
    // note: embed uses under_15k, 15k_30k, 30k_60k, 60k_plus
    budget: {
      under_15k: 0,
      "15k_30k": 15,
      "30k_60k": 25,
      "60k_plus": 35,
      unknown: 0,
    },
    timeline: {
      asap: 20,
      "1_3_months": 15,
      "3_6_months": 10,
      just_researching: 0,
    },
    points: {
      decisionMaker: 20,
      descriptionPresent: 5,
      phonePresent: 5,
    },
  },

  general: {
    threshold: 55,
    budget: {
      unknown: 10, // "Not sure yet" shouldn't auto-kill the lead in general mode
      under_5k: 0,
      "5k_15k": 15,
      "15k_30k": 25,
      "30k_60k": 35,
      "60k_plus": 40,
      under_15k: 0,
    },
    timeline: {
      asap: 20,
      "1_3_months": 15,
      "3_6_months": 10,
      just_researching: 0,
    },
    points: {
      decisionMaker: 20,
      descriptionPresent: 5,
      phonePresent: 5,
    },
  },
};

function scoreLead(data) {
  const presetKey = String(data.preset || "general").toLowerCase();
  const config = SCORING_PRESETS[presetKey] || SCORING_PRESETS.general;

  let score = 0;
  const notes = [];

  // Budget
  const b = data.budget_range;
  const bPts = (b && config.budget[b] != null) ? config.budget[b] : 0;
  score += bPts;
  notes.push(`Budget: +${bPts}`);

  // Timeline
  const t = data.timeline;
  const tPts = (t && config.timeline[t] != null) ? config.timeline[t] : 0;
  score += tPts;
  notes.push(`Timeline: +${tPts}`);

  // Decision maker (checkbox)
  const decisionMaker =
    data.decision_maker === true ||
    data.decision_maker === "true" ||
    data.decision_maker === "on";
  if (decisionMaker) {
    score += config.points.decisionMaker;
    notes.push(`Decision maker: +${config.points.decisionMaker}`);
  } else {
    notes.push("Decision maker: +0");
  }

  // Description: presence (NOT length-based)
  const desc = (data.description ?? "").trim();
  if (desc.length > 0) {
    score += config.points.descriptionPresent;
    notes.push(`Description present: +${config.points.descriptionPresent}`);
  } else {
    notes.push("Description present: +0");
  }

  // Phone
  const phone = (data.phone ?? "").trim();
  if (phone.length > 0) {
    score += config.points.phonePresent;
    notes.push(`Phone provided: +${config.points.phonePresent}`);
  } else {
    notes.push("Phone provided: +0");
  }

  const isQualified = score >= config.threshold;

  return {
    score,
    isQualified,
    notes: notes.join(" | "),
    decisionMaker,
    presetKey,
    threshold: config.threshold,
  };
}

function label(v) {
  if (!v) return "—";
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

    // Backwards compatibility: embed.html sends service_type; older version used project_type
    const projectType = data.service_type ?? data.project_type ?? null;

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

      // store in your existing column name
      project_type: projectType,
      budget_range: data.budget_range ?? null,
      timeline: data.timeline ?? null,
      zip: data.zip ?? null,

      decision_maker: scored.decisionMaker,
      description: data.description ?? null,

      score: scored.score,
      is_qualified: scored.isQualified,
      qualification_notes: scored.notes,

      // Optional metadata (only if these columns exist; if not, Supabase will error)
      // If you haven't added these columns, comment these two lines out:
      preset: scored.presetKey,
      qualification_threshold: scored.threshold,
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
    const leadName =
      `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "New Lead";

    const subjectPrefix = scored.isQualified ? "✅ Qualified" : "⚠️ Unqualified";
    const subject = `${subjectPrefix} Lead (Score ${scored.score}) — ${label(
      projectType
    )}`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>${subjectPrefix} Lead</h2>
        <p><strong>Client:</strong> ${client.company_name} (${client.slug})</p>
        <p><strong>Score:</strong> ${scored.score} (threshold ${scored.threshold})<br/>
           <strong>Preset:</strong> ${label(scored.presetKey)}<br/>
           <strong>Notes:</strong> ${scored.notes}</p>

        <hr/>

        <p><strong>Name:</strong> ${leadName}<br/>
           <strong>Email:</strong> ${data.email ?? "—"}<br/>
           <strong>Phone:</strong> ${data.phone ?? "—"}<br/>
           <strong>ZIP:</strong> ${data.zip ?? "—"}</p>

        <p><strong>Project:</strong> ${label(projectType)}<br/>
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

    console.log("Resend: attempting to send email...");
console.log("To:", client.notification_email);
console.log("From:", fromEmail);

let emailErrorMsg = null;

try {
  const { error: emailError } = await resend.emails.send({
    from: fromEmail,
    to: [client.notification_email],
    subject,
    html,
  });

  if (emailError) {
    console.error("Resend error:", emailError);
    emailErrorMsg = emailError.message || JSON.stringify(emailError);
  } else {
    console.log("Resend: email sent successfully");
  }
} catch (e) {
  console.error("Resend exception:", e);
  emailErrorMsg = e?.message || String(e);
}

    return new Response(
      JSON.stringify({
        ok: true,
        score: scored.score,
        is_qualified: scored.isQualified,
        emailed: !emailErrorMsg,
        email_error: emailErrorMsg,
        preset: scored.presetKey,
        threshold: scored.threshold,
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