import { createProduct, listProducts } from "@/db/repositories/products";
import { fail, ok, parseJson } from "@/lib/api";
import { productInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  return ok(await listProducts());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, productInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  return ok(await createProduct(parsed.data), { status: 201 });
}
