import { getFirestore } from "firebase-admin/firestore";
import { instrumentFirestore } from "~~/server/utils/firestoreLogging";

// Runs after firebase.server.ts - nitro loads plugins in filename order, and
// "firebase." sorts before "firestore-" - because taking the prototypes off an
// instance means there has to be an app to get an instance from.
//
// The patch is on the prototypes, so a handle obtained before this ran is
// covered too. Only a query issued before it would be missed, and nothing
// queries at import time.
export default defineNitroPlugin(() => {
  const patched = instrumentFirestore(getFirestore("koryta-pl"));
  if (patched.length) {
    console.info(`[Firestore] logging installed on: ${patched.join(", ")}`);
  }
});
