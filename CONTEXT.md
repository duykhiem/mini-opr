# Mini OPR

A demo of how one patient record travels with a patient across several ambulance transfers, each handled on a different device, with every device's event log gathered by one Coordinator.

## Language

### Dispatch

**EOC**:
The emergency operations centre that creates Incidents and assigns their Transfer legs. It is not a Device and has no Event log; any Patient details it gives when creating an Incident are recorded as Events by the Coordinator.
_Avoid_: Dispatcher, AMK, control room

**Incident**:
One emergency case, with exactly one Patient and an ordered list of Transfer legs.
_Avoid_: Case, mission, job

**Transfer leg**:
One segment of moving the Patient, handled by exactly one Resource on one Device.
_Avoid_: Leg (alone), trip, transport, hop

**Active leg**:
The one Transfer leg of an Incident that is currently under way; the others are planned or completed.
_Avoid_: Current leg, open leg

**Handover**:
The moment one Transfer leg ends and the next one, with a different Resource, takes over the Patient.
_Avoid_: Transfer (alone), switch

### Care

**Patient**:
The person being transported; their information is kept apart from the Incident and shared by all its Transfer legs.
_Avoid_: Casualty, victim, patient record

**Resource**:
An ambulance unit (vehicle and crew) that handles a Transfer leg.
_Avoid_: Crew, unit, ambulance, tablet

### Sync

**Device**:
The tablet a Resource works on. In the demo it is one Resource in one browser, open in one tab at a time, with its own Event log.
_Avoid_: Tablet, client, terminal, tab

**Event**:
One recorded change to a Patient, or the completion of a Transfer leg, written by a Resource on a Device or by the Coordinator on behalf of the EOC.
_Avoid_: Entry, message, change

**Event log**:
The ordered list of events written on one Device.
_Avoid_: Journal, history, outbox

**Coordinator**:
The single place where every Device's Event log is gathered.
_Avoid_: Server, hub, backend

**Coordinator epoch**:
The identity of one lifetime of the Coordinator's data, from a Reset to the next. A Device that sees a new epoch knows its local data belongs to a Coordinator that no longer exists.
_Avoid_: Generation, session, version
