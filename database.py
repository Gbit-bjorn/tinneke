"""
Database layer voor de BK/DPK/LPD Flask web app.

Port van datamodel.py zonder tkinter-dependencies.
Gebruikt alleen Python stdlib: sqlite3, csv, datetime.

Schema:
  - klassen: id, naam, richting, schooljaar
  - leerlingen: id, naam, voornaam, klas_id (FK)
  - lpd_resultaten: id, leerling_id (FK), lpd_uuid, behaald (0/1), datum_gewijzigd
  - klas_leerplan_mapping: klas_id, leerplan_uuid
"""

import csv
import io
import sqlite3
from datetime import datetime


_SQL_CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS klassen (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    naam        TEXT    NOT NULL,
    richting    TEXT    NOT NULL DEFAULT '',
    schooljaar  TEXT    NOT NULL,
    UNIQUE(naam, schooljaar)
);

CREATE TABLE IF NOT EXISTS leerlingen (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    naam        TEXT    NOT NULL,
    voornaam    TEXT    NOT NULL,
    klas_id     INTEGER NOT NULL,
    FOREIGN KEY (klas_id) REFERENCES klassen(id)
);

CREATE TABLE IF NOT EXISTS lpd_resultaten (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    leerling_id     INTEGER NOT NULL,
    lpd_uuid        TEXT    NOT NULL,
    behaald         INTEGER NOT NULL DEFAULT 0,
    datum_gewijzigd TEXT    NOT NULL,
    FOREIGN KEY (leerling_id) REFERENCES leerlingen(id),
    UNIQUE(leerling_id, lpd_uuid)
);

CREATE TABLE IF NOT EXISTS klas_leerplan_mapping (
    klas_id         INTEGER NOT NULL,
    leerplan_uuid   TEXT    NOT NULL,
    PRIMARY KEY (klas_id),
    FOREIGN KEY (klas_id) REFERENCES klassen(id)
);
"""

_SQL_CREATE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_leerlingen_klas
    ON leerlingen(klas_id);
CREATE INDEX IF NOT EXISTS idx_resultaten_leerling
    ON lpd_resultaten(leerling_id);
CREATE INDEX IF NOT EXISTS idx_resultaten_uuid
    ON lpd_resultaten(lpd_uuid);
"""


