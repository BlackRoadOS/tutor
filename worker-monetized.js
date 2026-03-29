export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "tutor-blackroad", version: "2.0.0" });
      }

      if (request.method === "GET" && url.pathname === "/api/info") {
        return json({ name: "RoadWork Tutor", description: "Homework solver — $1/solve", version: "2.0.0", endpoints: ["/health", "/api/info", "/solve", "/solve/:id", "/webhook/stripe"] });
      }

      if (request.method === "POST" && url.pathname === "/solve") {
        return handleSolve(request, env);
      }

      if (request.method === "GET" && url.pathname.startsWith("/solve/")) {
        const id = url.pathname.split("/")[2];
        return handleGetSolve(id, env);
      }

      if (request.method === "POST" && url.pathname === "/webhook/stripe") {
        return handleStripeWebhook(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Not found" }, 404);
      }

      // Serve HTML UI
      return new Response(HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "frame-ancestors 'self' https://blackroad.io https://*.blackroad.io",
        },
      });
    } catch (err) {
      return json({ error: "Internal error", detail: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
};

async function handleSolve(request, env) {
  const body = await request.json().catch(() => null);
  const question = (body?.question || "").trim();
  if (!question) return json({ error: "Missing question" }, 400);
  if (question.length > 4000) return json({ error: "Question too long (4000 char max)" }, 400);

  const solveId = crypto.randomUUID().slice(0, 12);
  const fullAnswer = await generateAnswer(question, env);
  const preview = makePreview(fullAnswer);

  await ensureTable(env.DB);
  await env.DB.prepare(
    `INSERT INTO solves (id, question, preview, full_answer, paid, stripe_checkout_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'))`
  ).bind(solveId, question, preview, fullAnswer).run();

  const checkout = await createCheckoutSession({ env, solveId, question });

  await env.DB.prepare(
    `UPDATE solves SET stripe_checkout_session_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(checkout.id, solveId).run();

  return json({
    id: solveId,
    preview,
    paid: false,
    checkout_url: checkout.url,
    retrieve_url: `${env.APP_URL || 'https://tutor.blackroad.io'}/solve/${solveId}`,
  });
}

async function handleGetSolve(id, env) {
  if (!id) return json({ error: "Missing solve id" }, 400);
  await ensureTable(env.DB);

  const row = await env.DB.prepare(
    `SELECT id, question, preview, full_answer, paid, created_at, updated_at FROM solves WHERE id = ? LIMIT 1`
  ).bind(id).first();

  if (!row) return json({ error: "Solve not found" }, 404);

  return json({
    id: row.id,
    question: row.question,
    paid: Boolean(row.paid),
    answer: row.paid ? row.full_answer : row.preview,
    locked: !Boolean(row.paid),
    created_at: row.created_at,
  });
}

async function handleStripeWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");
  if (!signature) return json({ error: "Missing Stripe-Signature" }, 400);

  const isValid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) return json({ error: "Invalid signature" }, 400);

  const event = JSON.parse(rawBody);
  if (event.type === "checkout.session.completed") {
    const solveId = event.data?.object?.metadata?.solve_id;
    if (solveId) {
      await ensureTable(env.DB);
      await env.DB.prepare(`UPDATE solves SET paid = 1, updated_at = datetime('now') WHERE id = ?`).bind(solveId).run();
    }
  }

  return json({ received: true });
}

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS solves (
    id TEXT PRIMARY KEY, question TEXT NOT NULL, preview TEXT NOT NULL,
    full_answer TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
    stripe_checkout_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
}

async function generateAnswer(question, env) {
  const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: "You are a precise homework tutor on BlackRoad OS. Give a correct, step-by-step answer. Show your work. Be warm and encouraging. If ambiguous, state your assumption." },
      { role: "user", content: question },
    ],
    max_tokens: 900,
    temperature: 0.2,
  });
  const text = result?.response || "";
  if (!text.trim()) throw new Error("AI returned empty answer");
  return text.trim();
}

function makePreview(fullAnswer) {
  const sentences = fullAnswer.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+/g) || [fullAnswer.slice(0, 120)];
  return sentences.slice(0, 2).join(" ").trim() + (sentences.length > 2 ? "..." : "");
}

async function createCheckoutSession({ env, solveId, question }) {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${env.APP_URL || 'https://tutor.blackroad.io'}/solve/${solveId}?paid=1`);
  form.set("cancel_url", `${env.APP_URL || 'https://tutor.blackroad.io'}/solve/${solveId}?canceled=1`);
  form.set("line_items[0][price]", env.STRIPE_PRICE_ID);
  form.set("line_items[0][quantity]", "1");
  form.set("metadata[solve_id]", solveId);
  form.set("metadata[question]", question.slice(0, 200));

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Stripe error: ${await res.text()}`);
  return await res.json();
}

async function verifyStripeSignature(payload, stripeSignature, webhookSecret) {
  const parts = Object.fromEntries(stripeSignature.split(",").map((item) => { const idx = item.indexOf("="); return [item.slice(0, idx), item.slice(idx + 1)]; }));
  const timestamp = parts.t, v1 = parts.v1;
  if (!timestamp || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== v1.length) return false;
  let out = 0;
  for (let i = 0; i < expected.length; i++) out |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return out === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RoadWork Tutor — Homework Solver | BlackRoad OS</title>
<meta name="description" content="Upload your homework question. Get a step-by-step solution. $1 per solve.">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--surface:#111;--border:#1a1a1a;--text:#e5e5e5;--dim:#888;--pink:#FF2255;--green:#22c55e}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{max-width:560px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:40px}
h1{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;margin-bottom:8px}
.sub{color:var(--dim);font-size:14px;margin-bottom:24px}
textarea{width:100%;height:120px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;color:var(--text);font-size:14px;font-family:'Inter',sans-serif;resize:vertical;outline:none}
textarea:focus{border-color:#333}
textarea::placeholder{color:#333}
.btn{width:100%;margin-top:16px;padding:14px;background:var(--pink);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:'Space Grotesk',sans-serif}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.btn:hover:not(:disabled){opacity:0.9}
.result{margin-top:24px;display:none}
.preview{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;font-size:14px;line-height:1.6}
.full{background:var(--bg);border:1px solid var(--green);border-radius:8px;padding:16px;font-size:14px;line-height:1.6;white-space:pre-wrap}
.lock{margin-top:12px;padding:12px;background:#1a1a1a;border:1px solid var(--border);border-radius:8px;text-align:center;font-size:13px;color:var(--dim)}
.lock a{color:var(--pink);text-decoration:none;font-weight:600}
.unlock{color:var(--green);font-size:13px;margin-top:8px}
.price{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--dim);text-align:center;margin-top:20px}
</style></head><body>
<div class="card">
  <h1>Homework Solver</h1>
  <p class="sub">Paste your question. Get a step-by-step answer.</p>
  <textarea id="q" placeholder="What's your homework question?" autofocus></textarea>
  <button class="btn" id="solve" onclick="doSolve()">Solve — $1</button>
  <div class="result" id="result"></div>
  <p class="price">Powered by BlackRoad OS — Remember the Road. Pave Tomorrow.</p>
</div>
<script>
async function doSolve(){
  const q=document.getElementById('q').value.trim();
  if(!q) return;
  const btn=document.getElementById('solve');
  btn.disabled=true; btn.textContent='Thinking...';
  const res=document.getElementById('result');
  try{
    const r=await fetch('/solve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})});
    const d=await r.json();
    if(d.error){res.style.display='block';res.innerHTML='<div class="preview">'+esc(d.error)+'</div>';btn.disabled=false;btn.textContent='Solve — $1';return;}
    res.style.display='block';
    res.innerHTML='<div class="preview">'+esc(d.preview)+'</div>'
      +'<div class="lock">Full step-by-step solution ready. <a href="'+esc(d.checkout_url)+'">Unlock for $1</a></div>';
    // Poll for payment
    const poll=setInterval(async()=>{
      const r2=await fetch('/solve/'+d.id);
      const d2=await r2.json();
      if(d2.paid){
        clearInterval(poll);
        res.innerHTML='<div class="full">'+esc(d2.answer)+'</div><div class="unlock">Unlocked. Full solution above.</div>';
      }
    },3000);
  }catch(e){res.style.display='block';res.innerHTML='<div class="preview">Error: '+esc(e.message)+'</div>';}
  btn.disabled=false;btn.textContent='Solve Another — $1';
}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>');}
document.getElementById('q').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSolve();}});
</script>
</body></html>`;
