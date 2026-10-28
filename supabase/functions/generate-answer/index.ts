import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

// generate-answer: the "G" in RAG.
//
// The browser has already done the "R" (retrieval): it found the talks that
// best match the question. It sends us the question plus those talks, and we
// ask GPT-4o to answer using ONLY that text and to say which talks it used.
//
//   Browser --{ question, context_talks }--> this function --> GPT-4o
//   Browser <--{ answer }-- this function <--

type Talk = { title: string; speaker: string; text: string };

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

const SYSTEM_PROMPT =
    "You are a helpful assistant that answers questions about General Conference talks " +
    "from The Church of Jesus Christ of Latter-day Saints. Use ONLY the talk excerpts " +
    "provided. If the answer isn't in them, say so. Cite the talk title and speaker " +
    "for each point you draw from a talk.\n\n" +
    // The website renders the answer as Markdown, so ask for clean Markdown.
    "Format the answer in Markdown: one short opening paragraph, then a bulleted " +
    "list of the main points with each key idea in **bold**, then a one-sentence " +
    "summary. Leave a blank line between paragraphs and before lists. Cite like " +
    "this: (*Talk Title*, Speaker). Do not use headings.";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // 1. Only signed-in users may spend our OpenAI money.
    const auth = await requireAuth(req);
    if ("error" in auth) return auth.error;

    try {
        // 2. Read and check the request.
        const { question, context_talks } = await req.json();
        if (!question || typeof question !== "string") {
            return json({ error: "Missing or invalid 'question' field" }, 400);
        }
        // The site pings us with zero talks on every page load just to see if we
        // exist. Answer right away so that ping never costs a GPT-4o call.
        if (!Array.isArray(context_talks) || context_talks.length === 0) {
            return json({ error: "No context_talks given" }, 400);
        }

        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiKey) {
            return json({ error: "OPENAI_API_KEY not configured" }, 500);
        }

        // 3. "Augment": paste the talks into the prompt, each with its title
        //    and speaker so GPT can cite them.
        const context = (context_talks as Talk[])
            .map((t) => `"${t.title}" by ${t.speaker}:\n${t.text}`)
            .join("\n\n---\n\n");
        const userPrompt = `Here are relevant talk excerpts:\n\n${context}\n\n---\n\nQuestion: ${question}`;

        // 4. "Generate": ask GPT-4o. Low temperature = stick closely to the text.
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userPrompt },
                ],
                temperature: 0.3,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return json({ error: err.error?.message || "OpenAI API error" }, response.status);
        }

        // 5. Send back just the answer text.
        const data = await response.json();
        return json({ answer: data.choices[0].message.content });
    } catch (err) {
        return json({ error: (err as Error).message }, 500);
    }
});
