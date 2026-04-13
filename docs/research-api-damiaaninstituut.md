# Research: Onderwijs Vlaanderen API — Damiaaninstituut Aarschot

> Onderzocht: 2026-04-13

## Instellingsnummers

| Instelling | AGODI-nummer | Opmerkingen |
|---|---|---|
| Damiaaninstituut A | **123621** | Geen SO-richtingen gevonden |
| Damiaaninstituut B en C | **147637** | Alle duale + reguliere richtingen |

**Let op:** nummer 44206 is FOUT (= Rijksmiddenschool Herk-de-Stad).

## Duale richtingen (schooljaar 2024-2025)

57 administratieve groepen, allemaal Arbeidsmarktfinaliteit (DBSO).

### 2de graad duaal
- Bandenmonteur duaal
- Keukenmedewerker duaal
- Medewerker fastfood duaal
- Medewerker hout duaal
- Medewerker ruwbouw duaal
- Winkelmedewerker duaal
- Hoeknaadlasser duaal
- Monteur sanitaire & verwarmingsinstallaties duaal
- Plaatser boven- & ondergrondse leidingen duaal

### 3de graad duaal
- Ruwbouw duaal
- Onderhoudsmechanica auto duaal
- Lassen-constructie duaal
- Sanitaire en verwarmingsinstallaties duaal
- Restaurant en keuken duaal
- Onthaal, organisatie en sales duaal
- Binnen- en buitenschrijnwerk duaal
- Binnenschrijnwerk en interieur duaal
- Elektrische installaties duaal

### 7de leerjaar duaal (specialisatie)
- Dakwerker duaal
- Interieurbouwer duaal
- Schrijnwerker houtbouw duaal
- Technicus installatietechnieken duaal

**Aanloop-klassen** bestaan naast reguliere duale klassen (voor zwakkere instroom).

## Reguliere richtingen 3de graad (schooljaar 2024-2025)

41 administratieve groepen.

**ASO (Doorstroom):** Economie-Wiskunde, Economie-Moderne talen, Wetenschappen-Wiskunde
**TSO (Dubbel):** Elektromechanische technieken, Elektrotechnieken, Houttechnieken, Autotechnieken, Biotechnologische & chemische technieken, Industriële ICT, Koel- en warmtetechnieken, Mechatronica, Podiumtechnieken
**TSO (Doorstroom):** Bouw- en houtwetenschappen, Technologische wetenschappen en engineering, Biotechnol.& chemische wet.
**BSO (Arbeidsmarkt):** Binnenschrijnwerk en interieur, Koelinstallaties, Mechanische vormgeving, Onderhoudsmechanica auto, Sanitaire en verwarmingsinstallaties

## Opleidingstrajecten — structuur

### Voorbeeld: Bandenmonteur (BK-0227-3, niveau 2)
- 6 generieke competenties (teamwerk, veiligheid, duurzaam, machines, werkplek, planning)
- 6 specifieke competenties (voertuig, banden/wielen, wielgeometrie, bandherstel, herprofileren, corrosie)
- Elk met concrete vaardigheden als sub-items

### Voorbeeld: Monteur Sanitaire & Verwarmingsinstallaties (BK-0364-2, niveau 3)
- 19 competenties
- **Twee DPK's** als referentiekader:
  - `BK-0364-2-DBK-01` — Monteur centrale verwarmingsinstallaties
  - `BK-0364-2-DBK-03` — Monteur sanitaire installaties

## Onderwijsdoelen API — beperking

De onderwijsdoelen API is **niet filterbaar op finaliteit of studierichting** via URL-parameters. De 23.961 doelen komen altijd in dezelfde volgorde terug. Ze zijn gegroepeerd in `onderwijsdoelenset`-objecten met metadata over onderwijsstructuur.

**Conclusie:** De **trajecten API** is veel bruikbaarder voor dit project dan de onderwijsdoelen API. De trajecten bevatten de exacte competentie-/vaardigheidsboom per BK, direct koppelbaar.

## Datastructuur verschil duaal vs. regulier

| Kenmerk | Duaal (DBSO) | Regulier (ASO/TSO/BSO) |
|---|---|---|
| Finaliteit | Arbeidsmarkt | Doorstroom / Dubbel / Arbeidsmarkt |
| Leerweg code | `D` (Duaal) | `V` (Voltijds) |
| BK-koppeling | Ja, via `duaal_standaardtraject` | Nee |
| Onderwijsvorm | DBSO | ASO/TSO/BSO/KSO |
| Competentiebron | Trajecten API (BK/DPK) | Leerplannen (LLinkid/LPD) |
| Aanloop-variant | Ja | Nee |
