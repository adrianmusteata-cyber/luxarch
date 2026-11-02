/* Valorile fixe din formular, etapele pâlniei de vânzări și sursele, cu textul românesc */

const TYPES = {
  casa: 'Casă unifamilială',
  ansamblu: 'Ansamblu rezidențial',
  birouri: 'Clădire de birouri / comercială',
  hala: 'Hală / industrial',
  expertiza: 'Expertiză / consolidare',
  altceva: 'Altceva',
};
const SERVICES = {
  arh_rez: 'Arhitectură + Rezistență',
  arh: 'Doar arhitectură',
  rez: 'Doar rezistență',
  design: 'Design interior',
  management: 'Management de proiect',
  nu_stiu: 'Nu știu încă',
};
const STATUSES = {
  noua: 'Nouă',
  contactata: 'Contactată',
  in_lucru: 'În lucru',
  procesat: 'Procesat',
  avans: 'Avans',
  platit: 'Plătit',
  incheiat: 'Încheiat',
  respins: 'Respins',
  inchisa: 'Închisă',
};

const SOURCES = {
  site: 'Site web',
  manual: 'Manual',
  carte_vizita: 'Carte de vizită',
  chestionar: 'Chestionar',
  document: 'Document',
  telegram: 'Telegram', // cu canal: client adăugat de echipă din Mini App; fără canal: cerere trimisă de client din botul lui
  vizualizare: 'Site, vizualizare', // cererea lăsată din formularul „Vedeți-vă viitoarea casă” (schiță cu Gemini)
};

// Tipurile de documente recunoscute de Claude; `ready` = secțiunea de destinație există deja
const DOC_TYPES = {
  carte_vizita: { label: 'Carte de vizită', ready: true },
  chestionar: { label: 'Chestionar', ready: true },
  aviz: { label: 'Aviz de expediere', ready: true },
  chitanta: { label: 'Chitanță / factură achitată', ready: true },
  de_platit: { label: 'Factură / contract de plătit', ready: true },
  de_incasat: { label: 'Factură / contract de încasat', ready: true },
  lista_preturi: { label: 'Listă de prețuri', ready: true },
};

// Canalul clientului adăugat manual
const CHANNELS = {
  apel: 'Apel',
  intalnire: 'Întâlnire',
};

// Categoriile de cheltuieli (lista fixă; Claude propune una)
const EXPENSE_CATEGORIES = {
  materiale: 'Materiale',
  echipamente: 'Echipamente și IT',
  software: 'Software și abonamente',
  transport: 'Transport și combustibil',
  chirie: 'Chirie și utilități',
  subcontractori: 'Subcontractori și servicii',
  birou: 'Birou și consumabile',
  taxe: 'Taxe și impozite',
  altele: 'Altele',
};

module.exports = { TYPES, SERVICES, STATUSES, SOURCES, CHANNELS, DOC_TYPES, EXPENSE_CATEGORIES };
