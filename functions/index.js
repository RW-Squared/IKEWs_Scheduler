/**
 * IKEWs Interview Scheduler — Firebase Cloud Functions
 *
 * Functions:
 *   1. onFacultySignup      — Firestore trigger: runs when a faculty signup is created.
 *                             If a slot now has 2 faculty signups, runs the finalization
 *                             protocol (lock slot, discard alternates, create Google Meet,
 *                             send calendar invites).
 *
 *   2. runReconciliation    — HTTPS Callable: admin-triggered. Scans for students who
 *                             have no locked slot and marks them "needs_new_times", then
 *                             emails them a link to re-select times.
 *
 * Environment / Secret configuration (set via Firebase CLI):
 *   firebase functions:secrets:set GOOGLE_SERVICE_ACCOUNT_JSON
 *   firebase functions:config:set scheduler.app_url="https://YOUR_PROJECT_ID.web.app"
 *   firebase functions:config:set scheduler.email_from="noreply@university.edu"
 *   firebase functions:config:set scheduler.calendar_id="primary"
 */

"use strict";

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();
const db = admin.firestore();

// ---- Config ----
const REQUIRED_FACULTY  = 2;   // Faculty needed to confirm a slot
const APP_URL = process.env.APP_URL || "https://YOUR_PROJECT_ID.web.app";
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@university.edu";
const CALENDAR_ID = process.env.CALENDAR_ID || "primary";

// Service account JSON for Google Calendar API (stored as a Firebase Secret)
const serviceAccountSecret = defineSecret("GOOGLE_SERVICE_ACCOUNT_JSON");

// ================================================================
//  FUNCTION 1: onFacultySignup
//  Triggered whenever a new document is created in /facultySignups
// ================================================================
exports.onFacultySignup = onDocumentCreated(
  { document: "facultySignups/{signupId}", secrets: [serviceAccountSecret] },
  async (event) => {
    const signup = event.data.data();
    const { slotId, facultyEmail } = signup;

    if (!slotId) {
      console.error("onFacultySignup: missing slotId");
      return;
    }

    // --- Use a Firestore transaction to count signups atomically ---
    await db.runTransaction(async (tx) => {
      const slotRef  = db.collection("interviewSlots").doc(slotId);
      const slotSnap = await tx.get(slotRef);

      if (!slotSnap.exists) {
        console.error(`Slot ${slotId} not found`);
        return;
      }

      const slot = slotSnap.data();

      // Already locked or discarded — do nothing
      if (slot.status !== "pending") {
        console.log(`Slot ${slotId} is already ${slot.status}. Skipping.`);
        return;
      }

      // Count existing signups for this slot
      const signupsSnap = await db.collection("facultySignups")
        .where("slotId", "==", slotId)
        .get();

      const signupCount = signupsSnap.size;
      console.log(`Slot ${slotId} now has ${signupCount} signup(s).`);

      if (signupCount < REQUIRED_FACULTY) {
        // Not enough faculty yet — nothing to do
        return;
      }

      // ===== FINALIZATION PROTOCOL =====
      console.log(`Slot ${slotId} has ${REQUIRED_FACULTY} faculty. Starting finalization.`);

      const facultyEmails = signupsSnap.docs.map(d => d.data().facultyEmail);

      // 1. Lock this slot
      tx.update(slotRef, { status: "locked" });

      // 2. Discard the student's other pending slots
      const otherSlotsSnap = await db.collection("interviewSlots")
        .where("studentEmail", "==", slot.studentEmail)
        .where("status", "==", "pending")
        .get();

      otherSlotsSnap.docs.forEach(otherDoc => {
        if (otherDoc.id !== slotId) {
          tx.update(otherDoc.ref, { status: "discarded" });
        }
      });

      // 3. Mark student as matched
      const studentRef = db.collection("students").doc(slot.studentEmail);
      tx.update(studentRef, { status: "matched" });

      // Store faculty emails on the slot for later reference
      tx.update(slotRef, { confirmedFacultyEmails: facultyEmails });
    });

    // --- Outside transaction: create Google Meet & send invites ---
    // Re-fetch the slot to confirm it's now locked
    const slotSnap = await db.collection("interviewSlots").doc(slotId).get();
    const slot = slotSnap.data();

    if (slot.status !== "locked" || slot.googleMeetLink) {
      // Either not locked (transaction decided to skip) or Meet already created
      return;
    }

    try {
      const meetLink = await createGoogleMeetEvent(
        slot,
        slot.confirmedFacultyEmails,
        serviceAccountSecret.value()
      );

      // Save Meet link
      await db.collection("interviewSlots").doc(slotId).update({ googleMeetLink: meetLink });
      console.log(`Google Meet created: ${meetLink}`);
    } catch (err) {
      console.error("Failed to create Google Meet event:", err);
      // Non-fatal: the slot is still locked, admin can manually add the link
    }
  }
);

