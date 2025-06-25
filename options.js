// Initialize count
function updatePackageCount() {
  chrome.storage.local.get("trackedPackages", (data) => {
    const tracked = data.trackedPackages || [];
    document.getElementById(
      "pkg-count"
    ).textContent = `(${tracked.length} packages)`;
  });
}

// Export tracked list to txt
document.getElementById("export-btn").addEventListener("click", () => {
  chrome.storage.local.get("trackedPackages", (data) => {
    const tracked = data.trackedPackages || [];
    const blob = new Blob([tracked.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "tracked-packages.txt";
    a.click();

    URL.revokeObjectURL(url);
  });
});

// Import tracked list from txt
document.getElementById("import-btn").addEventListener("click", () => {
  const fileInput = document.getElementById("import-file");
  const file = fileInput.files[0];
  const statusDiv = document.getElementById("import-status");

  if (!file) {
    statusDiv.style.color = "#f87171"; // red
    statusDiv.textContent = "Please select a .txt file to import.";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const lines = reader.result
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lines.length) {
      statusDiv.style.color = "#f87171";
      statusDiv.textContent = "The file is empty or incorrectly formatted.";
      return;
    }

    chrome.storage.local.get("trackedPackages", (data) => {
      const existing = new Set(data.trackedPackages || []);
      let addedCount = 0;

      lines.forEach((pkg) => {
        if (!existing.has(pkg)) {
          existing.add(pkg);
          addedCount++;
        }
      });

      chrome.storage.local.set(
        { trackedPackages: Array.from(existing) },
        () => {
          statusDiv.style.color = "#22c55e"; // green
          statusDiv.textContent = `${addedCount} package${
            addedCount !== 1 ? "s" : ""
          } imported successfully.`;
          updatePackageCount();
        }
      );
    });
  };

  reader.readAsText(file);
});

// Clear all
document.getElementById("clear-btn").addEventListener("click", () => {
  if (confirm("Are you sure you want to clear all tracked packages?")) {
    chrome.storage.local.set({ trackedPackages: [] }, updatePackageCount);
  }
});

// Define all available columns (including new 'daily')
const columnKeys = ["daily", "weekly", "monthly", "yearly"];

// Attach event listeners dynamically
columnKeys.forEach((key) => {
  const checkbox = document.getElementById(`col-${key}`);
  if (!checkbox) return;

  checkbox.addEventListener("change", () => {
    const prefs = {
      columns: {},
    };

    columnKeys.forEach((k) => {
      const cb = document.getElementById(`col-${k}`);
      if (cb) prefs.columns[k] = cb.checked;
    });

    chrome.storage.sync.set(prefs);
  });
});

// Restore saved column settings
chrome.storage.sync.get("columns", (data) => {
  const saved = data.columns || {};
  columnKeys.forEach((key) => {
    const checkbox = document.getElementById(`col-${key}`);
    if (checkbox) checkbox.checked = saved[key] !== false; // default true
  });
});

// On load
updatePackageCount();
