/* PDF-ul facturii (A4, în română), cu pdf-lib și fontul Noto Sans (licență OFL, în _lib/fonts/), care are ă â î ș ț.
   Se încarcă doar la emitere sau la „Refă PDF-ul” (require leneș din _lib/invoices.js), ca restul rutelor să pornească repede.
   Datele vin doar din rândul facturii (copiile clientului și ale rechizitelor), deci PDF-ul refăcut iese la fel. */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const FONTS = path.join(__dirname, 'fonts');
let fontBytes = null; // citite o singură dată pe instanță
const loadFonts = () => fontBytes || (fontBytes = {
  regular: fs.readFileSync(path.join(FONTS, 'NotoSans-Regular.ttf')),
  bold: fs.readFileSync(path.join(FONTS, 'NotoSans-Bold.ttf')),
});

const TEST_MARK = 'DATE DE TEST, FACTURĂ FĂRĂ VALOARE FISCALĂ';
const INK = rgb(0.17, 0.14, 0.12);
const MUTED = rgb(0.4, 0.36, 0.32);
const LINE = rgb(0.85, 0.82, 0.77);
const CLAY = rgb(0.6, 0.38, 0.26);
const SAND = rgb(0.96, 0.94, 0.9);
const RED = rgb(0.7, 0.15, 0.12);

// 12500.5 → „12 500,50”
const amount = v => {
  const [i, d] = Number(v).toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + d;
};
// Cantitatea fără zecimale inutile: 1 → „1”, 1.5 → „1,5”
const qtyText = v => String(Number(v)).replace('.', ',');
const day = iso => new Date(iso).toLocaleDateString('ro-RO', { timeZone: 'Europe/Chisinau', day: '2-digit', month: '2-digit', year: 'numeric' });
const dateOnly = d => String(d).slice(0, 10).split('-').reverse().join('.');

