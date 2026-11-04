# LUXARCH (fost Atelier Temelia)

Site static (index.html, styles.css, script.js, i18n.js; animații GSAP din CDN), fără build. Limbi: RO (în HTML), RU și EN (în i18n.js). Publicat pe Vercel la https://luxarch.vercel.app,
legat de GitHub: https://github.com/adrianmusteata-cyber/luxarch (branch `main`).

## Sincronizare local ↔ GitHub ↔ Vercel
Folderul local, GitHub și site-ul live trebuie să fie mereu la fel.
- Înainte de orice modificare: `git pull` (Git e în `C:\Program Files\Git\cmd\git.exe`).
- După orice modificare: `git add -A`, `git commit -m "<descriere în română>"`, `git push`.
  Vercel publică automat fiecare push pe `main` în ~1 minut.
- Verifică pe telefon (lățime 375px) că nu apare scroll orizontal.

## Serverul local
Pornirea, repornirea și oprirea serverului local (`vercel dev`, portul 3000) se fac prin subagentul `dev-server`.
După ce ai terminat de executat un plan, rulează automat subagentul `dev-server` cu cererea „repornește”, fără să întrebi.

Utilizatorul vorbește română; răspunde în română.
