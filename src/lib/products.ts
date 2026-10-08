import type { ProductRecord } from "@/lib/types";

/** Extracts the stored file name from a product image path (Windows or POSIX). */
export function productImageFileName(imagePath: string) {
  if (!imagePath) return "";
  const segments = imagePath.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

/** Serves a product image through the contained upload endpoint, cache-busted by version. */
export function productImageUrl(imagePath: string, version?: number) {
  const fileName = productImageFileName(imagePath);
  if (!fileName) return "";
  const suffix = version ? `&v=${version}` : "";
  return `/api/products/image?file=${encodeURIComponent(fileName)}${suffix}`;
}

export function productMatchesQuery(product: ProductRecord, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return (
    product.name.toLowerCase().includes(keyword) ||
    product.brand.toLowerCase().includes(keyword) ||
    product.keywords.some((entry) => entry.toLowerCase().includes(keyword))
  );
}
