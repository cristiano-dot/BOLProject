// ─────────────────────────────────────────────
// CONFIGURATION — edit these values
// ─────────────────────────────────────────────
var SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL";

var SPREADSHEET_ID    = "1GGPDtzu_BKb3x2bpzfWK794-H1ny9TTu_cQ2KiZ1eXY";
var SHEET_NAME        = "Open Orders";

// Header names exactly as they appear in row 1 of your sheet (case-insensitive match)
var COL_ORDER_NUMBER  = "Order Number";
var COL_PO_NUMBER     = "PO Number";
var COL_SHIPPED_WEIGHT = "Shipped Weight";
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

  var idxOrder  = findColumn(headers, COL_ORDER_NUMBER);
  var idxPO     = findColumn(headers, COL_PO_NUMBER);
  var idxWeight = findColumn(headers, COL_SHIPPED_WEIGHT);

  if (idxOrder === -1 || idxPO === -1 || idxWeight === -1) {
    Logger.log(
      "Could not find one or more columns.\n" +
      "Headers found: " + data[0].join(", ") + "\n" +
      "Looking for: " + COL_ORDER_NUMBER + ", " + COL_PO_NUMBER + ", " + COL_SHIPPED_WEIGHT
    );
    return;
  }

  // Build the order list (skip header row)
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var orderNum = row[idxOrder];
    var poNum    = row[idxPO];
    var weight   = row[idxWeight];

    // Skip blank rows
    if (!orderNum && !poNum) continue;

    rows.push(
      "*Order #:* " + orderNum +
      "   |   *PO #:* " + poNum +
      "   |   *Shipped Weight:* " + weight
    );
  }

  if (rows.length === 0) {
    Logger.log("No open orders to send.");
    return;
  }

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM d, yyyy");

  var message = {
    text: ":package: *Open Orders Ready for Pickup — " + today + "*\n\n" + rows.join("\n")
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
