import { CONTRACT_ISSUE_CODES, LIMITS, type Issue } from '../../contracts/model';

/**
 * Names the exceeded plan limit for the refusal banner, or null when the
 * issues are not about a limit. The object count comes from the raw JSON.
 */
export function limitRefusal(text: string, issues: Issue[]): string | null {
  const vertices = issues.find((item) => item.code === CONTRACT_ISSUE_CODES.LIMIT_EXCEEDED);
  const total = /вершин (\d+)/.exec(vertices?.message ?? '')?.[1];
  if (total !== undefined) {
    return `План не открыт: в плане ${total} вершин, предел — ${LIMITS.maxTotalVertices}.`;
  }
  try {
    const objects = (JSON.parse(text) as { objects?: unknown }).objects;
    if (Array.isArray(objects) && objects.length > LIMITS.maxObjects) {
      return `План не открыт: в плане ${objects.length} объектов, предел — ${LIMITS.maxObjects}.`;
    }
  } catch {
    return null;
  }
  return null;
}
