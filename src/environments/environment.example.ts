/**
 * Dev/local environment TEMPLATE.
 *
 * Copy this file to `environment.ts` and replace the `firebase` block with your
 * own project's config:
 *   Firebase console → Project settings → General → Your apps → SDK setup and configuration.
 *
 * environment.ts is gitignored so real config is never committed.
 */
export const environment = {
  production: false,

  // --- Firebase config (replace with your own) ---
  firebase: {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.firebasestorage.app',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
  },

  /**
   * Multi-tenancy plumbing. Every lead is stamped with, and every query filtered by,
   * this id. There is only one live studio today, so it is hard-coded and never shown
   * in the UI. When this becomes a multi-studio product, derive it from the signed-in
   * user / tenant instead of reading it from here. See LeadService.locationId.
   */
  defaultLocationId: 'auckland-studio',

  /**
   * Baseline auth is a thin stub. With requireAuth=false the auth guard is a pass-through
   * so you can run the app immediately. Flip to true once you have created Firebase Auth
   * users — the guard will then redirect anonymous visitors to /login.
   */
  requireAuth: false,

  /**
   * Dev-only: seed the `leads` collection with sample data on startup IF it is empty.
   * Never runs when production=true. See SeedService.
   */
  seedOnStartup: true,
};
