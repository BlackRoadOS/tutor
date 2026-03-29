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

      if (request.method === "POST" && (url.pathname === "/solve" || url.pathname === "/api/solve")) {
        return handleSolve(request, env);
      }

      if (request.method === "GET" && url.pathname.startsWith("/solve/")) {
        const id = url.pathname.split("/")[2];
        const accept = request.headers.get("Accept") || "";
        if (accept.includes("text/html") || !accept.includes("json")) {
          return handleSolvePage(id, env);
        }
        return handleGetSolve(id, env);
      }

      if (request.method === "GET" && url.pathname === "/sitemap.xml") {
        return handleSitemap(env);
      }

      // IndexNow verification
      if (url.pathname === "/B95484290160465AAEB8A563630AC30A.txt") {
        return new Response("B95484290160465AAEB8A563630AC30A", { headers: { "Content-Type": "text/plain" } });
      }

      if (request.method === "GET" && url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nAllow: /\nSitemap: https://tutor.blackroad.io/sitemap.xml\n", { headers: { "Content-Type": "text/plain" } });
      }

      // Topic landing pages for SEO — 100+ pages
      const topics = {
        // Math
        'math':'Math','algebra':'Algebra','calculus':'Calculus','precalculus':'Pre-Calculus','geometry':'Geometry','trigonometry':'Trigonometry','statistics':'Statistics','probability':'Probability','linear-algebra':'Linear Algebra','differential-equations':'Differential Equations','discrete-math':'Discrete Math','number-theory':'Number Theory',
        'quadratic-equations':'Quadratic Equations','systems-of-equations':'Systems of Equations','polynomials':'Polynomials','factoring':'Factoring','logarithms':'Logarithms','exponents':'Exponents','fractions':'Fractions','ratios-and-proportions':'Ratios and Proportions','percentages':'Percentages','inequalities':'Inequalities','absolute-value':'Absolute Value','complex-numbers':'Complex Numbers',
        'derivatives':'Derivatives','integrals':'Integrals','limits':'Limits','series-and-sequences':'Series and Sequences','integration-by-parts':'Integration by Parts','u-substitution':'U-Substitution','chain-rule':'Chain Rule','product-rule':'Product Rule','related-rates':'Related Rates','optimization':'Optimization Problems',
        'mean-median-mode':'Mean, Median, and Mode','standard-deviation':'Standard Deviation','regression':'Regression Analysis','hypothesis-testing':'Hypothesis Testing','confidence-intervals':'Confidence Intervals','normal-distribution':'Normal Distribution','binomial-distribution':'Binomial Distribution','bayes-theorem':'Bayes Theorem',
        'matrices':'Matrices','vectors':'Vectors','eigenvalues':'Eigenvalues and Eigenvectors','dot-product':'Dot Product','cross-product':'Cross Product',
        // Science
        'physics':'Physics','chemistry':'Chemistry','biology':'Biology','earth-science':'Earth Science','environmental-science':'Environmental Science','astronomy':'Astronomy',
        'newtons-laws':'Newton\'s Laws','kinematics':'Kinematics','projectile-motion':'Projectile Motion','circular-motion':'Circular Motion','work-and-energy':'Work and Energy','momentum':'Momentum','thermodynamics':'Thermodynamics','waves':'Waves and Sound','optics':'Optics','electricity':'Electricity and Circuits','magnetism':'Magnetism','quantum-mechanics':'Quantum Mechanics',
        'stoichiometry':'Stoichiometry','chemical-bonding':'Chemical Bonding','acids-and-bases':'Acids and Bases','organic-chemistry':'Organic Chemistry','redox-reactions':'Redox Reactions','equilibrium':'Chemical Equilibrium','gas-laws':'Gas Laws','electrochemistry':'Electrochemistry','periodic-table':'Periodic Table Trends',
        'cell-biology':'Cell Biology','genetics':'Genetics','evolution':'Evolution','ecology':'Ecology','photosynthesis':'Photosynthesis','cellular-respiration':'Cellular Respiration','dna-rna':'DNA and RNA','mitosis-meiosis':'Mitosis and Meiosis','human-anatomy':'Human Anatomy',
        // Computer Science
        'coding':'Coding','python':'Python','javascript':'JavaScript','java':'Java','c-plus-plus':'C++','html-css':'HTML and CSS','sql':'SQL','data-structures':'Data Structures','algorithms':'Algorithms','recursion':'Recursion','sorting-algorithms':'Sorting Algorithms','binary-search':'Binary Search','big-o-notation':'Big O Notation','object-oriented-programming':'Object-Oriented Programming','web-development':'Web Development',
        // Humanities
        'history':'History','english':'English','economics':'Economics','psychology':'Psychology','philosophy':'Philosophy','sociology':'Sociology','political-science':'Political Science',
        'us-history':'US History','world-history':'World History','essay-writing':'Essay Writing','grammar':'Grammar','literary-analysis':'Literary Analysis','research-papers':'Research Papers',
        'microeconomics':'Microeconomics','macroeconomics':'Macroeconomics','supply-and-demand':'Supply and Demand','game-theory':'Game Theory','accounting':'Accounting','finance-basics':'Finance Basics',
      };
      const topicMatch = url.pathname.slice(1).toLowerCase();
      if (topics[topicMatch]) {
        const name = topics[topicMatch];
        const desc = `Stuck on ${name.toLowerCase()}? PitStop teaches you how to solve it — not just the answer. AI asks guiding questions until you actually understand.`;
        return new Response(buildTopicPage(name, topicMatch, desc), {headers:{"Content-Type":"text/html;charset=utf-8"}});
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
  const mode = body?.mode || "default"; // default, eli5, practice
  const fullAnswer = await generateAnswer(question, env, mode);
  const preview = makePreview(fullAnswer);

  await ensureTable(env.DB);
  await env.DB.prepare(
    `INSERT INTO solves (id, question, preview, full_answer, paid, stripe_checkout_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'))`
  ).bind(solveId, question, preview, fullAnswer).run();

  // Free preview (first 3 lines), paywall for full answer
  let checkout_url = null;
  let paid = false;
  if (env.STRIPE_PRICE_ID && env.STRIPE_SECRET_KEY) {
    try {
      checkout_url = await createCheckoutSession({ env, solveId, question });
    } catch {}
  }
  if (!checkout_url) {
    // No Stripe configured — give full answer (launch mode)
    paid = true;
    await env.DB.prepare(`UPDATE solves SET paid = 1, updated_at = datetime('now') WHERE id = ?`).bind(solveId).run();
  }

  // Share URL for viral loop
  const shareUrl = `https://tutor.blackroad.io/solve/${solveId}`;
  const shareText = encodeURIComponent(`AI solved my homework in seconds! Try it: ${shareUrl}`);

  return json({
    id: solveId,
    preview,
    paid,
    full_answer: paid ? fullAnswer : undefined,
    mode,
    checkout_url,
    retrieve_url: shareUrl,
    share: {
      url: shareUrl,
      twitter: `https://twitter.com/intent/tweet?text=${shareText}`,
      copy: shareUrl,
    },
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

async function generateAnswer(question, env, mode) {
  const prompts = {
    default: "You are a precise homework tutor on BlackRoad OS. Give a correct, step-by-step answer. Show your work. Be warm and encouraging. If ambiguous, state your assumption.",
    eli5: "You are a friendly tutor explaining to a 5-year-old. Use simple words, fun analogies, and no jargon. Make it fun! Use emojis sparingly. Keep it short and clear.",
    practice: "You are a tutor. The student just solved a problem. Generate 3 similar practice problems of the same type and difficulty. Number them 1-3. Don't solve them — just give the problems.",
  };
  const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: prompts[mode] || prompts.default },
      { role: "user", content: mode === "practice" ? "Generate 3 practice problems similar to: " + question : question },
    ],
    max_tokens: 900,
    temperature: mode === "practice" ? 0.7 : 0.2,
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

async function handleSolvePage(id, env) {
  if (!id) return new Response("Not found", { status: 404 });
  await ensureTable(env.DB);
  const row = await env.DB.prepare(
    `SELECT id, question, preview, full_answer, paid, created_at FROM solves WHERE id = ? LIMIT 1`
  ).bind(id).first();
  if (!row) return new Response("Solve not found", { status: 404 });

  const answer = row.paid ? row.full_answer : row.preview;
  const q = esc(row.question);
  const a = esc(answer).replace(/\n/g, "<br>");
  const locked = !row.paid;

  const seoHtml = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${q.slice(0, 60)} — Solved | BlackRoad Tutor</title>
<meta name="description" content="${esc(row.preview).slice(0, 155)}">
<meta property="og:title" content="${q.slice(0, 60)} — Solved">
<meta property="og:description" content="${esc(row.preview).slice(0, 155)}">
<meta property="og:url" content="https://tutor.blackroad.io/solve/${row.id}">
<meta property="og:type" content="article">
<link rel="canonical" href="https://tutor.blackroad.io/solve/${row.id}">
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "QAPage",
  "mainEntity": {
    "@type": "Question",
    "name": row.question,
    "text": row.question,
    "dateCreated": row.created_at,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": row.paid ? row.full_answer : row.preview,
      "dateCreated": row.created_at
    }
  }
})}</script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--surface:#111;--border:#1a1a1a;--text:#e5e5e5;--dim:#888;--pink:#FF2255;--green:#22c55e}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{max-width:640px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:40px}
h1{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;margin-bottom:16px;line-height:1.3}
.answer{background:var(--bg);border:1px solid ${locked ? 'var(--border)' : 'var(--green)'};border-radius:8px;padding:20px;font-size:14px;line-height:1.7;white-space:pre-wrap;margin-bottom:16px}
.cta{text-align:center;margin-top:16px}
.cta a{display:inline-block;padding:12px 24px;background:var(--pink);color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-family:'Space Grotesk',sans-serif}
.back{text-align:center;margin-top:20px}
.back a{color:var(--dim);text-decoration:none;font-size:13px}
.meta{color:var(--dim);font-size:12px;margin-bottom:12px}
</style></head><body>
<div class="card">
  <p class="meta">Solved on ${row.created_at}</p>
  <h1>${q}</h1>
  <div class="answer">${a}</div>
  ${locked ? '<div class="cta"><a href="/">Unlock full answer — $1</a></div>' : '<p style="color:var(--green);font-size:13px;text-align:center">Full solution unlocked</p>'}
  <div class="back"><a href="/">Ask another question</a> | <a href="https://blackroad.io">BlackRoad OS</a></div>
