# The beginnings of a website to handle IKEWs scheduling.

Task: That clears up the picture significantly. Spreading this over a week reduces the pressure cooker of a single-day signup, and leveraging Google Workspace for automatic Meet links is a highly efficient way to handle the virtual logistics.

Here is how we can structure the system and workflow based on your refined rules.

1. The Week-Long Workflow
Since we have a week, we can sequence the access to ensure the system does the heavy lifting for you:

Days 1–3 (Student Window): * Students log in via Google OAuth. The system verifies their @university.edu email against the eligibility list.

They select three 45-minute blocks (e.g., 7:00–7:45, 7:45–8:30) and submit.

Days 4–6 (Faculty Window): * Faculty log in. They only see the specific blocks students have requested.

They click "Sign up" on the slots that fit their schedule.

The "Lock-In" Trigger (Real-time): * The moment a second faculty member signs up for a specific block, the system triggers the finalization protocol (detailed below).

Day 7 (Reconciliation): * The system scans for any students who did not get a 2-faculty match.

It automatically emails these students with a link to log back in and select new times based on remaining faculty availability.

2. The Finalization Protocol (The "Magic" Step)
To make this minimally labor-intensive, the system needs to handle the transition from "pending" to "scheduled" automatically. When a block hits exactly 2 faculty signups, the backend should instantly execute a single transaction:

Lock the Record: Mark that specific time block as Status: Confirmed.

Clean Up: Automatically delete or hide the student's two alternate block requests so other faculty don't waste time signing up for them.

Generate the Room: Call the Google Calendar API to create an event with conferenceData requested (this automatically generates the Google Meet link).

Notify: Add the student and the two faculty members as attendees to the Google Calendar event, which will automatically send them the invitation, the time, and the Meet link.

Note on Data Integrity: Because two faculty members might click "Sign up" on different blocks for the same student at the exact same time, your database will need to use basic transaction locking. This ensures a student doesn't accidentally get two confirmed meetings if faculty are clicking around simultaneously.

3. Tech Stack Recommendations for Google Integration
Because you want automatic Google Meets and use Google OAuth via university emails, staying within the Google ecosystem will make this much easier to build:

Database & Hosting: Firebase (Firestore). It has native, out-of-the-box Google OAuth. You can set up an "Eligible Users" collection, and if a student's OAuth email isn't in that collection, Firebase simply blocks them from accessing the scheduling dashboard.

Backend Logic: Firebase Cloud Functions (Node.js). You can write a simple function that listens to your database. Whenever a block gets its second faculty member, this function automatically runs the Google Calendar API script to create the Meet link and send the invites.

Google Cloud Console: You will need to create a project in the Google Cloud Console to enable the Google Calendar API and get the necessary API keys/Service Account credentials to generate those Meet links.

Here is a clean, simple database schema. Whether you use a relational database (like PostgreSQL) or a NoSQL database (like Firebase Firestore), this logical structure will work perfectly for your workflow.

We will break this down into four main buckets (or tables/collections) to keep the data organized and the matching logic easy to execute.

1. Students Table
This is your pre-populated list of eligible test-takers.

student_id (Primary Key)

email (String) — The bridge for Google OAuth.

name (String)

status (Enum: pending, matched, needs_new_times) — Helps the admin easily filter who needs attention on Day 7.

2. Faculty Table
This holds the pool of your 22 judges.

faculty_id (Primary Key)

email (String) — The bridge for Google OAuth.

name (String)

3. InterviewSlots Table (The Student Requests)
Instead of generating every single 45-minute block of the week in the database, we only create a record when a student requests a block. If a student picks 3 times, they generate 3 rows in this table.

slot_id (Primary Key)

student_id (Foreign Key -> Students) — Who requested this time.

start_time (DateTime)

end_time (DateTime)

status (Enum: pending, locked, discarded) — All start as 'pending'.

google_meet_link (String) — Starts blank, filled automatically when locked.

4. FacultySignups Table (The Matching Engine)
 
This is a junction table. When a faculty member clicks "Sign up" on a requested time, it simply creates a record here.

signup_id (Primary Key)

slot_id (Foreign Key -> InterviewSlots) — Which specific slot they are claiming.

faculty_id (Foreign Key -> Faculty) — Who is claiming it.

created_at (Timestamp) — Useful if two faculty click at the exact same millisecond and you need to see who was first.

How They Connect (The Magic Logic)
Visualizing the connections makes the automated "Lock-In" step very straightforward:

The Faculty View: When faculty log in, the frontend queries the InterviewSlots table for everything marked status = 'pending'.

The Signup: Professor Smith claims a slot. The database inserts a row into FacultySignups.

The Trigger: Every time a row is added to FacultySignups, the system quickly counts how many rows share that same slot_id.

The Lock: If the count hits 2:

Update that InterviewSlots record to status = 'locked'.

Generate the Google Meet link and save it to the row.

Find the other two InterviewSlots belonging to that student_id and change them to status = 'discarded' (which instantly removes them from the faculty view).

Change the student's status in the Students table to matched.

This schema minimizes empty/wasted data because you are only tracking the exact blocks students actively request and the exact actions faculty take.
