export async function fetchSpeakers() {
  try {
    const res = await fetch("/api/speakers/list-names");
    const data = await res.json();
    return Array.isArray(data.speakers) ? data.speakers : [];
  } catch (err) {
    console.error("❌ Failed to fetch speakers:", err);
    return [];
  }
}

export async function deleteSpeaker(name) {
  try {
    const res = await fetch(`/api/speakers/${name}`, { method: "DELETE" });
    return await res.json();
  } catch (err) {
    console.error(`❌ Failed to delete speaker "${name}":`, err);
    return { error: err.message };
  }
}

export async function renameSpeaker(oldName, newName) {
  try {
    const res = await fetch(`/api/speakers/${oldName}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName })
    });
    return await res.json();
  } catch (err) {
    console.error(`❌ Failed to rename speaker:`, err);
    return { error: err.message };
  }
}

export async function improveSpeaker(name, file) {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(`/api/speakers/${name}/improve`, {
      method: "POST",
      body: form
    });
    return await res.json();
  } catch (err) {
    console.error(`❌ Failed to improve speaker:`, err);
    return { error: err.message };
  }
}
