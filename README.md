# Karácsonyi Önkéntes Program - Helyfoglalás

Production-ready, mobile-first helyfoglaló rendszer karácsonyi önkéntes programhoz. December 24/25/26-hoz egyenként 50-50 számozott hely tartozik, a foglalás egy koncertjegy-vásárláshoz hasonló, konkrét helyszám-választós folyamat.

## 1. Architektúra

**Egyetlen monolit Next.js alkalmazás** (App Router, TypeScript) - a frontend és az API route-ok is ugyanabban a projektben, egyetlen deploy egységként futnak. Adatbázis: **PostgreSQL** (Prisma ORM-en keresztül).

Miért ez a stack:
- **Kevés mozgó alkatrész.** Nincs külön backend szolgáltatás, nincs microservice, nincs message queue - egy Node process + egy Postgres adatbázis. Ehhez a méretű alkalmazáshoz (150 hely, ~300 egyidejű felhasználó egy ünnepi csúcs alatt) ez bőven elég, és sokkal kevesebb hibalehetőséget és üzemeltetési terhet jelent, mint egy elosztott architektúra.
- **PostgreSQL** ad valódi, ACID tranzakciókat és sorszintű zárolást (`SELECT ... FOR UPDATE`) - ez a dupla foglalás elleni védelem alapja (lásd 4. pont). Ez a legfontosabb technikai döntés a projektben: a helyesség (correctness) egy relációs adatbázis tranzakciós garanciáin nyugszik, nem alkalmazás-szintű "trükkökön".
- **Next.js App Router**: egy keretrendszerben van a React frontend és a szerveroldali API, típusbiztosan meg lehet osztani kódot (validáció, konstansok) a kettő között, és egyszerűen deployolható standard Node szerverként.
- **Rövid polling a valós idejű frissítéshez** (SWR, 4 másodpercenként) WebSocket/SSE helyett: 150 helynél és néhány száz egyidejű felhasználónál ez bőven elég gyors élményt ad, és radikálisan egyszerűbb, mint kapcsolat-alapú megoldást üzemeltetni (nincs sticky session, skálázási bonyodalom, reconnect-logika).

## 2. Adatmodell (`prisma/schema.prisma`)

- **`Seat`** - egy sor **minden egyes** helyhez, előre seedelve (3 nap × 50 hely = 150 sor). Mezők: `day`, `seatNumber`, `status` (`FREE`/`LOCKED`/`BOOKED`), `lockedUntil`, `lockToken`, `bookingId`. Unique constraint: `(day, seatNumber)`.
- **`Booking`** - `publicId` (pl. `XMAS-8K4M2P`, kriptográfiailag random, unique), `idempotencyKey` (= a foglaláshoz vezető lock tokenje, unique), név/email/telefon, `emailStatus`.
- **`AdminUser`** - bcrypt jelszó-hash.
- **`RateLimit`** - egyszerű, Postgres-alapú fixed-window rate limiter (nincs külön Redis-függőség).

## 3. Dupla foglalás elleni védelem (a legkritikusabb rész)

**A frontend soha nem dönt arról, hogy egy hely szabad-e. Minden döntést az adatbázis hoz meg, tranzakción belül.**

A `Seat` tábla úgy van kialakítva, hogy **egyetlen sor tartozik minden (nap, helyszám) kombinációhoz** - ez már önmagában lehetetlenné teszi, hogy két érvényes "foglalás" létezzen ugyanarra a helyre, mert nincs hova írni a másodikat.

Két kritikus művelet van, mindkettő egy Prisma `$transaction`-ön belül fut:

1. **Zárolás létrehozása** (`createLock` a `src/lib/bookingService.ts`-ben): a kért helyek sorait `SELECT ... FOR UPDATE`-tal lekérdezzük. A Postgres ez a sorokra **zárolást tesz** - ha közben egy másik tranzakció ugyanazokat a sorokat próbálja módosítani, várakozni kényszerül, amíg az első tranzakció commitol vagy rollbackel. Csak ezután dől el, hogy a hely valóban szabad-e (`FREE`, vagy lejárt `LOCKED`) - és csak ha **minden** kért hely szabad, történik meg a zárolás (all-or-nothing). Ha bárhogy is két kérés egyszerre próbálja lefoglalni ugyanazt a helyet, a Postgres sorzárolása miatt szigorúan egymás után dolgozza fel őket, és a második már a friss (már lezárt) állapotot látja.
2. **Foglalás véglegesítése** (`finalizeBooking`): a lock tokenhez tartozó sorokat ismét `SELECT ... FOR UPDATE`-tal kérjük le, ellenőrizzük, hogy még mindig `LOCKED` és nem járt le, majd egyetlen atomi `UPDATE ... WHERE status = 'LOCKED' AND "lockToken" = $token`-nel írjuk át `BOOKED`-ra. Ha ez az UPDATE 0 sort érintene (mert közben lejárt vagy más módon megváltozott), az egész tranzakció hibával tér vissza, és a felhasználó kulturált hibaüzenetet kap.

