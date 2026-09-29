import { useEffect, useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_BYTES = 20 * 1024 * 1024;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityCount: number;
  onConfirm: (file: File) => Promise<void>;
};

export function SubmitJustificatifDialog({
  open,
  onOpenChange,
  opportunityCount,
  onConfirm,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setError(null);
      setSubmitting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [open]);

  const pickFile = (f: File | null) => {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("Le fichier dépasse 20 Mo.");
      setFile(null);
      return;
    }
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".pdf")) {
      setError("Seuls les fichiers PDF sont acceptés.");
      setFile(null);
      return;
    }
    const mime = f.type.toLowerCase();
    const mimeOk =
      !mime ||
      mime === "application/pdf" ||
      mime === "application/octet-stream" ||
      mime === "binary/octet-stream";
    if (!mimeOk) {
      setError("Seuls les fichiers PDF sont acceptés.");
      setFile(null);
      return;
    }
    setFile(f);
  };

  const handleConfirm = async () => {
    if (!file) {
      setError("Veuillez choisir un fichier PDF.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(file);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const countLabel =
    opportunityCount <= 1
      ? "cette opportunité"
      : `ces ${opportunityCount} opportunités`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pièce justificative</DialogTitle>
          <DialogDescription>
            Ajoutez un PDF justificatif avant d&apos;envoyer {countLabel} au suivi des soumissions.
            {opportunityCount > 1 ? " Le même fichier sera associé à chaque opportunité sélectionnée." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => inputRef.current?.click()}
              disabled={submitting}
            >
              <FileUp className="mr-2 h-4 w-4" />
              Choisir un PDF
            </Button>
            <span className="text-xs text-muted-foreground truncate">
              {file ? file.name : "Aucun fichier"}
            </span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button type="button" onClick={() => void handleConfirm()} disabled={submitting || !file}>
            {submitting ? "Envoi…" : "Confirmer la soumission"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
