# IKEWs Scheduler — Setup Guide

## Prerequisites

- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- A Google Cloud project with **Google Calendar API** enabled
- A Firebase project linked to that Google Cloud project

---

## 1. Firebase Project Setup

```bash
# Login
firebase login

# Set your project ID in .firebaserc
# Replace YOUR_FIREBASE_PROJECT_ID with your actual project ID

firebase use YOUR_FIREBASE_PROJECT_ID
```

---

## 2. Configure the App

Edit **`public/js/config.js`**:

```js
const firebaseConfig = {
  apiKey: "...",           // From Firebase Console → Project Settings → Web App
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};

const SCHEDULE_CONFIG = {
  weekStartDate: "2026-03-23",   // Monday of your scheduling week
  eligibleDomain: "university.edu",  // Restrict sign-in to this domain (or set null)
  // ... other settings
};
```

---

## 3. Google Calendar API — Service Account

1. Go to **Google Cloud Console → IAM & Admin → Service Accounts**
2. Create a service account with the **Calendar** scope
3. Download the JSON key
4. Share your Google Calendar with the service account email (grant "Make changes to events")
5. Store the key as a Firebase Secret:

```bash
firebase functions:secrets:set GOOGLE_SERVICE_ACCOUNT_JSON
# Paste the entire JSON key when prompted
```

---

## 4. Email Configuration (SMTP)

Set environment variables for the Cloud Function email sender:

```bash
firebase functions:config:set \
  scheduler.app_url="https://YOUR_PROJECT_ID.web.app" \
  scheduler.email_from="noreply@university.edu" \
  scheduler.smtp_host="smtp.gmail.com" \
  scheduler.smtp_port="587" \
  scheduler.smtp_user="your-email@gmail.com" \
  scheduler.smtp_pass="your-app-password"
```

Or use `.env` files for local emulation (see `functions/.env.local`).

---

## 5. Enable Google Auth in Firebase

1. Firebase Console → **Authentication → Sign-in method**
2. Enable **Google**
3. Add your domain to **Authorized domains**

---

## 6. Populate Initial Data

Use the **Admin dashboard** (`/admin`) to:
- Add eligible students (name + email) — or use the CSV bulk import
- Add faculty members (name + email)

Only users whose emails are in `students` or `faculty` collections can access the dashboards.

To bootstrap the first admin, manually add a document to Firestore:
```
Collection: admins
Document ID: your-admin@university.edu
Fields: { "email": "your-admin@university.edu" }
```

---

## 7. Deploy

```bash
# Install Cloud Functions dependencies
cd functions && npm install && cd ..

# Deploy everything
firebase deploy

# Or deploy individually
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

---

## 8. Week Configuration

Update `SCHEDULE_CONFIG.weekStartDate` in `public/js/config.js` to the **Monday** of each scheduling week before deploying.

| Days   | Window     | Who has access       |
|--------|------------|----------------------|
| 1–3    | Mon–Wed    | Students select times|
| 4–6    | Thu–Sat    | Faculty sign up      |
| 7      | Sun        | Admin runs reconciliation |

---

## Workflow Summary

1. **Before Day 1**: Admin adds students & faculty via the admin dashboard
2. **Days 1–3**: Students log in and select 3 preferred 45-min slots
3. **Days 4–6**: Faculty log in and sign up for student-requested slots
4. **Auto-trigger**: When 2 faculty sign up for the same slot → Google Meet is created, calendar invites sent, other student slots discarded
5. **Day 7**: Admin clicks "Run Reconciliation" → unmatched students get email to re-select times

---

## Local Development

```bash
firebase emulators:start
```

The emulator UI runs at `http://localhost:4000`.