class Database:
    """
    Beheert alle database-operaties voor de BK/DPK/LPD web app.

    Gebruik:
        db = Database("pad/naar/database.db")
        klassen = db.get_klassen()
        db.close()

    Of als context manager:
        with Database("pad/naar/database.db") as db:
            klassen = db.get_klassen()
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self._init_tables()

    def _init_tables(self):
        """Maakt alle tabellen en indexen aan als ze nog niet bestaan."""
        self.conn.executescript(_SQL_CREATE_TABLES)
        self.conn.executescript(_SQL_CREATE_INDEXES)
        self.conn.commit()

    def close(self):
        """Sluit de databaseverbinding."""
        if self.conn:
            self.conn.close()
            self.conn = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    # ── Klassen ───────────────────────────────────────────────────────────────

    def get_klassen(self) -> list[dict]:
        """Geeft alle klassen gesorteerd op naam, met aantal leerlingen."""
        rijen = self.conn.execute(
            """
            SELECT k.id, k.naam, k.richting, k.schooljaar,
                   COUNT(l.id) AS aantal_leerlingen
            FROM klassen k
            LEFT JOIN leerlingen l ON l.klas_id = k.id
            GROUP BY k.id
            ORDER BY k.naam
            """
        ).fetchall()
        return [dict(r) for r in rijen]

    def get_all_klassen(self) -> list[dict]:
        """Alias voor get_klassen() — compatibiliteit."""
        return self.get_klassen()

    def get_klas(self, klas_id: int) -> dict | None:
        """Geeft één klas op basis van ID, of None als niet gevonden."""
        rij = self.conn.execute(
            "SELECT id, naam, richting, schooljaar FROM klassen WHERE id = ?",
            (klas_id,),
        ).fetchone()
        return dict(rij) if rij else None

    def create_klas(self, naam: str, richting: str, schooljaar: str) -> int:
        """
        Maakt een nieuwe klas aan.

        Returns:
            ID van de nieuwe klas.

        Raises:
            sqlite3.IntegrityError: als naam + schooljaar al bestaat.
        """
        cursor = self.conn.execute(
            "INSERT INTO klassen (naam, richting, schooljaar) VALUES (?, ?, ?)",
            (naam, richting, schooljaar),
        )
        self.conn.commit()
        return cursor.lastrowid

    def set_klas_leerplan(self, klas_id: int, leerplan_uuid: str):
        """
        Koppelt een LLinkid-leerplan aan een klas.
        Overschrijft een bestaande koppeling.
        """
        self.conn.execute(
            """
            INSERT INTO klas_leerplan_mapping (klas_id, leerplan_uuid)
            VALUES (?, ?)
            ON CONFLICT(klas_id) DO UPDATE SET leerplan_uuid = excluded.leerplan_uuid
            """,
            (klas_id, leerplan_uuid),
        )
        self.conn.commit()

    def get_klas_leerplan(self, klas_id: int) -> str | None:
        """
        Geeft de leerplan_uuid die gekoppeld is aan een klas.

        Returns:
            leerplan_uuid als string, of None als er geen koppeling is.
        """
        rij = self.conn.execute(
            "SELECT leerplan_uuid FROM klas_leerplan_mapping WHERE klas_id = ?",
            (klas_id,),
        ).fetchone()
        return rij["leerplan_uuid"] if rij else None

    # ── Leerlingen ────────────────────────────────────────────────────────────

    def get_leerlingen(self, klas_id: int) -> list[dict]:
        """Geeft alle leerlingen van een klas, gesorteerd op naam en voornaam."""
        rijen = self.conn.execute(
            "SELECT id, naam, voornaam, klas_id "
            "FROM leerlingen WHERE klas_id = ? ORDER BY naam, voornaam",
            (klas_id,),
        ).fetchall()
        return [dict(r) for r in rijen]

    def get_leerling(self, leerling_id: int) -> dict | None:
        """Geeft één leerling op basis van ID, of None als niet gevonden."""
        rij = self.conn.execute(
            "SELECT id, naam, voornaam, klas_id FROM leerlingen WHERE id = ?",
            (leerling_id,),
        ).fetchone()
        return dict(rij) if rij else None

    def create_leerling(self, naam: str, voornaam: str, klas_id: int) -> int:
        """
        Voegt een nieuwe leerling toe aan een klas.

        Returns:
            ID van de nieuwe leerling.
        """
        cursor = self.conn.execute(
            "INSERT INTO leerlingen (naam, voornaam, klas_id) VALUES (?, ?, ?)",
            (naam, voornaam, klas_id),
        )
        self.conn.commit()
        return cursor.lastrowid

    def delete_leerlingen(self, klas_id: int):
        """Verwijdert alle leerlingen van een klas (en hun LPD-resultaten)."""
        leerling_ids = [
            r["id"] for r in self.conn.execute(
                "SELECT id FROM leerlingen WHERE klas_id = ?", (klas_id,)
            ).fetchall()
        ]
        if leerling_ids:
            placeholders = ",".join("?" * len(leerling_ids))
            self.conn.execute(
                f"DELETE FROM lpd_resultaten WHERE leerling_id IN ({placeholders})",
                leerling_ids,
            )
        self.conn.execute("DELETE FROM leerlingen WHERE klas_id = ?", (klas_id,))
        self.conn.commit()

    def bulk_insert_leerlingen(self, klas_id: int, leerlingen: list[dict]):
        """
        Voegt meerdere leerlingen tegelijk in.

        Args:
            klas_id: ID van de klas
            leerlingen: lijst van dicts met 'naam' en 'voornaam'
        """
        rijen = [(l["naam"], l["voornaam"], klas_id) for l in leerlingen]
        self.conn.executemany(
            "INSERT INTO leerlingen (naam, voornaam, klas_id) VALUES (?, ?, ?)",
            rijen,
        )
        self.conn.commit()

    def import_leerlingen_csv(self, csv_content: str, klas_id: int) -> int:
        """
        Importeert leerlingen uit een WISA CSV-export.

        CSV-formaat: puntkomma als separator, kolommen: naam;voornaam
        De eerste rij wordt overgeslagen als het een header is
        (d.w.z. als de eerste kolom 'naam' of 'Naam' bevat).

        Returns:
            Aantal succesvol geïmporteerde leerlingen.
        """
        reader = csv.reader(io.StringIO(csv_content), delimiter=";")
        rijen = list(reader)

        if not rijen:
            return 0

        # Sla header over als die aanwezig is
        start = 0
        if rijen[0] and rijen[0][0].strip().lower() == "naam":
            start = 1

        ingevoegd = 0
        for rij in rijen[start:]:
            # Filter lege rijen
            if not rij or not any(cel.strip() for cel in rij):
                continue
            if len(rij) < 2:
                continue

            naam = rij[0].strip()
            voornaam = rij[1].strip()

            if not naam or not voornaam:
                continue

            self.conn.execute(
                "INSERT INTO leerlingen (naam, voornaam, klas_id) VALUES (?, ?, ?)",
                (naam, voornaam, klas_id),
            )
            ingevoegd += 1

        self.conn.commit()
        return ingevoegd

    # ── LPD resultaten ────────────────────────────────────────────────────────

    def get_lpd_resultaten(self, leerling_id: int) -> dict[str, bool]:
        """
        Geeft alle LPD-resultaten voor een leerling.

        Returns:
            Dict van {lpd_uuid: behaald (bool)}
        """
        rijen = self.conn.execute(
            "SELECT lpd_uuid, behaald FROM lpd_resultaten WHERE leerling_id = ?",
            (leerling_id,),
        ).fetchall()
        return {r["lpd_uuid"]: bool(r["behaald"]) for r in rijen}

    def toggle_lpd(self, leerling_id: int, lpd_uuid: str, behaald: bool):
        """
        Zet of wist een LPD-resultaat voor een leerling.

        Maakt een nieuw record aan als het nog niet bestaat,
        anders wordt het bestaande record bijgewerkt.
        """
        nu = datetime.now().isoformat(timespec="seconds")
        self.conn.execute(
            """
            INSERT INTO lpd_resultaten (leerling_id, lpd_uuid, behaald, datum_gewijzigd)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(leerling_id, lpd_uuid) DO UPDATE SET
                behaald = excluded.behaald,
                datum_gewijzigd = excluded.datum_gewijzigd
            """,
            (leerling_id, lpd_uuid, int(behaald), nu),
        )
        self.conn.commit()

    def bulk_save_lpd(self, leerling_id: int, resultaten: dict[str, bool]):
        """
        Slaat meerdere LPD-resultaten tegelijk op voor één leerling.

        Args:
            leerling_id: ID van de leerling
            resultaten: dict van {lpd_uuid: behaald (bool)}
        """
        nu = datetime.now().isoformat(timespec="seconds")
        rijen = [
            (leerling_id, lpd_uuid, int(behaald), nu)
            for lpd_uuid, behaald in resultaten.items()
        ]
        self.conn.executemany(
            """
            INSERT INTO lpd_resultaten (leerling_id, lpd_uuid, behaald, datum_gewijzigd)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(leerling_id, lpd_uuid) DO UPDATE SET
                behaald = excluded.behaald,
                datum_gewijzigd = excluded.datum_gewijzigd
            """,
            rijen,
        )
        self.conn.commit()

    # ── Statistieken ──────────────────────────────────────────────────────────

    def bereken_lpd_stats(self, leerling_id: int, lpd_uuids: list[str]) -> dict:
        """
        Berekent hoeveel LPDs van een gegeven lijst de leerling behaald heeft.

        Gebruikt dezelfde logica als datamodel.py: een LPD telt als behaald
        als behaald = 1 staat in lpd_resultaten.

        Args:
            leerling_id: ID van de leerling
            lpd_uuids: lijst van LPD-UUIDs die tot een BK/DPK horen

        Returns:
            {"totaal": int, "behaald": int, "percentage": float}
        """
        if not lpd_uuids:
            return {"totaal": 0, "behaald": 0, "percentage": 0.0}

        # Gebruik een tijdelijke inline tabel via placeholders
        placeholders = ",".join("?" * len(lpd_uuids))
        rij = self.conn.execute(
            f"""
            SELECT
                COUNT(*)                                        AS totaal,
                SUM(CASE WHEN behaald = 1 THEN 1 ELSE 0 END)  AS behaald
            FROM lpd_resultaten
            WHERE leerling_id = ?
              AND lpd_uuid IN ({placeholders})
            """,
            [leerling_id, *lpd_uuids],
        ).fetchone()

        # Alle UUIDs uit de lijst tellen als totaal, ook zonder record
        totaal = len(lpd_uuids)
        behaald = int(rij["behaald"] or 0)
        percentage = round(behaald / totaal * 100, 1) if totaal > 0 else 0.0

        return {
            "totaal": totaal,
            "behaald": behaald,
            "percentage": percentage,
        }
