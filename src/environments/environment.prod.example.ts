/**
 * Production environment TEMPLATE. Same shape as environment.example.ts.
 *
 * Copy this file to `environment.prod.ts` and fill in your prod Firebase project.
 * The build swaps this file in via the `fileReplacements` in angular.json for the
 * production configuration. environment.prod.ts is gitignored.
 */
export const environment = {
  production: true,

  firebase: {
    apiKey: 'YOUR_PROD_API_KEY',
    authDomain: 'YOUR_PROD_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROD_PROJECT_ID',
    storageBucket: 'YOUR_PROD_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_PROD_SENDER_ID',
    appId: 'YOUR_PROD_APP_ID',
  },

  requireAuth: true,
  seedOnStartup: false,
  useEmulators: false,
};
