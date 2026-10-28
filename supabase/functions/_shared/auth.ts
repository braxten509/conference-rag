import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

/**
 * Make sure the caller is a signed-in user before we spend OpenAI money.
 *
 * When you sign in with the magic link, the browser gets a sign-in pass
 * (a JWT). supabase-js sends it with every request in the header
 * "Authorization: Bearer <pass>". Here we ask Supabase Auth whether that
 * pass is real and still valid.
 *
 * Why do it here instead of letting Supabase check it automatically?
 * Supabase's automatic check can't yet read the newer kind of pass it
 * hands out, so real users get rejected. We deploy with --no-verify-jwt
 * (automatic check off) and check by hand instead.
 *
 * Returns the user if the pass is good, or a ready-made 401 response if not.
 */
export async function requireAuth(req: Request): Promise<
    { user: { id: string; email?: string } } | { error: Response }
> {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        return { error: unauthorized("Missing Authorization header") };
    }

    // SUPABASE_URL and SUPABASE_ANON_KEY are filled in by Supabase
    // automatically for every Edge Function.
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        return { error: unauthorized("Invalid or expired token") };
    }
    return { user };
}

function unauthorized(message: string): Response {
    return new Response(JSON.stringify({ error: message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
