import { listPublishRecords } from "@/db/repository";
import { interactionCount } from "@/lib/metrics";

export const runtime = "nodejs";

const HEADERS = [
  "id",
  "platform",
  "account",
  "title",
  "type",
  "status",
  "views",
  "likes",
  "comments",
  "shares",
  "favorites",
  "interactions",
  "followsDelta",
  "completionRate",
  "metricStatus",
  "publishedAt",
  "url",
];

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Local data portability: export the collected metrics as CSV or JSON so the user
 * owns their data. Never sends anything off-device.
 */
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const records = await listPublishRecords(1000);

  if (format === "json") {
    return Response.json({ records }, {
      headers: { "Content-Disposition": `attachment; filename="coolpilot-metrics.json"` },
    });
  }

  const rows = records.map((record) =>
    [
      record.id,
      record.platform,
      record.accountName,
      record.title,
      record.contentType,
      record.status,
      record.views,
      record.likes,
      record.comments,
      record.shares,
      record.favorites,
      interactionCount(record),
      record.followsDelta,
      record.completionRate ?? "",
      record.metricStatus,
      record.publishedAt ? new Date(record.publishedAt).toISOString() : "",
      record.url,
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = [HEADERS.join(","), ...rows].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="coolpilot-metrics.csv"`,
    },
  });
}
