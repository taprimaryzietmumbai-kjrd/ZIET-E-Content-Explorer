/**
 * Alternative ZIET Mumbai E-Content Explorer backend.
 * Read-only with respect to Drive; reads all spreadsheet tabs and returns
 * extractable resource links. It does not modify spreadsheet data or Drive files.
 */
const SPREADSHEET_ID = "1AC71sfjr9uOfowsy0Kf_D0J4RQAKwyF8-BkiiJApu7I";
const DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1ZsgALM_uAYuX4GQxoMHyHnbHDP78EQX2?usp=sharing";
const HEADER_SCAN_ROWS = 15;

function doGet(e) {
  const params = (e && e.parameter) || {};
  const callback = String(params.callback || "");
  let response;
  try {
    if (String(params.action || "resources") !== "resources") {
      throw new Error("Unsupported action.");
    }
    const result = readAllTabResources_();
    response = {
      status: "success",
      resources: result.resources,
      diagnostics: {
        tabsScanned: result.tabsScanned,
        tabsWithResources: result.tabsWithResources,
        rowsReturned: result.resources.length,
        skippedTabs: result.skippedTabs
      },
      driveFolderUrl: DRIVE_FOLDER_URL
    };
  } catch (err) {
    response = {
      status: "error",
      message: String(err && err.message ? err.message : err),
      resources: []
    };
  }
  const json = JSON.stringify(response);
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function readAllTabResources_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  const all = [];
  const skippedTabs = [];
  const seen = new Set();
  let tabsWithResources = 0;

  sheets.forEach(sheet => {
    const range = sheet.getDataRange();
    const values = range.getDisplayValues();
    if (!values || values.length === 0) {
      skippedTabs.push(sheet.getName() + ": empty");
      return;
    }

    const rich = range.getRichTextValues();
    const formulas = range.getFormulas();
    const headerInfo = detectHeader_(values);
    let tabCount = 0;

    for (let r = 0; r < values.length; r++) {
      // Skip the detected header row itself.
      if (headerInfo && r === headerInfo.rowIndex) continue;
      const row = values[r] || [];
      const urls = extractUrlsFromRow_(row, rich[r] || [], formulas[r] || []);
      if (!urls.length) continue;

      const meta = getMetadata_(row, headerInfo ? headerInfo.columns : null, r, sheet.getName());
      urls.forEach(url => {
        const cleanUrl = normalizeUrl_(url);
        if (!cleanUrl || seen.has(cleanUrl)) return;
        seen.add(cleanUrl);
        all.push({
          className: meta.className,
          subject: meta.subject,
          title: meta.title || titleFromRow_(row, cleanUrl),
          type: meta.type || inferType_(meta.title, cleanUrl),
          description: meta.description,
          url: cleanUrl,
          sourceTab: sheet.getName(),
          sourceRow: r + 1
        });
        tabCount++;
      });
    }

    if (tabCount) tabsWithResources++;
    else skippedTabs.push(sheet.getName() + ": no extractable resource links");
  });

  return { resources: all, tabsScanned: sheets.length, tabsWithResources, skippedTabs };
}

function detectHeader_(values) {
  const limit = Math.min(values.length, HEADER_SCAN_ROWS);
  let best = null;
  for (let r = 0; r < limit; r++) {
    const normalized = (values[r] || []).map(normalizeHeader_);
    const cols = {
      className: findHeader_(normalized, ["class", "class name", "grade", "standard", "class/grade", "class / grade"]),
      subject: findHeader_(normalized, ["subject", "subject name", "discipline", "learning area"]),
      title: findHeader_(normalized, ["title", "resource title", "name", "resource name", "topic", "e-content title", "content title", "file name", "filename"]),
      type: findHeader_(normalized, ["resource type", "type", "category", "resource category", "e-content type", "format", "source column"]),
      description: findHeader_(normalized, ["description", "details", "keywords", "remarks", "remark", "description/keywords", "topic/description"]),
      url: findHeader_(normalized, ["url", "link", "resource url", "resource link", "drive link", "hyperlink", "file url", "file link", "web link", "content link"])
    };
    const score = [cols.className, cols.subject, cols.title, cols.type, cols.description, cols.url].filter(i => i >= 0).length;
    const hasLinkHeader = cols.url >= 0 || normalized.some(h => /url|link|hyperlink/.test(h));
    if (hasLinkHeader && score >= 1 && (!best || score > best.score)) best = { rowIndex: r, columns: cols, score };
  }
  return best;
}

