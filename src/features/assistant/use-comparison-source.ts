import { useCallback, useEffect, useRef, useState } from 'react';
import { buildPlanComparison } from '../../domain/plan-comparison';
import { readPlanFile, type OpenedPlan } from '../../persistence/format';

export type ComparisonSource = OpenedPlan & { fileName: string };
type SourceFile = Pick<File, 'name' | 'text'>;

/**
 * A rejected file never touches `source`: the base picked earlier (if any)
 * is still there. Said explicitly, so the person does not have to guess
 * whether the panel below still shows a real comparison or nothing.
 */
function withPreservedBaseNote(message: string, kept: ComparisonSource | null): string {
  return kept === null ? message : `${message} Предыдущая база сравнения («${kept.fileName}») сохранена.`;
}

/** Separate from editor state: loading never replaces a document or save baseline. */
export function useComparisonSource() {
  const [source, setSource] = useState<ComparisonSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => () => { request.current += 1; }, []);

  // The caller must also clear synchronously when replacing the current document.
  const clear = useCallback((): void => {
    request.current += 1;
    setSource(null);
    setLoading(false);
    setError(null);
  }, []);

  const load = useCallback(async (file: SourceFile): Promise<void> => {
    const ticket = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const text = await file.text();
      if (ticket !== request.current) return;
      const decoded = readPlanFile(text);
      if (!decoded.ok) {
        setError(withPreservedBaseNote(decoded.issues.map((issue) => issue.message).join(' '), source));
        return;
      }
      // A structurally valid file may still contain uncomputable geometry.
      const report = buildPlanComparison(decoded.value.plan, decoded.value.plan);
      if (!report.ok) {
        setError(withPreservedBaseNote(report.issues.map((issue) => issue.message).join(' '), source));
        return;
      }
      setSource({ ...decoded.value, fileName: file.name });
    } catch {
      if (ticket === request.current) {
        setError(withPreservedBaseNote('Не удалось прочитать исходный файл.', source));
      }
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [source]);

  return { source, loading, error, load, clear };
}