// ================================================================
//  FUNCTION 2: runReconciliation  (Admin-callable, Day 7)
//  Marks unmatched students as "needs_new_times" and emails them.
// ================================================================
exports.runReconciliation = onCall({ secrets: [serviceAccountSecret] }, async (request) => {
  // Verify caller is an admin
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const callerEmail = request.auth.token.email;
  const adminSnap = await db.collection("admins").doc(callerEmail).get();
  if (!adminSnap.exists) throw new HttpsError("permission-denied", "Admin access required.");

  // Find students who are still 'pending' (no matched slot)
  const studentsSnap = await db.collection("students")
    .where("status", "==", "pending")
    .get();

  if (studentsSnap.empty) {
    return { message: "All students are already matched. No action needed." };
  }

  const batch = db.batch();
  const emailQueue = [];

  for (const studentDoc of studentsSnap.docs) {
    const student = studentDoc.data();
    batch.update(studentDoc.ref, { status: "needs_new_times" });
    emailQueue.push(student);
  }

  await batch.commit();

  // Send notification emails
  let emailsSent = 0;
  for (const student of emailQueue) {
    try {
      await sendReconciliationEmail(student);
      emailsSent++;
    } catch (err) {
      console.error(`Failed to email ${student.email}:`, err);
    }
  }

  return {
    message: `Reconciliation complete. ${emailQueue.length} students marked "needs_new_times". ${emailsSent} notification emails sent.`
  };
});

// ================================================================
//  HELPER: Create Google Calendar event with Meet link
// ================================================================
async function createGoogleMeetEvent(slot, facultyEmails, serviceAccountJson) {
  const serviceAccount = JSON.parse(serviceAccountJson);

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/calendar"]
  });

  const calendar = google.calendar({ version: "v3", auth });

  const startTime = slot.startTime.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
  const endTime   = slot.endTime.toDate   ? slot.endTime.toDate()   : new Date(slot.endTime);

  // Fetch student info for the attendee list
  const studentSnap = await db.collection("students").doc(slot.studentEmail).get();
  const studentName = studentSnap.exists ? studentSnap.data().name : slot.studentEmail;

  // Build attendee list
  const attendees = [
    { email: slot.studentEmail, displayName: studentName },
    ...facultyEmails.map(email => ({ email }))
  ];

  const event = {
    summary: `IKEW Interview — ${studentName}`,
    description: `IKEWs Interview scheduled via the IKEWs Scheduler.\n\nStudent: ${studentName} (${slot.studentEmail})\nFaculty: ${facultyEmails.join(", ")}`,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: "America/New_York"  // Adjust as needed
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: "America/New_York"
    },
    attendees,
    conferenceData: {
      createRequest: {
        requestId: `ikews-${slot.studentEmail}-${startTime.getTime()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" }
      }
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 },  // 1 day before
        { method: "popup", minutes: 30 }
      ]
    }
  };

  const response = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: event,
    conferenceDataVersion: 1,
    sendUpdates: "all"   // Sends email invites to all attendees
  });

  const meetLink = response.data.conferenceData?.entryPoints?.find(
    ep => ep.entryPointType === "video"
  )?.uri || response.data.hangoutLink || "";

  return meetLink;
}

// ================================================================
//  HELPER: Send reconciliation notification email
// ================================================================
async function sendReconciliationEmail(student) {
  // Using nodemailer with a Gmail/SMTP transport.
  // Configure SMTP credentials via environment variables:
  //   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
  const nodemailer = require("nodemailer");

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || EMAIL_FROM,
      pass: process.env.SMTP_PASS || ""
    }
  });

  const schedulerUrl = `${APP_URL}/student/`;

  await transporter.sendMail({
    from: `"IKEWs Scheduler" <${EMAIL_FROM}>`,
    to: student.email,
    subject: "Action Required: Please Select New Interview Times",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#1a73e8">IKEWs Interview Scheduler</h2>
        <p>Dear ${student.name},</p>
        <p>
          Unfortunately, we were unable to find two faculty members available for any of your
          previously selected interview time slots.
        </p>
        <p>
          Please log back in to the scheduler and select <strong>3 new preferred time slots</strong>
          based on the updated faculty availability.
        </p>
        <p style="margin:24px 0">
          <a href="${schedulerUrl}"
             style="background:#1a73e8;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:600">
            Select New Times
          </a>
        </p>
        <p style="color:#80868b;font-size:13px">
          If you have any questions, please contact your program administrator.
        </p>
      </div>
    `
  });
}