</div></body></html>`;

  return new Response(seoHtml, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildTopicPage(name, slug, desc) {
  const examples = {
    'algebra': 'Solve 2x + 5 = 13', 'calculus': 'Find the derivative of x\u00b3 + 2x', 'physics': 'A ball is dropped from 20m. How long to hit the ground?',
    'chemistry': 'Balance: Fe + O\u2082 \u2192 Fe\u2082O\u2083', 'biology': 'What is the difference between mitosis and meiosis?',
    'statistics': 'Find the standard deviation of {4, 8, 6, 5, 3}', 'python': 'Write a function to check if a number is prime',
    'economics': 'Explain supply and demand with an example', 'geometry': 'Find the area of a triangle with base 10 and height 6',
    'derivatives': 'Find d/dx of sin(x\u00b2)', 'integrals': 'Evaluate \u222b x\u00b2 dx from 0 to 3', 'quadratic-equations': 'Solve x\u00b2 + 5x + 6 = 0',
    'stoichiometry': 'How many grams of O\u2082 react with 10g of H\u2082?', 'genetics': 'What are the genotype ratios of a Bb x Bb cross?',
    'recursion': 'Write a recursive function for Fibonacci in Python', 'essay-writing': 'How do I write a strong thesis statement?',
  };
  const example = examples[slug] || `Help me understand ${name.toLowerCase()}`;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} Help \u2014 AI Tutor That Teaches You | PitStop by BlackRoad</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${name} Help \u2014 PitStop AI Tutor">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="https://tutor.blackroad.io/${slug}">
<link rel="canonical" href="https://tutor.blackroad.io/${slug}">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I get help with ${name.toLowerCase()}?","acceptedAnswer":{"@type":"Answer","text":"PitStop uses the Socratic method \u2014 it asks guiding questions instead of giving you the answer. Try asking: ${example}"}}]}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#f5f5f5;font-family:'Inter',sans-serif;min-height:100vh;padding:40px 20px}
.wrap{max-width:640px;margin:0 auto}
h1{font-family:'Space Grotesk',sans-serif;font-size:32px;margin-bottom:12px;line-height:1.3}
.sub{color:#888;font-size:16px;line-height:1.6;margin-bottom:32px}
.example{background:#111;border:1px solid #222;border-radius:12px;padding:24px;margin-bottom:24px}
.example-label{color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.example-q{font-size:16px;font-style:italic;margin-bottom:12px}
.example-a{color:#888;font-size:14px;line-height:1.6}
.cta{display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#FF2255,#8844FF);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:18px;font-family:'Space Grotesk',sans-serif;margin-bottom:32px}
.how{margin-bottom:32px}
.how h2{font-family:'Space Grotesk',sans-serif;font-size:20px;margin-bottom:12px}
.how ol{padding-left:20px;line-height:2;color:#ccc;font-size:14px}
.pricing{background:#111;border:1px solid #222;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center}
.pricing .price{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700}
.pricing .detail{color:#888;font-size:13px;margin-top:8px}
.footer{color:#555;font-size:12px;margin-top:40px;text-align:center}
.footer a{color:#888;text-decoration:none}
</style></head><body>
<div class="wrap">
<h1>${name} Help</h1>
<p class="sub">${desc}</p>
<a class="cta" href="/#q=${encodeURIComponent(example)}">Try It Free</a>
<div class="example">
  <div class="example-label">Example</div>
  <div class="example-q">"${example}"</div>
  <div class="example-a">PitStop won't just give you the answer. It'll ask: "What's the first step you'd try?" Then guide you from there. You'll actually understand it when you're done.</div>
</div>
<div class="how">
  <h2>How PitStop Works</h2>
  <ol>
    <li>Type your ${name.toLowerCase()} question</li>
    <li>PitStop asks you a guiding question (not the answer)</li>
    <li>You think, respond, learn</li>
    <li>If you're stuck, it gives a hint \u2014 still not the answer</li>
    <li>When you figure it out, it celebrates and offers a harder one</li>
  </ol>
</div>
<div class="pricing">
  <div class="price">First month free</div>
  <div class="detail">No credit card. Full access. Then $10/month if you want to keep going.<br>Or $100/month for every BlackRoad product.</div>
</div>
<div class="footer">
  <a href="/">All Topics</a> &middot; <a href="https://blackroad.io">BlackRoad OS</a> &middot; <a href="https://blackroad.io/pricing">Pricing</a>
  <br><br>PitStop by BlackRoad \u2014 AI that teaches you how to think, not what to copy.
</div>
</div></body></html>`;
}

