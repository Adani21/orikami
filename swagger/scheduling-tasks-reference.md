# KRANE™ scheduling/tasks — API-referentie

Bron: `https://krane-gateway-beta.orikami.tech/api-docs/` (spec-titel `krane-gateway 1.117.4`).
Volledige OpenAPI-spec staat lokaal in `openapi.json` (uitgepakt uit `swagger-ui-init.js`).

Auth: bearer JWT (`Authorization: Bearer <token>`) op de meeste routes; machine-to-machine routes
gebruiken `token` query-param (`m2mScheduler`) of `x-api-key` header (`kraneAdminApiKey`). Token voor
organisatie-routes komt via `/organization/token`.

## Datamodel: een schedule = één "workflow"

Een schedule (`ScheduleEntityDTO` / `SchedulePayload`) is de planningsregel achter een taak/experiment.
Zowel een patiënt (`UserModel.schedules`) als een study (`StudyEntity.schedules`) heeft een **array** van
schedules → dit is de basis voor KRN-1190 (meerdere workflows per experiment): gewoon meerdere entries
in die array met verschillende `action.configuration.featureId`/`experimentType`.

Velden op `ScheduleEntityDTO` (relevant per ticket):

| Veld | Type | Relevant voor |
|---|---|---|
| `seriesStartDatetime` / `seriesEndDatetime` | date-time | **KRN-1183** — einddatum van de planning |
| `repeat` | `CalendarRepeat` (week/maand + occurrences) of `RelativeRepeat` (`numberOfRepeats`, `repeatDuration`, `durationUnit`) | **KRN-124** — herhaalfrequentie |
| `reminders[]` (`Reminder`: `channels[push\|email]`, `title`, `message`, `priority`, `timeOffset`) | array | **KRN-1187** — melding instellen (herinnering vóór een taak) |
| `notification` (`Notification`: `channels`, `title`, `message`, `priority`) | object | **KRN-1187** — melding bij de taak zelf |
| `startOn.event` (`StartEvent`: `FirstLogin`, `ExperimentCompleted`, `StartDate`) | enum | **KRN-1227** — trigger bij experiment-afronding (`ExperimentCompleted`) |
| `startOn.configuration.delay` (`Delay`: `durationUnit`, `delayDuration`, `hour`, `minute`) | object | **KRN-1271** — vertraging op de trigger |
| `startOn.configuration.conditionScript` | string | **KRN-1538** — planning die meebeweegt met gedrag (conditie-script bepaalt of/wanneer de volgende occurrence komt) |
| `action.scheduleAction` / `expireAction` / `remindAction` | enums (`CreateExperimentTask`, `ExpireExperimentTask`, `CheckIfExperimentTaskIsToBeReminded`, ...) | onderliggend mechanisme achter alle bovenstaande |

`PatientExperimentSchedule` is een lichtere variant (interval, `availableFrom`, `activeFrom`, `expireAt`,
`notificationTime`, gekoppeld aan `studyId`/`experimentId`/`type: FeatureType`) — waarschijnlijk het
resultaat-object zoals de patiënt-app het opvraagt, niet de create/update-payload.

## Endpoints — schedules aanmaken/wijzigen

Schedules zitten **genest** in de patiënt- of study-body; er is geen los `/schedule` CRUD-endpoint.

| Method | Path | Body/params | Opmerking |
|---|---|---|---|
| `POST` | `/user/patient` | `AddPatientModel` (incl. `schedules: SchedulePayload[]`) | nieuwe patiënt + schedules aanmaken |
| `PATCH` | `/user` | `UpdateUserModel` (incl. `schedules: SchedulePayload[]`) | eigen schedules bijwerken |
| `PATCH` | `/user/{userId}` | path `userId` + `UpdateUserModel` | schedules van specifieke patiënt bijwerken |
| `GET` | `/patient/{patientId}` | path `patientId` | patiënt incl. schedules ophalen |
| `POST` | `/study` | `InsertStudyBody` (incl. `schedules: InsertStudySchedule[]`) | study-niveau default schedules |
| `PATCH` / `PUT` | `/study/{studyId}` | `UpdateStudy` / `ReplaceStudy` | study-schedules wijzigen/vervangen |

**Bevestigd (2026-08-26, getest tegen staging):** `PATCH /user/{userId}` met `schedules` **vervangt** de
hele array (replace, geen merge). Getest met een wegwerp-testpatiënt: 1e PATCH met een schedule
(`eventDuration: 15`) → 2e PATCH met een andere schedule (`eventDuration: 45`) → na afloop stond er nog
maar 1 schedule (`45`), de eerste was weg. Test staat in `tests/schedules-merge-or-replace.spec.ts`.
**Consequentie voor alle tests die schedules wijzigen:** altijd de vólledige gewenste lijst meesturen,
anders verdwijnen bestaande schedules stilletjes.

