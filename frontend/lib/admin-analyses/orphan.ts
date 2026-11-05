/** Verwaist: letztes Lebenszeichen vor dem Stichtag, ohne Lebenszeichen zählt der Start. PostgREST-Filter. */
export function orphanFilter(cutoffIso: string): string {
  return `result_json->>last_activity_at.lt."${cutoffIso}",and(result_json->>last_activity_at.is.null,created_at.lt."${cutoffIso}")`;
}
