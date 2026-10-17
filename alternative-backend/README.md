# Alternative E-Content Explorer: all-tabs backend

This is the separate backend source for `alternative.html`. It is designed to read extractable resource links from **all tabs** in the existing resource-index spreadsheet, while leaving the original Explorer, original Apps Script deployment, spreadsheet contents, and Drive files unchanged.

## What the backend does

- Scans every tab in spreadsheet `1AC71sfjr9uOfowsy0Kf_D0J4RQAKwyF8-BkiiJApu7I`.
- Looks for link-bearing rows across each tab, including direct URLs, rich-text hyperlinks, and URLs inside formulas such as `HYPERLINK()`.
- Uses recognizable headers where available (Class, Subject, Title, Resource Type, Description, URL/Link).
- Keeps useful metadata when present and infers limited class/subject/type details when headers are absent.
- Deduplicates identical URLs in the returned feed.
- Returns diagnostics: number of tabs scanned, tabs containing extractable links, row count, and tabs with no extractable links.
- Does **not** modify spreadsheet data or Drive files.

## Required one-time setup

The all-tabs backend must be deployed as a **separate Google Apps Script Web App**. It cannot run from GitHub Pages by itself.

1. Open Google Apps Script and create a **new, separate project** for the alternative Explorer. Do not edit the Apps Script project used by the original Mumbai Explorer.
2. Replace the new project's starter code with the contents of `alternative-backend/Code.gs`.
3. Save the project.
4. Choose **Deploy → New deployment → Web app**.
5. Set **Execute as** to your account. Set access according to your KVS sharing policy (the web app must be accessible to the intended Explorer users and must have permission to read the spreadsheet).
6. Deploy and copy the Web app URL ending in `/exec`.
7. Open `alternative.html` in this repository and replace `PASTE_ALL_TABS_WEB_APP_URL_HERE` in the `DATA_ENDPOINT` constant with the new URL. Commit that one-line configuration change.
8. Open the alternative page and verify the resource count, sample links, and filters.

## Important

Until the separate Web App is deployed and its URL is entered into `alternative.html`, the alternative page intentionally does not use the original one-tab endpoint. It will display a connection notice rather than silently showing an incomplete one-tab feed.

The original `index.html`, original Apps Script deployment, spreadsheet contents, and Drive contents are not changed by this alternative backend work.
