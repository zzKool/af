// A real one-page PDF (F106): the review journeys upload "%PDF-1.4 <name>" — a few bytes pdf.js rejects, so the
// preview could never be asserted to *load*. This one has a page, a font, a text run and a correct xref, so
// pdf.js renders a canvas for it. `label` makes the bytes unique per journey (the duplicate check, D32).
export function minimalPdf(label: string): Buffer {
  const text = label.replace(/[()\\]/g, "");
  return pdfOf(300, 200, `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`);
}

/**
 * A Letter page (8.5 × 11 in) with the mock invoice's text printed where the mock reading's boxes are (F141) —
 * vendor, VAT number, invoice number, date, subtotal, VAT, total — so the preview's boxes land on the words.
 * Invented values (D51); `label` keeps the bytes unique.
 */
export function mockInvoicePdf(label: string): Buffer {
  const text = label.replace(/[()\\]/g, "");
  // [x in, y in from the top (the box's top), size pt, text] — the boxes of `__fixtures__/mock-responses.ts`
  const runs: [number, number, number, string][] = [
    [0.85, 0.7, 18, "Test Vendor AB"],
    [0.85, 1.15, 10, "VAT SE556677889901"],
    [5.45, 1.4, 11, "INV-2026-001"],
    [5.45, 1.75, 11, "14 March 2026"],
    [0.85, 3.0, 11, "Consulting   10 x 100,00"],
    [6.05, 7.6, 11, "1 000,00"],
    [6.05, 7.95, 11, "250,00"],
    [5.65, 8.4, 15, "1 250,00 SEK"],
    [0.85, 10.3, 8, text],
  ];
  const stream = runs
    .map(
      ([x, y, size, t]) =>
        `BT /F1 ${size} Tf ${(x * 72).toFixed(1)} ${(792 - y * 72 - size).toFixed(1)} Td (${t}) Tj ET`,
    )
    .join("\n");
  return pdfOf(612, 792, stream);
}

function pdfOf(width: number, height: number, stream: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
