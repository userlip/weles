// Closing a Google Ads Weles session when the run was allowed to close it.
//
// A close that fails leaves the persistent profile held by a browser, and the
// next run's profile guard then refuses to start with "already open" and no
// word of why. The failure is written with its cause instead of dropped.
export async function closeGoogleAdsSession(session, label) {
  try {
    await session.close();
  } catch (error) {
    console.error(
      `[${label}] closing the Google Ads session failed, so its profile may still be held and the next run refused as already open: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
