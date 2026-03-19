// ============================================================
// auth.js — Shared authentication helpers
// Depends on: Firebase App + Auth being initialized,
//             and config.js being loaded first.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const app  = initializeApp(firebaseConfig);   // firebaseConfig from config.js
export const auth = getAuth(app);
export const db   = getFirestore(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: SCHEDULE_CONFIG.eligibleDomain || undefined });

// ---- Sign in ----
export async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("Sign-in error:", err);
    throw err;
  }
}

// ---- Sign out ----
export async function logOut() {
  await signOut(auth);
  window.location.href = "/";
}

// ---- Determine user role ----
export async function getUserRole(user) {
  if (!user) return null;
  const email = user.email;

  // Check admin first
  const adminSnap = await getDoc(doc(db, "admins", email));
  if (adminSnap.exists()) return "admin";

  const studentSnap = await getDoc(doc(db, "students", email));
  if (studentSnap.exists()) return "student";

  const facultySnap = await getDoc(doc(db, "faculty", email));
  if (facultySnap.exists()) return "faculty";

  return "unknown";
}

// ---- Render nav user chip ----
export function renderNavUser(user) {
  const navUser = document.getElementById("navUser");
  if (!navUser || !user) return;
  navUser.innerHTML = `
    ${user.photoURL ? `<img src="${user.photoURL}" alt="${user.displayName}">` : ""}
    <span>${user.displayName || user.email}</span>
    <button class="btn btn-secondary btn-sm" id="signOutBtn">Sign out</button>
  `;
  document.getElementById("signOutBtn").addEventListener("click", logOut);
}

// ---- Guard: redirect to / if not authenticated ----
export function requireAuth(callback) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "/";
    } else {
      callback(user);
    }
  });
}
