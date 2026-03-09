import * as XLSX from 'xlsx';

export interface NiboLine {
  nome: string;
  valor: number;
  mappedContaId: string | null;
  mappedContaNome: string | null;
  ignored: boolean;
}

export function parseNiboXlsx(file: File): Promise<NiboLine[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

        const lines: NiboLine[] = [];

        for (let r = range.s.r; r <= range.e.r; r++) {
          const nameCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
          if (!nameCell || !nameCell.v) continue;
          const nome = String(nameCell.v).trim();
          if (!nome) continue;

          // Find first numeric value in columns B onwards
          let valor: number | null = null;
          for (let c = 1; c <= range.e.c; c++) {
            const valCell = sheet[XLSX.utils.encode_cell({ r, c })];
            if (valCell && typeof valCell.v === 'number') {
              valor = valCell.v;
              break;
            }
            if (valCell && typeof valCell.v === 'string') {
              const parsed = parseFloat(valCell.v.replace(/[^\d,.-]/g, '').replace(',', '.'));
              if (!isNaN(parsed)) {
                valor = parsed;
                break;
              }
            }
          }

          if (valor !== null) {
            lines.push({ nome, valor, mappedContaId: null, mappedContaNome: null, ignored: false });
          }
        }

        resolve(lines);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function autoMapContas(
  niboLines: NiboLine[],
  contas: { id: string; nome: string }[]
): NiboLine[] {
  return niboLines.map((line) => {
    const lineLower = line.nome.toLowerCase().trim();

    // Strategy 1: exact match
    const exact = contas.find((c) => c.nome.toLowerCase().trim() === lineLower);
    if (exact) return { ...line, mappedContaId: exact.id, mappedContaNome: exact.nome };

    // Strategy 2: partial match (min 4 chars)
    if (lineLower.length >= 4) {
      const partial = contas.find((c) => {
        const cLower = c.nome.toLowerCase().trim();
        return cLower.includes(lineLower) || lineLower.includes(cLower);
      });
      if (partial) return { ...line, mappedContaId: partial.id, mappedContaNome: partial.nome };
    }

    return line;
  });
}

export function getCompetenciaOptions(): { value: string; label: string }[] {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return months;
}
