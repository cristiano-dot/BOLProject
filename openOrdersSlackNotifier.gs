// ─────────────────────────────────────────────
// CONFIGURATION — edit these values
// ─────────────────────────────────────────────
var SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL";

var SPREADSHEET_ID     = "1GGPDtzu_BKb3x2bpzfWK794-H1ny9TTu_cQ2KiZ1eXY";
var SHEET_NAME         = "Open Orders";
var TRACKING_SHEET     = "_BOL Tracking";   // hidden sheet used as key-value store

// Header names exactly as they appear in row 1 of your sheet (case-insensitive match)
var COL_ORDER_NUMBER   = "Order Number";
var COL_PO_NUMBER      = "PO Number";
var COL_SHIPPED_WEIGHT = "Shipped Weight";
var COL_REQUESTED      = "Requested";
var COL_RECEIVED       = "Received";
// ─────────────────────────────────────────────

// ── Trigger: runs automatically whenever the sheet is changed (import, paste, etc.)
// Set this up once: Triggers → Add Trigger → onChange → onSheetChange
function onSheetChange(e) {
  if (e && e.changeType === "EDIT") return; // single-cell edits handled by onEdit
  restoreTrackingColumns();
}

// ── Trigger: runs on every manual cell edit so Requested/Received are saved immediately
// Set this up once: Triggers → Add Trigger → onEdit → onCellEdit
function onCellEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim().toLowerCase(); });

  var idxOrder     = findColumn(headers, COL_ORDER_NUMBER);
  var idxRequested = findColumn(headers, COL_REQUESTED);
  var idxReceived  = findColumn(headers, COL_RECEIVED);

  if (idxOrder === -1 || (idxRequested === -1 && idxReceived === -1)) return;

  // Save full tracking state whenever Requested or Received columns are touched
  var editCol = e.range.getColumn() - 1; // 0-indexed
  if (editCol !== idxRequested && editCol !== idxReceived) return;

  saveTrackingColumns(ss, sheet, data, idxOrder, idxRequested, idxReceived);
}

// ── Saves all Order Number → {Requested, Received} pairs to the tracking sheet
function saveTrackingColumns(ss, sheet, data, idxOrder, idxRequested, idxReceived) {
  var tracking = getOrCreateTrackingSheet(ss);
  tracking.clearContents();
  tracking.appendRow(["Order Number", "Requested", "Received"]);

  for (var i = 1; i < data.length; i++) {
    var row      = data[i];
    var orderNum = String(row[idxOrder]).trim();
    if (!orderNum) continue;

    var requested = idxRequested !== -1 ? row[idxRequested] : "";
    var received  = idxReceived  !== -1 ? row[idxReceived]  : "";
    if (!requested && !received) continue;

    tracking.appendRow([orderNum, requested, received]);
  }
}

// ── Re-applies saved tracking data to the current sheet by matching Order Number
function restoreTrackingColumns() {
  var ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet   = ss.getSheetByName(SHEET_NAME);
  var tracking = ss.getSheetByName(TRACKING_SHEET);

  if (!sheet || !tracking) return;

  var data     = sheet.getDataRange().getValues();
  var trackData = tracking.getDataRange().getValues();

  if (data.length < 2 || trackData.length < 2) return;

  var headers  = data[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var idxOrder     = findColumn(headers, COL_ORDER_NUMBER);
  var idxRequested = findColumn(headers, COL_REQUESTED);
  var idxReceived  = findColumn(headers, COL_RECEIVED);

  if (idxOrder === -1) return;

  // Build lookup map: orderNumber → {requested, received}
  var lookup = {};
  for (var t = 1; t < trackData.length; t++) {
    var key = String(trackData[t][0]).trim();
    if (key) lookup[key] = { requested: trackData[t][1], received: trackData[t][2] };
  }

  // Write saved values back into the correct rows
  for (var i = 1; i < data.length; i++) {
    var orderNum = String(data[i][idxOrder]).trim();
    if (!orderNum || !lookup[orderNum]) continue;

    var saved = lookup[orderNum];

    if (idxRequested !== -1) {
      sheet.getRange(i + 1, idxRequested + 1).setValue(saved.requested);
    }
    if (idxReceived !== -1) {
      sheet.getRange(i + 1, idxReceived + 1).setValue(saved.received);
    }
  }
}

// ── Slack notification — reads sheet and posts pending orders
function sendOpenOrdersToSlack() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    Logger.log('Sheet "' + SHEET_NAME + '" not found.');
    return;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log("No data rows found.");
    return;
  }

  var headers = data[0].map(function(h) { return String(h).trim().toLowerCase(); });

  var idxOrder     = findColumn(headers, COL_ORDER_NUMBER);
  var idxPO        = findColumn(headers, COL_PO_NUMBER);
  var idxWeight    = findColumn(headers, COL_SHIPPED_WEIGHT);
  var idxRequested = findColumn(headers, COL_REQUESTED);
  var idxReceived  = findColumn(headers, COL_RECEIVED);

  var missing = [];
  if (idxOrder     === -1) missing.push(COL_ORDER_NUMBER);
  if (idxPO        === -1) missing.push(COL_PO_NUMBER);
  if (idxWeight    === -1) missing.push(COL_SHIPPED_WEIGHT);
  if (idxRequested === -1) missing.push(COL_REQUESTED);
  if (idxReceived  === -1) missing.push(COL_RECEIVED);

  if (missing.length > 0) {
    Logger.log("Could not find column(s): " + missing.join(", ") + "\nHeaders found: " + data[0].join(", "));
    return;
  }

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row      = data[i];
    var orderNum  = row[idxOrder];
    var poNum     = row[idxPO];
    var weight    = row[idxWeight];
    var requested = row[idxRequested];
    var received  = row[idxReceived];

    if (!orderNum && !poNum) continue;

    // Skip orders where we already have the BOL back
    if (received && String(received).trim() !== "") continue;

    var requestedLabel = (requested && String(requested).trim() !== "")
      ? ":white_check_mark: " + requested
      : ":hourglass: Not yet";

    rows.push(
      "*Order #:* " + orderNum +
      "   |   *PO #:* " + poNum +
      "   |   *Shipped Weight:* " + weight +
      "   |   *BOL Requested:* " + requestedLabel
    );
  }

  if (rows.length === 0) {
    Logger.log("No pending orders — nothing to send.");
    return;
  }

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM d, yyyy");

  var message = {
    text: ":package: *Open Orders Pending BOL — " + today + "* (" + rows.length + " order" + (rows.length === 1 ? "" : "s") + ")\n\n" + rows.join("\n")
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(message),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(SLACK_WEBHOOK_URL, options);
  Logger.log("Slack response: " + response.getContentText());
}

// ── Creates the hidden tracking sheet if it doesn't exist
function getOrCreateTrackingSheet(ss) {
  var tracking = ss.getSheetByName(TRACKING_SHEET);
  if (!tracking) {
    tracking = ss.insertSheet(TRACKING_SHEET);
    tracking.hideSheet();
  }
  return tracking;
}

function findColumn(headers, name) {
  var target = name.trim().toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === target) return i;
  }
  return -1;
}
