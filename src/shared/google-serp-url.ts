// Partial upstream port: only the google.com/goto matcher needed by the rank
// checker (upstream #1164). The live-SERP helpers (uule encoding, SERP URL
// building) belong to unrelated upstream features and were deliberately not
// taken.

/** Google wraps many organic results in a google.com/goto redirect. */
export function isGoogleRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.pathname === "/goto" &&
      /^(www\.)?google\.[a-z.]+$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}
