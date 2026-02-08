Deno.serve(async () => {
  return new Response(
    JSON.stringify({
      status: 'REJECTED',
      reason: 'Deprecated. Use apply-operation edge function.'
    }),
    {
      status: 410,
      headers: { 'content-type': 'application/json' }
    }
  );
});
