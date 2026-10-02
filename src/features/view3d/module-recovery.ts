/** Only the local canvas module reported by our failed import can be retried. */
export function canvasRecoveryUrl(error: unknown, origin: string): string | null {
  if (!(error instanceof Error)) return null;
  const addresses = error.message.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  for (const address of addresses) {
    try {
      const url = new URL(address);
      if (url.origin !== origin) continue;
      const source = url.pathname.endsWith('/src/features/view3d/View3DCanvas.tsx');
      const built = /\/assets\/View3DCanvas-[\w-]+\.js$/.test(url.pathname);
      if (source || built) return url.href;
    } catch { /* Not an import URL. */ }
  }
  return null;
}
