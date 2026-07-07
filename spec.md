Lead Tracker — One-Page Spec
For: O-Studio Remuera
Prepared by: Avinaash
Status: Proposal / MVP scope

The problem
Leads come in across a few different avenues and currently get tracked across several Google Sheets. There's no single place to see who's come in, who still needs a follow-up text, and who's been contacted. It works, but it's scattered and easy to lose track of people.
The idea
A single, simple web tool for the front desk to replace the scattered sheets. One place to add every lead, and a clear daily view of who needs texting and who's already been contacted. Built for desktop, designed to be as fast to enter data into as possible.

Who uses it

Front-desk staff, on a desktop, throughout the day.
Add new leads as they come in; each morning, work through who needs a follow-up text.

Lead sources tracked
SourceGoalInfo capturedNew clientStandard bookingName, email, phone, service used7-day trialConvert to membershipName, phone, service used, experience notes, trial day/stageQuiz leadCall & book in with an offerName, phone, email, notes
The core feature: a simple follow-up pipeline
Instead of a "did they convert? yes/no" box that's easy to forget, every lead moves through a clear status:
New → Texted → Responded → Converted / Lost

The morning view shows yesterday's leads still waiting to be texted — a clean to-do queue.
Leads that haven't responded yet stay visible for several days instead of slipping through the cracks (since replies often take a few days).
Staff mark a lead as texted once they've sent the message, so the team always knows what's been done.


In scope (MVP)

One central lead list, filterable by source and status.
Fast manual entry forms — one tool, not a pile of separate sheets.
The New → Texted → Responded → Converted/Lost pipeline.
A daily "to text" queue for morning staff.
Who entered the lead / who texted it, with timestamps.

Out of scope (for now) — roadmap

Auto-importing leads from Mindbody (new clients & trials) and ScoreApp (quiz) via their APIs — removes manual copying entirely. Phase 2.
Sending the follow-up text from the tool itself (currently sent from the work phone). Phase 2/3.
Conversion reporting / dashboards once the data's reliably flowing.


Build notes (internal — not for the client deck)

Stack: Angular + Firebase (Firestore), in line with existing workflow.
Data model: single leads collection. Shared fields (name, phone, email, source, serviceUsed, createdAt, enteredBy) + conditional fields per source (trialStage, experienceNotes / quiz notes) + follow-up block (status, textedAt, textedBy, lastContactAt).
Multi-tenancy from day one: every lead carries a locationId, even though Remuera is the only live studio. Hidden from the UI — invisible to Daniel — but means this can become a multi-studio product across the franchise later with no painful retrofit.
Phase 2 ingestion: ScoreApp likely offers a webhook/Zapier path (verify directly). Mindbody API requires approval and may be gated/paid — confirm access is possible before committing to auto-ingest.