async function handleSitemap(env) {
  await ensureTable(env.DB);
  const rows = await env.DB.prepare(
    `SELECT id, updated_at FROM solves ORDER BY created_at DESC LIMIT 1000`
  ).all();

  const topicSlugs = [
    'math','algebra','calculus','precalculus','geometry','trigonometry','statistics','probability','linear-algebra','differential-equations','discrete-math','number-theory',
    'quadratic-equations','systems-of-equations','polynomials','factoring','logarithms','exponents','fractions','ratios-and-proportions','percentages','inequalities','absolute-value','complex-numbers',
    'derivatives','integrals','limits','series-and-sequences','integration-by-parts','u-substitution','chain-rule','product-rule','related-rates','optimization',
    'mean-median-mode','standard-deviation','regression','hypothesis-testing','confidence-intervals','normal-distribution','binomial-distribution','bayes-theorem',
    'matrices','vectors','eigenvalues','dot-product','cross-product',
    'physics','chemistry','biology','earth-science','environmental-science','astronomy',
    'newtons-laws','kinematics','projectile-motion','circular-motion','work-and-energy','momentum','thermodynamics','waves','optics','electricity','magnetism','quantum-mechanics',
    'stoichiometry','chemical-bonding','acids-and-bases','organic-chemistry','redox-reactions','equilibrium','gas-laws','electrochemistry','periodic-table',
    'cell-biology','genetics','evolution','ecology','photosynthesis','cellular-respiration','dna-rna','mitosis-meiosis','human-anatomy',
    'coding','python','javascript','java','c-plus-plus','html-css','sql','data-structures','algorithms','recursion','sorting-algorithms','binary-search','big-o-notation','object-oriented-programming','web-development',
    'history','english','economics','psychology','philosophy','sociology','political-science',
    'us-history','world-history','essay-writing','grammar','literary-analysis','research-papers',
    'microeconomics','macroeconomics','supply-and-demand','game-theory','accounting','finance-basics',
  ];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://tutor.blackroad.io/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`;

  for (const slug of topicSlugs) {
    xml += `\n<url><loc>https://tutor.blackroad.io/${slug}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
  }

  for (const row of (rows.results || [])) {
    xml += `\n<url><loc>https://tutor.blackroad.io/solve/${row.id}</loc><lastmod>${row.updated_at}</lastmod><priority>0.7</priority></url>`;
  }
  xml += "\n</urlset>";

  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
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
  <div style="background:var(--bg);border:1px solid var(--green);border-radius:8px;padding:16px;margin-bottom:16px;text-align:center">
    <p style="color:var(--green);font-size:18px;font-weight:700;font-family:'Space Grotesk',sans-serif">First month free. Everything unlocked.</p>
    <p style="color:var(--dim);font-size:12px;margin-top:6px;line-height:1.6">Sign up and get full access to the entire BlackRoad OS.<br>Tutor, Chat, Search, Social, Canvas, Video, Memory, RoadTrip, PitStop — all of it.</p>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px 14px;min-width:100px">
        <p style="color:var(--text);font-size:16px;font-weight:700;font-family:'Space Grotesk',sans-serif">$10<span style="color:var(--dim);font-size:11px;font-weight:400">/mo</span></p>
        <p style="color:var(--dim);font-size:10px;margin-top:2px">Per module</p>
      </div>
      <div style="background:var(--surface);border:1px solid var(--green);border-radius:6px;padding:10px 14px;min-width:100px">
        <p style="color:var(--green);font-size:16px;font-weight:700;font-family:'Space Grotesk',sans-serif">$100<span style="color:var(--dim);font-size:11px;font-weight:400">/mo</span></p>
        <p style="color:var(--dim);font-size:10px;margin-top:2px">Everything</p>
      </div>
    </div>
    <a href="https://auth.blackroad.io" style="display:inline-block;margin-top:12px;padding:10px 24px;background:var(--green);color:#000;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;font-family:'Space Grotesk',sans-serif">Start free month</a>
    <p style="color:var(--dim);font-size:10px;margin-top:8px">Cancel anytime. Export your data anytime. Your devices become your network.</p>
  </div>
  <textarea id="q" placeholder="What's your homework question?" autofocus></textarea>
  <button class="btn" id="solve" onclick="doSolve()">Solve</button>
  <div class="examples" id="examples">
    <p style="color:var(--dim);font-size:12px;margin-top:16px">Try these:</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
      <button onclick="tryQ('What is the derivative of x^3 + 2x?')" style="background:var(--bg);border:1px solid var(--border);color:var(--dim);padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">derivative of x³+2x</button>
      <button onclick="tryQ('What is the quadratic formula?')" style="background:var(--bg);border:1px solid var(--border);color:var(--dim);padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">quadratic formula</button>
      <button onclick="tryQ('What is photosynthesis?')" style="background:var(--bg);border:1px solid var(--border);color:var(--dim);padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">photosynthesis</button>
      <button onclick="tryQ('Solve 2x + 5 = 15')" style="background:var(--bg);border:1px solid var(--border);color:var(--dim);padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">solve 2x+5=15</button>
      <button onclick="tryQ('What is the Pythagorean theorem?')" style="background:var(--bg);border:1px solid var(--border);color:var(--dim);padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">Pythagorean theorem</button>
    </div>
  </div>
  <div class="result" id="result"></div>
  <div style="margin-top:20px;padding:16px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
    <p style="color:var(--text);font-size:13px;font-weight:600;margin-bottom:8px">How it works</p>
    <p style="color:var(--dim);font-size:12px;line-height:1.6">1. Sign up — first month is completely free, everything unlocked<br>2. Use any product: Tutor, Chat, Search, Social, Canvas, Video, Memory, RoadTrip<br>3. Your data migrates in. Old devices become nodes on your network via Bluetooth.<br>4. After free month: $10/module or $100/everything. Cancel anytime.<br><br>Your data is yours forever. Export as JSON. Take it anywhere. Even if you leave.</p>
  </div>
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
function tryQ(q){document.getElementById('q').value=q;document.getElementById('examples').style.display='none';doSolve();}
document.getElementById('q').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSolve();}});
</script>
<!-- Lucidia Assistant Panel -->
<style>
#lucidia-panel{position:fixed;bottom:16px;right:16px;width:300px;height:200px;z-index:9999;background:#1a1a2e;border:1px solid #CC00AA;border-radius:12px;font-family:system-ui,sans-serif;box-shadow:0 4px 24px rgba(204,0,170,0.3);display:flex;flex-direction:column;transition:all .3s ease}
#lucidia-panel.minimized{width:auto;height:auto;padding:8px 16px;cursor:pointer}
#lucidia-panel.minimized #lucidia-body,#lucidia-panel.minimized #lucidia-input-row,#lucidia-panel.minimized #lucidia-min-btn{display:none}
#lucidia-header{display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid #333;gap:8px}
#lucidia-dot{width:10px;height:10px;border-radius:50%;background:#CC00AA;flex-shrink:0;animation:lucidia-pulse 2s infinite}
@keyframes lucidia-pulse{0%,100%{box-shadow:0 0 4px #CC00AA}50%{box-shadow:0 0 12px #CC00AA}}
#lucidia-label{color:#fff;font-size:13px;font-weight:600;flex:1}
#lucidia-min-btn{background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0 4px}
#lucidia-min-btn:hover{color:#fff}
#lucidia-body{flex:1;padding:10px 12px;overflow-y:auto}
#lucidia-body p{color:#ccc;font-size:12px;margin:0 0 6px;line-height:1.4}
#lucidia-input-row{display:flex;padding:8px;border-top:1px solid #333;gap:6px}
#lucidia-input{flex:1;background:#111;border:1px solid #444;border-radius:6px;color:#fff;padding:6px 8px;font-size:12px;outline:none}
#lucidia-input:focus{border-color:#CC00AA}
#lucidia-send{background:#CC00AA;border:none;border-radius:6px;color:#fff;padding:6px 10px;cursor:pointer;font-size:12px}
</style>
<div id="lucidia-panel">
<div id="lucidia-header">
<div id="lucidia-dot"></div>
<span id="lucidia-label">Lucidia</span>
<button id="lucidia-min-btn" title="Minimize">&#x2212;</button>
</div>
<div id="lucidia-body">
<p id="lucidia-streak-msg">Keep going -- I'm tracking your progress.</p>
<p style="color:#888;font-size:11px">Every question makes you stronger.</p>
</div>
<div id="lucidia-input-row">
<input id="lucidia-input" placeholder="Ask Lucidia..." />
<button id="lucidia-send">Send</button>
</div>
</div>
<script>
(function(){
  var streak=parseInt(localStorage.getItem('tutor-streak')||'0',10);
  if(streak>0){document.getElementById('lucidia-streak-msg').textContent="You're on a "+streak+"-question streak. Keep going -- I'm tracking your progress.";}
  var panel=document.getElementById('lucidia-panel');
  var minBtn=document.getElementById('lucidia-min-btn');
  var header=document.getElementById('lucidia-header');
  var input=document.getElementById('lucidia-input');
  var sendBtn=document.getElementById('lucidia-send');
  if(localStorage.getItem('lucidia-minimized')==='true'){panel.classList.add('minimized')}
  minBtn.addEventListener('click',function(){panel.classList.add('minimized');localStorage.setItem('lucidia-minimized','true')});
  header.addEventListener('click',function(){if(panel.classList.contains('minimized')){panel.classList.remove('minimized');localStorage.setItem('lucidia-minimized','false')}});
  function sendMsg(){
    var msg=input.value.trim();if(!msg)return;
    fetch('https://roadtrip.blackroad.io/api/rooms/general/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({author:'visitor',content:msg})}).catch(function(){});
    var body=document.getElementById('lucidia-body');
    var p=document.createElement('p');p.style.color='#CC00AA';p.textContent='You: '+msg;body.appendChild(p);body.scrollTop=body.scrollHeight;
    input.value='';
  }
  sendBtn.addEventListener('click',sendMsg);
  input.addEventListener('keydown',function(e){if(e.key==='Enter')sendMsg()});
})();
</script>
</body></html>`;
