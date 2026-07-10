// ─────────────────────────────────────────────
// CONFIGURATION — edit these values
// ─────────────────────────────────────────────
var SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL";

var SPREADSHEET_ID     = "1GGPDtzu_BKb3x2bpzfWK794-H1ny9TTu_cQ2KiZ1eXY";
var SHEET_NAME         = "Open Orders";

// Header names exactly as they appear in row 1 of your sheet (case-insensitive match)
var COL_ORDER_NUMBER   = "Order Number";
var COL_PO_NUMBER      = "PO Number";
var COL_SHIPPED_WEIGHT = "Shipped Weight";
var COL_REQUESTED      = "Requested";
var COL_RECEIVED       = "Received";
// ─────────────────────────────────────────────

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

  // Map header names → column indices
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
    Logger.log(
      "Could not find column(s): " + missing.join(", ") + "\n" +
      "Headers found: " + data[0].join(", ")
    );
    return;
  }

  // Build the order list — skip blank rows and orders where BOL was already received
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var orderNum  = row[idxOrder];
    var poNum     = row[idxPO];
    var weight    = row[idxWeight];
    var requested = row[idxRequested];
    var received  = row[idxReceived];

    // Skip blank rows
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

function findColumn(headers, name) {
  var target = name.trim().toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === target) return i;
  }
  return -1;
}
