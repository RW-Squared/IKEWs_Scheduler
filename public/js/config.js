// ============================================================
// APP CONFIGURATION
// ============================================================
// Replace the firebaseConfig values with your actual Firebase
// project settings from the Firebase Console.
// ============================================================

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// ============================================================
// SCHEDULING WEEK CONFIGURATION
// ============================================================
// Set WEEK_START_DATE to the Monday of the scheduling week.
// Days 1-3: Student window (Mon/Tue/Wed)
// Days 4-6: Faculty window (Thu/Fri/Sat)
// Day 7:    Reconciliation (Sun)
// ============================================================

const SCHEDULE_CONFIG = {
  // Monday of the scheduling week (ISO 8601 date string)
  weekStartDate: "2026-03-23",

  // Time slots: 45-minute blocks from 8:00 AM to 5:00 PM each day
  dayStartHour: 8,    // 8:00 AM
  dayEndHour: 17,     // 5:00 PM (last slot starts at 4:15)
  slotDurationMinutes: 45,

  // Students must select exactly this many preferred slots
  requiredSelections: 3,

  // Each confirmed interview needs exactly this many faculty
  requiredFaculty: 2,

  // Eligible student email domain (set to null to allow any domain)
  eligibleDomain: "university.edu",

  // Admin emails (comma-separated list in environment, or hardcoded here)
  adminEmails: ["admin@university.edu"]
};

// Derive window dates from weekStartDate
function getWindowDates() {
  const start = new Date(SCHEDULE_CONFIG.weekStartDate + "T00:00:00");
  return {
    studentWindowStart: new Date(start),                              // Day 1 (Mon)
    studentWindowEnd:   new Date(start.getTime() + 3 * 86400000),    // End of Day 3 (Wed)
    facultyWindowStart: new Date(start.getTime() + 3 * 86400000),    // Day 4 (Thu)
    facultyWindowEnd:   new Date(start.getTime() + 6 * 86400000),    // End of Day 6 (Sat)
    reconciliationDay:  new Date(start.getTime() + 6 * 86400000),    // Day 7 (Sun)
  };
}

// Generate all 45-minute time slot options for Days 1–3
function generateStudentSlots() {
  const slots = [];
  const { studentWindowStart, studentWindowEnd } = getWindowDates();
  const { dayStartHour, dayEndHour, slotDurationMinutes } = SCHEDULE_CONFIG;

  let current = new Date(studentWindowStart);
  while (current < studentWindowEnd) {
    const dayOfWeek = current.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    // Only Mon (1), Tue (2), Wed (3) — Days 1–3
    if (dayOfWeek >= 1 && dayOfWeek <= 3) {
      let slotStart = new Date(current);
      slotStart.setHours(dayStartHour, 0, 0, 0);

      const dayEnd = new Date(current);
      dayEnd.setHours(dayEndHour, 0, 0, 0);

      while (slotStart < dayEnd) {
        const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60000);
        if (slotEnd <= dayEnd) {
          slots.push({
            startTime: new Date(slotStart),
            endTime: new Date(slotEnd),
            label: formatSlotLabel(slotStart, slotEnd)
          });
        }
        slotStart = slotEnd;
      }
    }
    // Advance to next day
    current.setDate(current.getDate() + 1);
  }
  return slots;
}

function formatSlotLabel(start, end) {
  const dateStr = start.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric"
  });
  const startTime = start.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true
  });
  const endTime = end.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true
  });
  return `${dateStr} | ${startTime} – ${endTime}`;
}

function getCurrentWindow() {
  const now = new Date();
  const { studentWindowStart, studentWindowEnd, facultyWindowStart, facultyWindowEnd, reconciliationDay } = getWindowDates();

  if (now >= studentWindowStart && now < studentWindowEnd) return "student";
  if (now >= facultyWindowStart && now < facultyWindowEnd) return "faculty";
  if (now >= reconciliationDay) return "reconciliation";
  return "pre";
}