// Textul împărțit pe rânduri care încap în `width`
function wrap(text, font, size, width) {
  const out = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      // Un cuvânt mai lung decât rândul (un email, un IBAN) se taie pe litere
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let k = w.length - 1;
        while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

async function renderInvoice(inv) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = loadFonts();
  // Fonturile intră întregi (~640 KB pe PDF): subsetarea din @pdf-lib/fontkit pierde glifele Noto Sans (litere lipsă)
  const font = await doc.embedFont(bytes.regular, { subset: false });
  const bold = await doc.embedFont(bytes.bold, { subset: false });
  doc.setTitle(`Factura ${inv.number}`);
  doc.setAuthor((inv.company && inv.company.name) || 'LUXARCH');
  doc.setLanguage('ro-RO');

  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const W = width - 2 * M;
  let y = height - M;

  const text = (s, x, yy, { size = 10, f = font, color = INK } = {}) => page.drawText(String(s), { x, y: yy, size, font: f, color });
  const right = (s, xr, yy, opts = {}) => text(s, xr - (opts.f || font).widthOfTextAtSize(String(s), opts.size || 10), yy, opts);
  const hline = (yy, color = LINE, thickness = 0.8) => page.drawLine({ start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness, color });

  // Marcajul de test: în diagonală, discret, plus banda roșie de sus
  if (inv.is_test) {
    // Mărimea aleasă ca textul înclinat să încapă în pagină, centrat
    const a = Math.PI / 6;
    const size = Math.min(30, (30 * (W + 40)) / (bold.widthOfTextAtSize(TEST_MARK, 30) * Math.cos(a)));
    const tw = bold.widthOfTextAtSize(TEST_MARK, size);
    const th = size * 0.7;
    page.drawText(TEST_MARK, {
      x: width / 2 - (tw / 2) * Math.cos(a) + (th / 2) * Math.sin(a),
      y: height / 2 - (tw / 2) * Math.sin(a) - (th / 2) * Math.cos(a),
      size, font: bold, color: RED, opacity: 0.12, rotate: degrees(30),
    });
  }

  // Antetul: furnizorul (mic, sus) și titlul
  text('LUXARCH', M, y - 4, { size: 11, f: bold, color: CLAY });
  right(`Data emiterii: ${day(inv.issued_at)}`, width - M, y - 4, { size: 10, color: MUTED });
  y -= 40;
  text(`FACTURĂ nr. ${inv.number}`, M, y, { size: 22, f: bold });
  y -= 22;
  text(`Termen de plată: ${dateOnly(inv.due_date)}   ·   Moneda: ${inv.currency}`, M, y, { size: 10, color: MUTED });
  y -= 18;

  if (inv.is_test) {
    page.drawRectangle({ x: M, y: y - 26, width: W, height: 26, color: rgb(0.99, 0.92, 0.91), borderColor: RED, borderWidth: 1 });
    const tw = bold.widthOfTextAtSize(TEST_MARK, 11);
    text(TEST_MARK, M + (W - tw) / 2, y - 17, { size: 11, f: bold, color: RED });
    y -= 40;
  } else {
    y -= 8;
  }

  // Furnizorul și clientul, pe două coloane
  const colW = (W - 30) / 2;
  const c = inv.company || {};
  const k = inv.client || {};
  const supplier = [
    ['', c.name],
    ['IDNO', c.idno],
    ['Cod TVA', c.vat_code],
    ['Adresa', c.address],
    ['IBAN', c.iban],
    ['Banca', c.bank],
    ...(c.bic ? [['BIC', c.bic]] : []),
  ];
  const client = [['', k.name], ['Telefon', k.phone || '—'], ['Email', k.email || '—']];

  function block(title, rows, x) {
    let yy = y;
    text(title.toUpperCase(), x, yy, { size: 8.5, f: bold, color: CLAY });
    yy -= 16;
    rows.forEach(([lab, val], i) => {
      const first = i === 0;
      const line = lab ? `${lab}: ${val || '—'}` : String(val || '—');
      wrap(line, first ? bold : font, first ? 11.5 : 9.5, colW).forEach(l => {
        text(l, x, yy, { size: first ? 11.5 : 9.5, f: first ? bold : font, color: first ? INK : INK });
        yy -= first ? 16 : 13.5;
      });
    });
    return yy;
  }
  const yA = block('Furnizor', supplier, M);
  const yB = block('Cumpărător', client, M + colW + 30);
  y = Math.min(yA, yB) - 14;

  // Tabelul pozițiilor: nr., serviciu, cantitate, preț unitar, sumă
  const cols = { nr: M + 8, name: M + 36, qtyR: M + W - 205, priceR: M + W - 105, sumR: M + W - 8 };
  const nameW = cols.qtyR - 60 - cols.name;
  page.drawRectangle({ x: M, y: y - 22, width: W, height: 22, color: SAND });
  const hy = y - 15;
  text('Nr.', cols.nr, hy, { size: 9, f: bold, color: MUTED });
  text('Denumirea serviciului', cols.name, hy, { size: 9, f: bold, color: MUTED });
  right('Cantitate', cols.qtyR, hy, { size: 9, f: bold, color: MUTED });
  right(`Preț unitar`, cols.priceR, hy, { size: 9, f: bold, color: MUTED });
  right(`Sumă, ${inv.currency}`, cols.sumR, hy, { size: 9, f: bold, color: MUTED });
  y -= 22;

  (inv.items || []).forEach((it, i) => {
    const lines = wrap(it.name, font, 10, nameW);
    const rowH = Math.max(1, lines.length) * 14 + 12;
    const ty = y - 18;
    text(String(i + 1), cols.nr, ty);
    lines.forEach((l, j) => text(l, cols.name, ty - j * 14));
    right(qtyText(it.qty), cols.qtyR, ty);
    right(amount(it.unit_price), cols.priceR, ty);
    right(amount(it.line_total), cols.sumR, ty);
    y -= rowH;
    hline(y);
  });

  // Totalurile, aliniate la dreapta
  y -= 22;
  const labX = M + W - 230;
  const sumRow = (lab, val, strong = false) => {
    const size = strong ? 12.5 : 10;
    const f = strong ? bold : font;
    text(lab, labX, y, { size, f, color: strong ? INK : MUTED });
    right(`${amount(val)} ${inv.currency}`, cols.sumR, y, { size, f });
    y -= strong ? 22 : 18;
  };
  sumRow('Subtotal (fără TVA)', inv.subtotal);
  sumRow(`TVA ${qtyText(inv.vat_rate)}%`, inv.vat);
  page.drawLine({ start: { x: labX, y: y + 10 }, end: { x: width - M, y: y + 10 }, thickness: 1, color: INK });
  y -= 6;
  sumRow('Total de plată', inv.total, true);

  y -= 14;
  text(`Termen de plată: ${dateOnly(inv.due_date)}`, M, y, { size: 11, f: bold });
  y -= 16;
  wrap(`Plata se face prin transfer bancar în contul IBAN ${c.iban || '—'} (${c.bank || '—'}). La plată indicați numărul facturii: ${inv.number}.`, font, 9.5, W)
    .forEach(l => { text(l, M, y, { size: 9.5, color: MUTED }); y -= 13.5; });

  // Subsolul
  hline(M + 22);
  text(`${c.name || 'LUXARCH'} · Factura ${inv.number}`, M, M + 8, { size: 8, color: MUTED });
  right('Document generat electronic', width - M, M + 8, { size: 8, color: MUTED });
  if (inv.is_test) {
    const tw = bold.widthOfTextAtSize(TEST_MARK, 8);
    text(TEST_MARK, M + (W - tw) / 2, M - 6, { size: 8, f: bold, color: RED });
  }

  return Buffer.from(await doc.save());
}

module.exports = { renderInvoice, TEST_MARK };
