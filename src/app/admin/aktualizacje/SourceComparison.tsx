import { compareCandidate, sourceFieldValue, type WritableSourceField } from "@/lib/admin/comparison";
import type { Candidate, ReportObject } from "@/lib/admin/types";

const states = { same: { icon: "✓", label: "Zgodne" }, different: { icon: "≠", label: "Różnica" }, missing: { icon: "—", label: "Brak danych do porównania" } };

type Props = { row: ReportObject; candidate: Candidate; busy?: boolean; savingField?: WritableSourceField | null; fieldMessages?: Partial<Record<WritableSourceField, string>>; onUseField?: (field: WritableSourceField) => void };
export default function SourceComparison({ row, candidate, busy = false, savingField, fieldMessages, onUseField }: Props) {
  const fields = compareCandidate(row, candidate);
  return <section className="source-comparison" aria-label={`Porównanie: ${candidate.name || candidate.number}`}>
    <a className="source-object-name" href={candidate.url} target="_blank" rel="noreferrer">{candidate.name || candidate.number || "Obiekt w źródle"} ↗</a>
    <small>Dopasowanie: {candidate.reason || "sprawdź dane obiektu"}</small>
    <div className="field-comparison" role="table" aria-label="Dane bazy i strony źródłowej">
      <div className="comparison-heading" role="row"><span role="columnheader">Pole</span><span role="columnheader">Baza</span><span role="columnheader">Strona źródłowa</span></div>
      {fields.map(field => {
        const writable = field.key !== "kind" ? field.key : null;
        const canCopy = writable !== null && field.state !== "same" && sourceFieldValue(writable, candidate) !== undefined;
        return <div className={`comparison-row ${field.state}`} role="row" key={field.key}>
        <span role="rowheader">{field.label}</span>
        <span role="cell" className="comparison-value">{field.database}</span>
        <span role="cell" className={`comparison-value comparison-source ${field.state}`} title={states[field.state].label}>
          <span><span className="comparison-symbol" aria-label={states[field.state].label}>{states[field.state].icon}</span> {field.source}</span>
          {canCopy && onUseField && <button type="button" className="copy-source-field" disabled={busy} onClick={() => { if (writable) onUseField(writable); }} aria-label={`Zapisz w bazie pole ${field.label}: ${field.source}`} title={`Zastąp w bazie „${field.database}” wartością „${field.source}”`}>{savingField === writable ? "Zapisuję…" : "← Do bazy"}</button>}
          {writable && fieldMessages?.[writable] && <small role="status" className="field-save-message">{fieldMessages[writable]}</small>}
        </span>
      </div>;
      })}
    </div>
    <small className="comparison-raw">Status zapisany w źródle: {String(candidate.raw_status ?? "brak danych")}</small>
    <small>Data źródła: {candidate.source_updated_at || "brak daty"}{candidate.freshness ? ` · ${candidate.freshness}` : ""}</small>
    <small>Pobrano: {candidate.fetched_at ? new Date(candidate.fetched_at).toLocaleString("pl-PL") : "brak daty"}</small>
    {candidate.warnings?.map(warning => <p className="source-warning" key={warning}>{warning}</p>)}
  </section>;
}
