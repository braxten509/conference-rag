// CORS headers shared by every Edge Function.
//
// Browsers block a page on one site (braxten509.github.io) from reading
// responses from another site (*.supabase.co) unless that other site says
// "this is allowed". These headers are how the function says so.
export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};
