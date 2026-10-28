import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

// embed-question: turns a question into its 1,536 numbers.
//
//   Browser --{ question }--> this function --> OpenAI
//   Browser <--{ embedding }-- this function <--
//
// The OpenAI key lives only here on the server, never in the browser.

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

Deno.serve(async (req) => {
    // Before the real request, browsers send a quick "OPTIONS" request to
    // ask if cross-site calls are allowed. Just say yes.
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // 1. Only signed-in users may use our OpenAI key.
    const auth = await requireAuth(req);
    if ("error" in auth) return auth.error;

    try {
        // 2. Read the question from the request body.
        const { question } = await req.json();
        if (!question || typeof question !== "string") {
            return json({ error: "Missing or invalid 'question' field" }, 400);
        }

        // 3. Get the secret key (set with `supabase secrets set`).
        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiKey) {
            return json({ error: "OPENAI_API_KEY not configured" }, 500);
        }

        // 4. Ask OpenAI for the numbers. Must be the SAME model used for the
        //    26,256 sentences, or the numbers can't be compared.
        const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "text-embedding-3-small",
                input: question,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return json({ error: err.error?.message || "OpenAI API error" }, response.status);
        }

        // 5. Send just the list of numbers back to the browser.
        const data = await response.json();
        return json({ embedding: data.data[0].embedding });
    } catch (err) {
        return json({ error: (err as Error).message }, 500);
    }
});
