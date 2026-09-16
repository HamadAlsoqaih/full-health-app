/**
 * Runtime entrypoint. Kept separate from app.ts so integration tests can build an app
 * with fake dependencies without binding a port.
 */
const port = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  console.warn(`[startup] listening on :${port}`);
}

await main();
