const { createClient } = require("@libsql/client");

const client = createClient({ url: "file:web-data/social-auto-post.db" });

function mask(row) {
  const clean = {};
  for (const [key, value] of Object.entries(row)) {
    if (/key|secret|token|cookie/i.test(key)) {
      clean[key] = typeof value === "string" && value ? `[len ${value.length}]` : value;
    } else {
      clean[key] = typeof value === "string" && value.length > 160 ? `${value.slice(0, 160)}...` : value;
    }
  }
  return clean;
}

async function show(label, sql) {
  console.log(`\n== ${label} ==`);
  const result = await client.execute(sql);
  for (const row of result.rows) console.log(JSON.stringify(mask(row)));
}

async function main() {
  await show(
    "image models",
    "select id, provider_id, model_id, model_type, enabled, source from ai_models where model_type = 'image'",
  );
  await show(
    "enabled models",
    "select provider_id, model_id, model_type, enabled from ai_models where enabled = 1",
  );
  await show("ai_model_capabilities", "select * from ai_model_capabilities limit 40");
  await show("ai_credential_keys", "select * from ai_credential_keys limit 10");
  await show("ai_model_preferences", "select * from ai_model_preferences limit 10");
  await show("ai_model_endpoints", "select * from ai_model_endpoints limit 10");
}

main().catch((error) => {
  console.error("ERR", error);
  process.exitCode = 1;
});


main().catch((error) => {
  console.error("ERR", error);
  process.exitCode = 1;
});
