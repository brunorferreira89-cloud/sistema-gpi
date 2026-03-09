import * as XLSX from 'xlsx';
import { classifyTipo, isTotalLine, type ImportedConta } from '@/lib/plano-contas-utils';

export function parseXlsx(file: File): Promise<ImportedConta[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellStyles: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        const rows: { nome: string; nivel: number; indent: number; cellRef: string }[] = [];

        for (let r = range.s.r; r <= range.e.r; r++) {
          const cellRef = XLSX.utils.encode_cell({ r, c: 0 });
          const cell = sheet[cellRef];
          if (!cell || !cell.v) continue;
          const text = String(cell.v).trim();
          if (!text) continue;

          const indent = cell.s?.alignment?.indent || 0;
          rows.push({ nome: text, nivel: 1, indent, cellRef });
        }

        if (rows.length === 0) {
          resolve([]);
          return;
        }

        // Strategy 1: Numeric codes (1, 1.1, 1.1.1)
        const codePattern = /^(\d+(\.\d+)*)[\s\.\-]/;
        let codeMatches = 0;
        const strategy1: { nome: string; nivel: number }[] = [];

        for (const row of rows) {
          const match = row.nome.match(codePattern);
          if (match) {
            codeMatches++;
            const code = match[1];
            const nivel = code.split('.').length;
            const cleanName = row.nome.replace(codePattern, '').trim();
            strategy1.push({ nome: cleanName || row.nome, nivel });
          } else {
            strategy1.push({ nome: row.nome, nivel: 1 });
          }
        }

        const useStrategy1 = codeMatches / rows.length >= 0.7;

        // Strategy 2: SheetJS indent
        let hasIndent = false;
        const strategy2: { nome: string; nivel: number }[] = [];
        for (const row of rows) {
          if (row.indent > 0) hasIndent = true;
          strategy2.push({ nome: row.nome, nivel: row.indent + 1 });
        }

        let finalRows: { nome: string; nivel: number }[];
        if (useStrategy1) {
          finalRows = strategy1;
        } else if (hasIndent) {
          finalRows = strategy2;
        } else {
          finalRows = rows.map((r) => ({ nome: r.nome, nivel: 1 }));
        }

        // Strategy 3: Keyword detection for is_total (always runs)
        const contas: ImportedConta[] = finalRows.map((row) => ({
          nome: row.nome,
          nivel: row.nivel,
          tipo: classifyTipo(row.nome),
          is_total: isTotalLine(row.nome),
          selected: true,
        }));

        resolve(contas);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
