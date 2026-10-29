# Mini OPR

A demo of how one patient record travels with a patient across several ambulance transfers, each handled on a different device, with every device's event log gathered by one Coordinator.

## Language

### Dispatch

**EOC**:
The emergency operations centre that creates Incidents and assigns the first Transfer leg of each. It changes nothing after that. It is not a Device and has no Event log; any Patient details it gives when creating an Incident are recorded as Events by the Coordinator.
_Avoid_: Dispatcher, AMK, control room

**Incident**:
One emergency case, with exactly one Patient and the Transfer legs of every Resource that has worked on it. It is Closed while it has no Active leg; a Join reopens it.
_Avoid_: Case, mission, job

**Transfer leg**:
One Resource's part in an Incident, handled by exactly one Resource. It is Active from creation until a Device of that Resource completes it, then Completed for good.
_Avoid_: Leg (alone), trip, transport, hop

**Active leg**:
A Transfer leg that is not yet completed. An Incident can have several at once.
_Avoid_: Current leg, open leg

**Join**:
A Resource attaching itself to an existing Incident by pasting its Incident id, which opens a new Transfer leg for that Resource.
_Avoid_: Subscribe, claim, accept

**Handover**:
A Resource joining an Incident that another Resource has worked on. There is no accept step, and the earlier Resource can still edit the Patient.
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
The numbered list of events written on one Device, in the order they were written. Events a Device receives from the Coordinator are not part of its Event log.
_Avoid_: Journal, history, outbox

**Offset**:
How far into a Device's Event log the Coordinator has stored, without gaps.
_Avoid_: Cursor, watermark, position

**Coordinator**:
The single place where every Device's Event log is gathered.
_Avoid_: Server, hub, backend

**Coordinator epoch**:
The identity of one lifetime of the Coordinator's data, from a Reset to the next. A Device that sees a new epoch knows its local data belongs to a Coordinator that no longer exists.
_Avoid_: Generation, session, version
