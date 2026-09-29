import type { OpportunityExtractedDetails } from "@/lib/extracted-details";
import { Badge } from "@/components/ui/badge";

type Props = { details: OpportunityExtractedDetails };

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted-foreground shrink-0 w-32">{label}</span>
      <span className="font-medium break-words">{value}</span>
    </div>
  );
}

export function OpportunityExtractedDetailsPanel({ details }: Props) {
  const adm = details.administrative;
  const fin = details.financial;
  const tech = details.technical;

  const remiseDate =
    adm.dates?.remiseOffresIso?.[0] ?? adm.dates?.remiseOffres ?? null;
  const ouvertureDate =
    adm.dates?.ouverturePlisIso?.[0] ?? adm.dates?.ouverturePlis ?? null;
  const email = adm.contacts?.emails?.[0] ?? null;
  const phone = adm.contacts?.phones?.[0] ?? null;

  return (
    <div className="space-y-4 text-sm">

      {/* Méta extraction */}
      <div className="flex items-center gap-2 flex-wrap">
        {details.extractedAt && (
          <span className="text-[10px] text-muted-foreground">
            Extrait le {new Date(details.extractedAt).toLocaleString("fr-FR")}
          </span>
        )}
        {details.meta?.pages != null && (
          <Badge variant="outline" className="text-[10px] h-5">{details.meta.pages} pages</Badge>
        )}
        {details.meta?.ocrUsed && (
          <Badge variant="outline" className="text-[10px] h-5">OCR</Badge>
        )}
      </div>

      {/* Administratif */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Administratif</p>
        <Row label="Type de procédure" value={adm.procedureType} />
        <Row label="Maître d'ouvrage" value={adm.authority} />
        <Row label="Financement" value={adm.financing} />
        <Row label="Objet" value={adm.subject} />
        <Row label="Remise des offres" value={remiseDate} />
        <Row label="Ouverture des plis" value={ouvertureDate} />
        {email && <Row label="Contact e-mail" value={email} />}
        {phone && <Row label="Contact tél." value={phone} />}
      </div>

      {/* Financier */}
      {(fin.budgetGlobal || fin.cautionGlobal || fin.delaiGlobal) && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Financier</p>
          <Row label="Budget" value={fin.budgetGlobal} />
          <Row label="Caution" value={fin.cautionGlobal} />
          <Row label="Délai d'exécution" value={fin.delaiGlobal} />
          {fin.lotsDetected != null && (
            <Row label="Lots" value={String(fin.lotsDetected)} />
          )}
        </div>
      )}

      {/* Technique */}
      {tech.keywords.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Mots-clés techniques</p>
          <div className="flex flex-wrap gap-1.5">
            {tech.keywords.map((kw) => (
              <Badge key={kw} variant="secondary" className="text-[10px]">{kw}</Badge>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Extrait automatiquement — à vérifier sur le DAO officiel.
      </p>
    </div>
  );
}
