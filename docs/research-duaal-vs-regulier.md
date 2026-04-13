# Research: Duaal vs. Regulier Secundair Onderwijs — Attestering & Leerplanstructuur

> Onderzocht: 2026-04-13

## Begrippenkader

| Term | Betekenis |
|------|-----------|
| **BK** (Beroepskwalificatie) | Officieel erkend competentieprofiel voor een beroep (VKS/AKOV) — niet schoolspecifiek |
| **DPK** (Deelberoepskwalificatie) | Afgerond deelgeheel van een BK met zelfstandige arbeidsmarktwaarde |
| **LPD** (Leerplandoelstelling) | Concrete evalueerbare doelen in een leerplan, afgeleid van BK of eindtermen |

## Duaal leren

### Leerplanstructuur
- **Beroepsgerichte vorming**: school + werkplek, gebaseerd op BK
- **Algemene vorming (AV)**: school — Nederlands, Engels, wiskunde, LO, ...
- Eén centraal beroepsgericht leerplan (in LLinkid) + afzonderlijke AV-leerplannen per vak

### Wie beoordeelt
- **School**: schoolcomponent (AV + school-gedeelte beroepsgericht)
- **Werkplekmentor**: werkplekcomponent, **heeft stemrecht in klassenraad** (wettelijk)
- **Trajectbegeleider**: coördineert tussen leerling, school en werkgever

### Studiebewijzen (4 niveaus, niet cumulatief)

| Studiebewijs | Voorwaarde |
|---|---|
| **Onderwijskwalificatie** (diploma) | Alle doelen behaald: beroepsgericht + AV |
| **Bewijs van BK** | Volledige beroepsgerichte vorming, AV onvoldoende |
| **Bewijs van DPK** | Afgerond competentiegeheel met arbeidsmarktwaarde |
| **Bewijs van Competenties** | Gedeeltelijke bereiking, geen volledige BK of DPK |

Vervroegde studiebekrachtiging mogelijk zodra alle competenties bereikt zijn.

## Regulier SO

### Leerplanstructuur
- Per vak per graad per finaliteit (niet per studierichting als geheel)
- Een leerling heeft typisch **6 tot 12 leerplannen** tegelijk
- Verplichte basisvorming + specifiek gedeelte (richtingsafhankelijk)

### Attestering
- Evaluatie per vak, per leerjaar door vakleerkracht
- Deliberatie: klassenraad (geen werkplekpartner)
- Uitkomst: **Oriënteringsattest A** (doorstromen) / **B** (met beperkingen) / **C** (zittenblijven)
- **Geen BK-attestering** in regulier SO

### Modernisering (2019 — lopend)
- 8 studiedomeinen, 3 finaliteiten (doorstroom, arbeidsmarkt, dubbele finaliteit)
- 16 Vlaamse sleutelcompetenties als basis
- Leerplannen worden herschreven per graad en finaliteit

## LLinkid structuur

- Leerplannen per vak per graad per finaliteit (niet als pakket per studierichting)
- Duaal: 1 beroepsgericht UUID + AV-leerplannen
- Regulier: meerdere UUID's per vak

## Kernverschillen

| Kenmerk | Duaal | Regulier SO |
|---------|-------|-------------|
| Leerplangrondslag | Beroepskwalificatie (BK) | Eindtermen / sleutelcompetenties |
| Aantal leerplannen/leerling | 1 beroepsgericht + AV | 6–12 vakgebonden |
| Wie beoordeelt | School + werkplekmentor (stemrecht) | Enkel leerkrachten |
| Attesteringseenheid | Competentieclusters (BK/DPK) | Vakken per leerjaar |
| Mogelijke uitkomsten | 4 types (diploma/BK/DPK/competenties) | Oriënteringsattest A/B/C |
| Werkplek in evaluatie | Ja, wettelijk | Nee |

## Implicatie voor de app

De app moet **twee fundamenteel verschillende workflows** ondersteunen:
- **Duaal**: beoordeling op competentieclusters (BK/DPK), werkplek-input, 4 studiebewijzen
- **Regulier**: beoordeling per vak/leerplan, oriënteringsattesten, meerdere leerplannen per leerling

Het huidige datamodel (1 leerplan per klas, BK-centric) werkt enkel voor het beroepsgericht deel van duaal. Voor regulier SO en AV-vakken van duaal is een fundamentele uitbreiding nodig.
