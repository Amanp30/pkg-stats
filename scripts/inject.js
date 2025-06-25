(async () => {
  const TRACKED_PACKAGES_KEY = "trackedPackages";
  const PREFERRED_COLUMNS_KEY = "columns";
  const DEFAULT_SERVICE_KEY = "defaultService";

  function chromeGet(area, key) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].get(key, (result) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result[key]);
      });
    });
  }

  function chromeSet(area, data) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].set(data, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }

  function injectSidebarStylesheet() {
    if (document.getElementById("pkg-stats-style-link")) return;
    const link = document.createElement("link");
    link.id = "pkg-stats-style-link";
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = chrome.runtime.getURL("sidebar.css");
    document.head.appendChild(link);
  }

  function removeSidebarStylesheet() {
    const style = document.getElementById("pkg-stats-style-link");
    if (style) style.remove();
  }

  function getSidebar() {
    return document.getElementById("pkg-stats-sidebar");
  }

  async function fetchAndParse(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return res.json();
  }

  async function getColumnPreferences() {
    const validKeys = ["daily", "weekly", "monthly", "yearly"];
    try {
      const prefs = (await chromeGet("sync", PREFERRED_COLUMNS_KEY)) || {};
      return validKeys.filter((key) => prefs[key]);
    } catch (err) {
      console.error("Failed to get column preferences:", err);
      return [];
    }
  }

  async function getTrackedPackages() {
    try {
      return (await chromeGet("local", TRACKED_PACKAGES_KEY)) || [];
    } catch (err) {
      console.error("Failed to get tracked packages:", err);
      return [];
    }
  }

  async function removePackageFromTracked(pkgName) {
    try {
      const packages = (await chromeGet("local", TRACKED_PACKAGES_KEY)) || [];
      const updated = packages.filter((name) => name !== pkgName);
      await chromeSet("local", { [TRACKED_PACKAGES_KEY]: updated });
    } catch (err) {
      console.error("Failed to remove package:", err);
    }
  }

  async function isPackageAlreadyInStorage(pkg) {
    const tracked = await getTrackedPackages();
    return tracked.includes(pkg);
  }

  function isPackagePage() {
    return window.location.pathname.startsWith("/package/");
  }

  function getCurrentPackageName() {
    const path = window.location.pathname;
    if (!path.startsWith("/package/")) return null;
    const segments = path.split("/").filter(Boolean);
    const pkgSegments = segments.slice(1);
    return decodeURIComponent(pkgSegments.join("/"));
  }

  async function getDownloadStats(service) {
    const columns = await getColumnPreferences();
    const tracked = await getTrackedPackages();

    const columnMap = {
      npm: {
        daily: "last-day",
        weekly: "last-week",
        monthly: "last-month",
        yearly: "last-year",
      },
      jsdelivr: {
        daily: "day",
        weekly: "week",
        monthly: "month",
        yearly: "year",
      },
    }[service];

    const urlBuilder = {
      npm: (pkg, period) =>
        `https://api.npmjs.org/downloads/point/${period}/${pkg}`,
      jsdelivr: (pkg, period) =>
        `https://data.jsdelivr.com/v1/stats/packages/npm/${pkg}?period=${period}`,
    }[service];

    const parseDownloads = {
      npm: (json) => json.downloads ?? json.total ?? 0,
      jsdelivr: (json) => json.hits?.total ?? 0,
    }[service];

    const promises = tracked.map(async (pkg) => {
      const pkgStats = { packageName: pkg };
      await Promise.all(
        columns.map(async (col) => {
          const period = columnMap[col];
          const url = urlBuilder(pkg, period);
          try {
            const json = await fetchAndParse(url);

            pkgStats[col] = parseDownloads(json);
          } catch (err) {
            console.warn(`${service} ${col} failed for ${pkg}`, err);
            pkgStats[col] = "N/A";
          }
        })
      );
      return pkgStats;
    });

    return Promise.all(promises);
  }

  function renderSettingsIcon() {
    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("assets/settings.svg");
    icon.alt = "Settings";
    icon.className = "pkg-stats-settings-icon";
    icon.width = 24;
    icon.height = 24;
    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "openOptionsPage" });
    });
    return icon;
  }

  function renderCloseIcon() {
    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("assets/close.svg");
    icon.alt = "Close";
    icon.className = "pkg-stats-close-icon";
    icon.width = 24;
    icon.height = 24;
    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSidebar();
    });
    return icon;
  }

  async function renderHeader() {
    const section = document.createElement("section");
    section.id = "header-section";
    section.className = "pkg-header";

    const leftDiv = document.createElement("div");
    leftDiv.className = "pkg-header-left";

    const title = document.createElement("h2");
    title.className = "title";
    title.textContent = "Package Stats";

    const select = document.createElement("select");
    const options = ["npm", "jsdelivr"];
    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });

    const savedService =
      (await chromeGet("sync", DEFAULT_SERVICE_KEY)) || "npm";
    select.value = savedService;

    select.addEventListener("change", async function (e) {
      const selectedService = e.target.value;
      await chromeSet("sync", { [DEFAULT_SERVICE_KEY]: selectedService });
      const sidebar = getSidebar();
      await refreshStatsTable(selectedService, sidebar);
    });

    leftDiv.appendChild(title);
    leftDiv.appendChild(select);

    const rightDiv = document.createElement("div");
    rightDiv.className = "pkg-header-right-div";
    rightDiv.appendChild(renderSettingsIcon());
    rightDiv.appendChild(renderCloseIcon());

    section.appendChild(leftDiv);
    section.appendChild(rightDiv);

    return section;
  }

  let currentSort = { column: null, asc: true };

  function sortData(data, column) {
    const sorted = [...data].sort((a, b) => {
      const aVal = a[column] ?? 0;
      const bVal = b[column] ?? 0;
      return typeof aVal === "number" && typeof bVal === "number"
        ? currentSort.asc
          ? aVal - bVal
          : bVal - aVal
        : currentSort.asc
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return sorted;
  }

  async function renderTable(data, forceColumns = null) {
    const col_pref = forceColumns || (await getColumnPreferences());
    const table = document.createElement("table");
    table.className = "pkg-stats-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    const tableHeaders = [
      "Package",
      ...col_pref.map((c) => c.charAt(0).toUpperCase() + c.slice(1)),
      "",
    ];

    tableHeaders.forEach((headerText, idx) => {
      const th = document.createElement("th");
      const isSortable = idx !== 0 && idx !== tableHeaders.length - 1;
      th.textContent = headerText;

      if (isSortable) {
        th.classList.add("sortable");
        const key = col_pref[idx - 1];
        if (currentSort.column === key) {
          th.classList.add(currentSort.asc ? "sorted-asc" : "sorted-desc");
        }
        th.addEventListener("click", async () => {
          currentSort.column === key
            ? (currentSort.asc = !currentSort.asc)
            : (currentSort = { column: key, asc: true });
          const sortedData = sortData(data, key);
          const newTable = await renderTable(sortedData);
          table.replaceWith(newTable);
        });
      }

      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    data.forEach((pkg) => {
      const row = document.createElement("tr");

      const nameTd = document.createElement("td");
      nameTd.title = pkg.packageName;
      nameTd.textContent = pkg.packageName || "—";
      row.appendChild(nameTd);

      col_pref.forEach((col) => {
        const td = document.createElement("td");
        td.textContent = pkg[col] ?? "—";
        row.appendChild(td);
      });

      const deleteTd = document.createElement("td");
      const deleteIcon = document.createElement("img");
      deleteIcon.src = chrome.runtime.getURL("assets/trash.svg");
      deleteIcon.width = 20;
      deleteIcon.height = 20;
      deleteIcon.style.cursor = "pointer";
      deleteIcon.alt = "Delete";
      deleteIcon.title = "Remove package";
      deleteIcon.addEventListener("click", async () => {
        await removePackageFromTracked(pkg.packageName);
        const container = getSidebar();
        const service = (await chromeGet("sync", DEFAULT_SERVICE_KEY)) || "npm";
        await refreshStatsTable(service, container);
      });

      deleteTd.appendChild(deleteIcon);
      row.appendChild(deleteTd);

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    return table;
  }

  function renderEmptyStateMessage() {
    const messageDiv = document.createElement("div");
    messageDiv.className = "pkg-empty-message";

    const msg = document.createElement("p");
    msg.textContent = "No packages are being tracked yet.";

    messageDiv.appendChild(msg);

    // Only show instructions if NOT on a package page
    if (!isPackagePage()) {
      const ul = document.createElement("ul");
      ul.style.margin = "12px 0 0 18px";
      ul.style.padding = "0";
      ul.style.listStyle = "disc inside";

      const li1 = document.createElement("li");
      li1.innerHTML =
        'Go to any package page (for example: <a href="https://www.npmjs.com/package/ap-ssg" target="_blank" rel="noopener">https://www.npmjs.com/package/ap-ssg</a>)';
      ul.appendChild(li1);

      const li2 = document.createElement("li");
      li2.textContent = "Click the extension again to open the sidebar.";
      ul.appendChild(li2);

      const li3 = document.createElement("li");
      li3.textContent = "Click the 'Track Now' button to add the package.";
      ul.appendChild(li3);

      messageDiv.appendChild(ul);
    }

    return messageDiv;
  }

  async function refreshStatsTable(
    service,
    container = document.getElementById("pkg-stats-sidebar")
  ) {
    // Clear previous UI (table or message)
    container
      .querySelectorAll(
        ".pkg-stats-table, .pkg-empty-message, .pkg-message-box"
      )
      .forEach((el) => el.remove());

    // Always show 'Track Now' message box below header if on package page and current package is not tracked
    let msgBox = null;
    if (isPackagePage()) {
      const currentPkg = getCurrentPackageName();
      if (currentPkg && !(await isPackageAlreadyInStorage(currentPkg))) {
        msgBox = await getMessageBox(service, () =>
          refreshStatsTable(service, container)
        );
      }
    }

    // Insert message box after header section
    const header = container.querySelector("#header-section");
    if (msgBox && header) {
      header.insertAdjacentElement("afterend", msgBox);
    }

    const loader = document.createElement("div");
    loader.className = "pkg-stats-spinner";
    container.appendChild(loader);

    try {
      const data = await getDownloadStats(service);
      loader.remove();

      if (!data.length) {
        const emptyMsg = renderEmptyStateMessage();
        container.appendChild(emptyMsg);
      } else {
        const table = await renderTable(data);
        container.appendChild(table);
      }
    } catch (err) {
      loader.textContent = "Failed to load stats.";
      loader.className = "";
    }
  }

  async function getMessageBox(service, refreshCallback) {
    const currentPkg = getCurrentPackageName();
    const alreadyTracked = await isPackageAlreadyInStorage(currentPkg);
    if (!currentPkg || alreadyTracked) return null;

    const box = document.createElement("div");
    box.className = "pkg-message-box";

    const message = document.createElement("p");
    message.textContent = `Track stats for "${currentPkg}"?`;

    const button = document.createElement("button");
    button.textContent = "Track Now";
    button.className = "pkg-track-btn";
    button.addEventListener("click", async () => {
      const existing = await getTrackedPackages();
      if (!existing.includes(currentPkg)) {
        const updated = [...existing, currentPkg];
        await chromeSet("local", { [TRACKED_PACKAGES_KEY]: updated });
        box.remove();
        await refreshCallback();
      }
    });

    box.appendChild(message);
    box.appendChild(button);
    return box;
  }

  async function createSidebar() {
    // Prevent multiple sidebars
    if (getSidebar()) return;
    injectSidebarStylesheet();

    const sidebar = document.createElement("div");
    sidebar.id = "pkg-stats-sidebar";

    const headerBar = await renderHeader();
    sidebar.appendChild(headerBar);
    document.body.appendChild(sidebar);

    const service = (await chromeGet("sync", DEFAULT_SERVICE_KEY)) || "npm";

    if (isPackagePage()) {
      const msgBox = await getMessageBox(service, () =>
        refreshStatsTable(service, sidebar)
      );
      if (msgBox) sidebar.appendChild(msgBox);
    }

    await refreshStatsTable(service, sidebar);
    document.addEventListener("mousedown", handleClickOutside);
  }

  function handleClickOutside(event) {
    const sidebar = getSidebar();
    if (sidebar && !sidebar.contains(event.target)) {
      sidebar.remove();
      document.removeEventListener("mousedown", handleClickOutside);
      removeSidebarStylesheet(); // Ensure stylesheet is removed
    }
  }

  function toggleSidebar() {
    const sidebar = getSidebar();
    if (sidebar) {
      sidebar.remove();
      document.removeEventListener("mousedown", handleClickOutside); // Remove event listener
      removeSidebarStylesheet();
    } else {
      createSidebar();
    }
  }

  toggleSidebar();
})();
