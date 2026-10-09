// Empty by default: requests go to /api on the same origin and the Vite
// dev proxy forwards them to the backend.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

// JSON API call that throws an Error with a user-friendly message on failure.
// Pass `json` for a JSON body or `form` for FormData (file uploads).
export async function api(path, { method = "GET", json, form } = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: "same-origin",
      headers: json ? { "Content-Type": "application/json" } : undefined,
      body: json ? JSON.stringify(json) : form,
    });
  } catch {
    throw new Error("Can't reach OmniFit right now. Please check your connection and try again.");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      (typeof data?.detail === "string" && data.detail) ||
      "Something went wrong. Please try again."
    );
    error.status = response.status;
    throw error;
  }

  return data;
}
