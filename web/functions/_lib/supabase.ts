export interface RpcEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

/** Real RPC over PostgREST. Throws on any failure; callers never show the error text. */
export function makeRpc(env: RpcEnv, fetchImpl: typeof fetch = fetch) {
  return async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`rpc ${name} failed: ${res.status}`);
    return await res.json();
  };
}