Ezt egy **automatizált integrációs teszt** (`tests/integration/booking.test.ts`) és egy **külön load teszt** (`tests/load/concurrency-load-test.ts`, lásd 11. pont) is bizonyítja: 25-40 párhuzamos kérés ugyanarra a helyre → pontosan **egy** sikeres foglalás, a többi kulturált hibaüzenettel elutasítva.

A foglalás véglegesítése emellett **idempotens**: a lock tokent használjuk `idempotencyKey`-ként, így egy duplikált/megismételt kérés (pl. dupla kattintás, hálózati retry) ugyanazt a foglalást adja vissza, nem hoz létre másikat.

## 4. A 10 perces zárolás működése

Amikor a felhasználó rákattint a "Tovább a foglaláshoz" gombra, a szerver **egyetlen kéréssel** zárolja az összes (akár több napra eső) kiválasztott helyet 10 percre (`LOCK_DURATION_MS` a `src/lib/config.ts`-ben). A válaszban kapott `expiresAt` alapján fut a kliens oldali visszaszámláló ("...még 09:42 percig tartjuk fenn.").

A lejárat **nem kliens-oldali trükk**: minden művelet, ami a hely állapotát olvassa vagy módosítja, mindig ellenőrzi a `lockedUntil` mezőt az adatbázisban. Egy lejárt zárolású hely automatikusan szabadnak számít a következő zárolási kísérletnél (lásd fent), tehát a helyesség nem függ semmilyen ütemezett háttérfolyamattól. Van egy opcionális cron endpoint (`/api/cron/expire-locks`) is, ami rendszeresen "seper" - ez csak azért kell, hogy alacsony forgalom mellett is frissen mutassa a publikus helytérképet és az admin statisztikát, a helyességhez nem szükséges.

## 5. API-k

Publikus:
- `GET /api/seats?day=DEC_24` - csak `{ seatNumber, status }`, soha semmilyen személyes adat.
- `POST /api/locks` - zárolás létrehozása (rate limitelt, honeypot-tal).
- `DELETE /api/locks` - korai lock-felszabadítás (pl. "Vissza" gomb).
- `POST /api/bookings` - foglalás véglegesítése (rate limitelt, honeypot + időzítés-alapú bot-védelem).
- `GET /api/bookings/:publicId` - saját foglalás lekérdezése a visszaigazoló azonosítóval (rate limitelt).

Admin (JWT cookie-val védve, lásd 7. pont):
- `POST /api/admin/login`, `POST /api/admin/logout`
- `GET /api/admin/stats` - naponkénti foglalt/szabad/zárolt számok.
- `GET /api/admin/bookings` - keresés/szűrés/lapozás.
- `DELETE /api/admin/bookings/:id` - foglalás törlése, a hozzá tartozó helyek automatikusan szabaddá válnak.
- `GET /api/admin/bookings/export` - CSV export.

Karbantartás (megosztott titokkal védve, `?secret=`):
- `POST /api/cron/expire-locks`, `POST /api/cron/retry-emails`.

## 6. E-mail szolgáltatás