**Bevestigd door Andres (2026-08-27):** dit is bewust gedrag, geen bug. `PATCH /user/{userId}` doet een
**shallow merge** op het user-object: top-level velden die je niet meestuurt blijven ongemoeid, maar een
veld dat je wél meestuurt — zoals `schedules` — wordt in zijn geheel vervangen, omdat een shallow merge
een array-veld niet element-voor-element samenvoegt. Dus consistent met hoe shallow merge werkt; geen
losstaand `schedules`-specifiek gedrag.

## Endpoints — taken (de concrete occurrences van een schedule)

| Method | Path | Params/body | Response states |
|---|---|---|---|
| `GET` | `/tasks` | query: `userId` (required), `state?` | `state` enum: `open, skipped, future, inProgress, completed, expired` |
| `POST` | `/tasks/skip` | `SkipTaskPayload` = `{ scheduleId, occurrenceAt, reason }` (alle 3 required) | 200/403/404 |
| `POST` | `/tasks/reopen` | `ReopenTaskPayload` = `{ scheduleId, occurrenceAt }` | 200/403/404 |
| `POST` | `/tasks/start` | `StartTaskPayload` = `{ scheduleId, occurrenceAt, startedAt, finishAt }` | 200/403/404 |
| `POST` | `/user/recreate-tasks` | — | (nog niet uitgezocht — body/params checken in Swagger UI) |

`occurrenceAt` is een string (geen `date-time` format in de spec) — waarschijnlijk een ISO-datum die de
specifieke herhaling van een schedule identificeert. Testen tegen een niet-bestaande `occurrenceAt` moet
404 geven — goede negative-test-kandidaat.

## Koppeling naar de Fase 1-tickets

- **KRN-1183** (einddatum planning) → `seriesEndDatetime` zetten via `PATCH /user/{userId}`, dan
  verifiëren dat er na die datum geen nieuwe taken meer verschijnen via `GET /tasks`.
- **KRN-1187** (melding instellen) → `reminders[]`/`notification` op de schedule zetten; verificatie van
  het daadwerkelijk versturen kan buiten deze API vallen (Novu — zie `NovuPatientSubscribe`/`NovuPatientStatus`
  endpoints, apart onderzoeken bij Andres).
- **KRN-1190** (meerdere workflows per experiment) → meerdere entries in `schedules[]` met verschillende
  `action.configuration`, en checken dat ze onafhankelijk taken genereren.
- **KRN-1227** (trigger bij experiment-afronding) → `startOn.event = "ExperimentCompleted"` +
  `startOn.configuration.experimentType`/`featureId`.
- **KRN-1271** (vertraging op trigger) → `startOn.configuration.delay` (`Delay`-object) naast bovenstaande.
- **KRN-1538** (planning meebeweegt met gedrag) → `startOn.configuration.conditionScript` — dit is het
  minst voor-de-hand-liggende veld, expliciet navragen bij Andres wat dit precies doet.
- **KRN-124** (herhaalfrequentie) → `repeat` (`CalendarRepeat` of `RelativeRepeat`).

## Nog open

- Geen `summary`/`description` in de spec op de meeste routes — betekenissen hierboven zijn afgeleid uit
  schema-namen en veldnamen, niet uit documentatie-tekst. Bevestig aannames met Andres voordat je er
  testcases op baseert.
- `conditionScript` (KRN-1538): bevestigd door Andres (2026-09-14) dat dit conditionele logica toevoegt
  voor wanneer een workflow triggert, bv. op basis van het antwoord op een vraag — maar het exacte
  script-format/contract (taal, beschikbare variabelen, return-waarde) is nog niet bevestigd.
- `POST /user/recreate-tasks` nog niet gedetailleerd uitgezocht.
- Novu-notificatie-endpoints (`NovuPatientStatus`, `NovuPatientSubscribe`) apart bekijken voor KRN-1187 als
  de test verder gaat dan "staat het goed in de schedule".

## FirstLogin-trigger (KRN-1538)

Bevestigd door Andres (2026-09-14): `startOn.event = "FirstLogin"` wordt getriggerd door
`PUT /user/activate` (body `ActivateUserModel`: `{ email, tenantName }`, tag `LEGACY`, `jwt`-secured, geen
specifieke rol vereist). Response is het bijgewerkte `UserModel` — vermoedelijk zet dit `UserModel.active`
op `true`. Geen `userId`-path-param; identificatie gaat via `email` in de body.