function findHeader_(headers, names) {
  for (const name of names) {
    const index = headers.indexOf(normalizeHeader_(name));
    if (index >= 0) return index;
  }
  return -1;
}

function getMetadata_(row, cols, rowIndex, tabName) {
  const get = key => cols && cols[key] >= 0 ? String(row[cols[key]] || "").trim() : "";
  let title = get("title");
  let className = get("className");
  let subject = get("subject");
  let type = get("type");
  let description = get("description");

  // When a tab lacks conventional headers, retain useful row text and infer
  // simple metadata rather than discarding a row that contains an actual URL.
  if (!title) title = titleFromRow_(row, "");
  if (!className) className = inferClass_(row, tabName);
  if (!subject) subject = inferSubject_(row, tabName);
  if (!type) type = "";
  if (!description) description = "";
  return { title, className, subject, type, description };
}

function extractUrlsFromRow_(row, richRow, formulaRow) {
  const urls = [];
  const add = value => {
    const found = String(value || "").match(/https?:\/\/[^\s"'<>),;]+/g) || [];
    found.forEach(u => urls.push(u.replace(/[.]+$/, "")));
  };
  row.forEach((cell, i) => {
    add(cell);
    const rt = richRow[i];
    if (rt) {
      try {
        const whole = rt.getLinkUrl();
        if (whole) urls.push(whole);
        (rt.getRuns() || []).forEach(run => {
          const link = run.getLinkUrl();
          if (link) urls.push(link);
        });
      } catch (_) {}
    }
    add(formulaRow[i]);
  });
  return [...new Set(urls.map(normalizeUrl_).filter(Boolean))];
}

function normalizeUrl_(url) {
  let u = String(url || "").trim();
  // Remove common punctuation accidentally included at the end of a URL.
  u = u.replace(/[\])}>,.;]+$/, "");
  if (!/^https?:\/\//i.test(u)) return "";
  return u;
}

function titleFromRow_(row, url) {
  const candidates = (row || []).map(v => String(v || "").trim()).filter(Boolean)
    .filter(v => !/^https?:\/\//i.test(v))
    .filter(v => !/^=HYPERLINK\(/i.test(v));
  return candidates.find(v => !/^class$|^subject$|^url$|^link$/i.test(v)) || url || "Untitled resource";
}

function inferClass_(row, tabName) {
  const text = [tabName].concat(row || []).join(" ");
  const m = text.match(/\b(Balvatika\s*[123]?|Class\s*(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|[1-9]|1[0-2])|Grade\s*\d{1,2})\b/i);
  if (!m) return "";
  return m[1].replace(/^class\s*/i, "").trim();
}

function inferSubject_(row, tabName) {
  const known = ["English", "Hindi", "Mathematics", "Maths", "Science", "Social Science", "Social Studies", "Sanskrit", "EVS", "TWAU", "Computer Science", "Informatics Practices", "Biology", "Physics", "Chemistry", "History", "Geography", "Economics", "Accountancy", "Business Studies"];
  const text = [tabName].concat(row || []).join(" ").toLowerCase();
  return known.find(s => text.includes(s.toLowerCase())) || "";
}

function inferType_(title, url) {
  const text = String(title || "").toLowerCase() + " " + String(url || "").toLowerCase();
  if (/youtube|\.mp4|video/.test(text)) return "Videos / Audio-Visual Resources";
  if (/\.pptx?|presentation|slides/.test(text)) return "PPTs / Presentations";
  if (/worksheet|practice sheet/.test(text)) return "Worksheets / Practice Material";
  if (/lesson plan|teaching.learning|tlm/.test(text)) return "Lesson Plans / Teaching-Learning Material";
  if (/assessment|question bank|question paper|quiz/.test(text)) return "Question Banks / Assessment Resources";
  return "Any other relevant e-content";
}

function normalizeHeader_(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