[Resend](https://resend.com) API-t használunk. A visszaigazoló e-mail küldése **a foglalás DB-commitja után, attól függetlenül** történik: ha az e-mail küldése hibázik, a foglalás akkor is megvan, csak a `Booking.emailStatus` lesz `FAILED`. A `/api/cron/retry-emails` endpoint (érdemes 5-10 percenként platform cronnal hívni) újrapróbálja a sikertelen e-maileket, néhány próbálkozásig backoff-fal. Így az e-mail küldés soha nem duplikálja és nem veszíti el a foglalást.

## 7. Admin authentikáció

Saját, egyszerű megoldás: `AdminUser` tábla bcrypt jelszó-hash-sel, bejelentkezéskor `jose`-val aláírt JWT egy `httpOnly`, `Secure`, `SameSite=Strict` cookie-ban (8 órás lejárat). A `src/middleware.ts` védi az `/admin/*` oldalakat és az `/api/admin/*` végpontokat. A bejelentkezés user-enumeration-timing-védelemmel és rate limittel van ellátva.

## 8. Deployment terv

1. **Adatbázis**: managed Postgres (pl. [Neon](https://neon.tech), [Railway](https://railway.app), [Supabase](https://supabase.com)) - bármelyik megfelel, csak `DATABASE_URL`-re van szükség.
2. **Alkalmazás**: egy Node.js hosztolás, ami hosszan futó szervert enged (pl. Railway, Fly.io, Render, vagy egy sima VPS Dockerrel/PM2-vel). *Nem* ajánlott tisztán serverless/edge platform (pl. Vercel Edge Functions) az API route-okhoz, mert a Prisma kliens hosszú életű DB-kapcsolatot vár; Vercel Node runtime function-jei is működnek, de a rate-limitelt/cron endpointokat érdemes a platform saját cron szolgáltatásával hívni.
3. Build: `npm run build` (lefuttatja a `prisma generate`-et is). Induláskor: `npm run prisma:deploy` (migrációk alkalmazása) majd `npm run seed` (150 hely + admin user létrehozása/frissítése), utána `npm run start`.
4. Állíts be egy platform-cron-t (vagy hasonlót), ami percenként/5 percenként meghívja: `POST /api/cron/retry-emails?secret=$CRON_SECRET` és `POST /api/cron/expire-locks?secret=$CRON_SECRET`.
5. E-mail: regisztrálj egy domaint a Resend-nél, és állítsd be a `RESEND_API_KEY` / `EMAIL_FROM` környezeti változókat.

Lásd `.env.example` a szükséges környezeti változók listájáért.

## 9. Biztonsági megoldások

- **Input validáció**: minden bemenet `zod` séma ellen validálva, kliens- és szerveroldalon is.
- **SQL injection**: kizárólag Prisma parametrizált lekérdezések (a néhány raw SQL is tagged template literal-lel, sosem string-konkatenációval).
- **XSS**: React alapból escape-eli a szöveges tartalmat; az e-mail HTML sablonban a felhasználó által megadott név explicit HTML-escape-elve van.
- **CSRF**: admin session cookie `SameSite=Strict`; minden állapot-módosító végponton (`/api/locks`, `/api/bookings`, `/api/admin/login`, `/api/admin/bookings/:id`) extra védelemként `Origin` fejléc ellenőrzés (`enforceSameOrigin`).
- **Rate limiting**: Postgres-alapú, IP-cím szerinti, minden write-jellegű publikus végponton és az admin bejelentkezésen.
- **Bot/spam védelem**: honeypot mező + minimum kitöltési idő ellenőrzés a foglalási űrlapon.
- **Admin authentikáció**: bcrypt + JWT + `httpOnly`/`Secure`/`SameSite=Strict` cookie, timing-safe bejelentkezés.
- **HTTP security headerek**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (`next.config.ts`).
- **Secret kezelés**: minden secret környezeti változóból jön, `.env` nincs verziókezelve; a szerver-only kód (Prisma, admin auth, email) sosem kerül be a kliens JS bundle-be (ellenőrizve a build kimenetén).
- **Adatvédelem**: a publikus API kizárólag hely-állapotot ad vissza (`FREE`/`LOCKED`/`BOOKED`), soha más foglaló nevét/e-mailjét/telefonszámát; a saját foglalás csak a nem kitalálható `publicId`-vel kérdezhető le.

## 10. Tesztelési stratégia

```bash
npm run test              # unit tesztek (validáció, publicId generálás, email hibakezelés) - nem igényel DB-t
npm run test:integration  # integrációs/concurrency tesztek valódi Postgres ellen
npm run test:load         # load teszt egy FUTÓ szerver ellen (lásd lentebb)
```

Az integrációs tesztek (`tests/integration/`) lefedik:
- normál foglalás (1 hely, több hely egyszerre, több nap egyszerre),
- lock létrehozása és lejárata (mesterségesen a múltba állított `lockedUntil`-lal),
- dupla foglalási kísérlet (már foglalt/zárolt hely),
- **sok párhuzamos kérés ugyanarra a helyre** (`Promise.allSettled` 25-40 egyidejű hívással) - bizonyítva, hogy pontosan egy sikerül,
- **egyidejű, ugyanazon lock tokennel érkező véglegesítési kérések** - bizonyítva, hogy idempotensek (mindegyik ugyanazt a foglalást adja vissza, nem jön létre duplikátum),
- sikertelen e-mail küldés esetén a foglalás nem vész el és nem duplikálódik,
- admin törlés (a helyek visszaválnak szabaddá),
- érvénytelen bemenetek elutasítása.

A **load teszt** (`tests/load/concurrency-load-test.ts`) egy ténylegesen futó szerver (`npm run build && npm run start`) ellen szimulál:
1. 300 egyidejű, egymást átfedő helyválasztással próbálkozó klienst (mindegyik saját, szimulált IP-vel, hogy a rate limit ne torzítsa az eredményt),
2. egy második hullámban 150 klienst, akik mind ugyanazt az 5 megmaradt helyet próbálják megszerezni,
majd az adatbázisban ellenőrzi, hogy **egyetlen (nap, helyszám) kombináció sem lett kétszer lefoglalva**, és a `Seat`/`Booking` táblák konzisztensek egymással. A teszt hibával (nem-nulla exit code-dal) áll le, ha bármilyen inkonzisztenciát talál.

## Helyi fejlesztés

```bash
cp .env.example .env        # töltsd ki DATABASE_URL-t és a többi változót
docker compose up -d        # helyi Postgres (vagy használj saját telepítést)
npm install
npm run prisma:migrate      # séma létrehozása
npm run seed                # 150 hely + admin user
npm run dev
```

Admin felület: `/admin/login`, a `.env`-ben megadott `ADMIN_EMAIL`/`ADMIN_PASSWORD`-del (ez hozza létre a seed script az `AdminUser` sort).
