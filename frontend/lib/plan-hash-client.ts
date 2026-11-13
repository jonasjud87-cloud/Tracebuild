export async function hashFile(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export async function hashFiles(files: File[]): Promise<string[] | null> {
  const hashes: string[] = [];
  for (const file of files) {
    const hash = await hashFile(file);
    if (!hash) return null;
    hashes.push(hash);
  }
  return hashes;
}
