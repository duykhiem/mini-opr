# Mini OPR

Mini OPR is a demo of how one patient record travels with a Patient across several ambulance Transfer legs. Each leg is handled by a different Resource on its own Device, and every Device's Event log is gathered by one Coordinator.

It is a demo of how a One Patient Record (OPR) should behave. It is not a product. It uses no existing product code, no real data and no real integrations.

> **Status:** the online-only design is still being decided on the map [Mini OPR online: spec](https://github.com/duykhiem/mini-opr/issues/1). The glossary lives in [CONTEXT.md](CONTEXT.md); technical decisions live in [docs/adr/](docs/adr/).

## Pages

The demo is manual: open the EOC page, three Device tabs and the Coordinator page.

- **EOC page.** Creates Incidents. Each Incident has one Patient and an ordered list of Transfer legs, all created up front (leg n goes to Resource n). The EOC is not a Device and has no Event log. When it creates an Incident, it may give the Patient's name, date of birth and triage.
- **Device page.** One browser tab. It picks one of three seeded Resources, from a dropdown or the `?resource=` URL param. There is no auth. It lists the Transfer legs of its Resource.
- **Coordinator page.** Shows the merged log and each Device's offset.

A Reset exists.

## How it works

- Online only. There is no manual offline switch and no scenario button.
- Many Incidents can run at once.
- Leg n+1 becomes the Active leg when Resource n completes leg n.
- A Device first sees an Incident when its leg becomes active, then gets that Incident's new events in realtime.
- After Handover, the previous Resource can still see and edit the Patient.
- A Device saves every change on itself first, then sends it to the Coordinator in the background. It shows an online / offline indicator, with no pending count.
- The Coordinator keeps every change from every Device. The Patient is rebuilt from those changes.

## Patient fields

- **Name, date of birth, triage:** the newest edit wins, field by field. A field can be changed but not cleared.
- **Vitals, notes:** every entry is kept.

There are no conflict marks and no settle entries.

## Not yet decided

Open tickets on the map:

- [Transfer leg lifecycle and Handover rules](https://github.com/duykhiem/mini-opr/issues/5)
- [Coordinator tables and event application](https://github.com/duykhiem/mini-opr/issues/8)
- [Screen layout for EOC, Device and Coordinator pages](https://github.com/duykhiem/mini-opr/issues/9)
- [Channels for the EOC and Coordinator pages](https://github.com/duykhiem/mini-opr/issues/10)

Not yet specified:

- Testing strategy.
- Seed data, and what Reset clears.
- Running it: one command to start the frontend and the Coordinator; whether it is deployed anywhere.
- Build order.

## Out of scope

- Manual offline switch and the "Three crews offline" scenario button.
- Pending event count on the offline indicator.
- Conflict marks and settle entries.
- Auth and login.
- More than one Patient per Incident; patient links ("same patient as").
- Signatures over a person's own entries.
- Upcaster and versioned events.
- Legacy hub and Docker.
- An Event log for the EOC.

## Data

Every name, patient and value in this project is fictional.
