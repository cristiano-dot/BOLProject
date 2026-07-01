import { useState } from "react";

const SHEET_ID = "1GGPDtzu_BKb3x2bpzfWK794-H1ny9TTu_cQ2KiZ1eXY";
const PICKUP_STATIC = {
  address: "3841 Perkins Ave, Cleveland, OH 44114",
  freightClass: "70",
  pickupHours: "1:00 PM – 5:00 PM",
};
const SCENARIOS = [
  { id: "auto", label: "Auto-detect from order data" },
  { id: "in_transit", label: "In Transit" },
  { id: "partial", label: "Partial Shipment" },
  { id: "backordered", label: "Backordered" },
  { id: "delivered", label: "Delivered / Invoiced" },
  { id: "pending", label: "Order Pending / Not Yet Shipped" },
];
const TONES = [
  { id: "professional", label: "Professional" },
  { id: "brief", label: "Brief & Direct" },
  { id: "apologetic", label: "Apologetic" },
];
const MCP_SERVER = {
  type: "url",
  url: "https://drivemcp.googleapis.com/mcp/v1",
  name: "google-drive-mcp",
};

// ── Status composer prompt ────────────────────────────────────────────────────
const statusSystemPrompt = `You are an order management specialist at Smith Corona, helping compose clear, professional customer-facing order status emails.

Use the order details (Order #, Customer PO, entered date, shipped date, invoice printed date, carrier, tracking number, and status) to compose a concise, helpful email.

Order status logic:
* If "Invoice Printed" is filled → order is fully shipped and invoiced (Delivered)
* If "Shipped" is filled but no Invoice Printed → order has shipped, awaiting invoice
* If neither Shipped nor Invoice Printed → order is still open/pending

Rules:
* Use only the data provided — never invent tracking numbers, dates, or amounts not in the data.
* If carrier or tracking number are marked "Not yet available", do not mention them in the email.
* If tracking is available, include it naturally (e.g. "You can track your shipment via UPS using tracking number 1Z999...").
* Keep emails focused and under 150 words unless the situation requires more.
* Format: Subject line first (prefixed with "Subject:"), then a blank line, then the email body.
* Sign off as: "[Your Name] | Customer Support | Smith Corona"
* If scenario is "auto", determine the most appropriate status from the order data and write accordingly.`;

// ── Pickup notification prompt ────────────────────────────────────────────────
const pickupSystemPrompt = `You are an order management specialist at Smith Corona. Write a professional freight pickup notification email to the customer.

The customer arranges their own freight. The order is ready for pickup. Include all provided shipment details clearly.

Always include:
* Reference to their PO number and our Smith Corona order number
* Pickup address: 3841 Perkins Ave, Cleveland, OH 44114
* Pickup hours: 1:00 PM – 5:00 PM (Monday–Friday)
* Freight class: 70
* Pallet count, pallet weight, and pallet dimensions if provided (use the manually-entered "Pallet Weight" if given; the "AS400 Shipped Weight" is a system reference figure for your own context and should only be used in the email if no pallet weight was manually provided)
* A note to contact us to schedule or confirm pickup

Format: Subject line first (prefixed with "Subject:"), then a blank line, then the email body. Sign off as: "[Your Name] | Customer Support | Smith Corona" Keep it under 200 words. Professional, clear, no filler.`;

// ── Shared order lookup prompt ────────────────────────────────────────────────
const makeLookupPrompt = (mode) => `You have access to Google Drive. Look up order data from Google Sheet (file ID: ${SHEET_ID}).

IMPORTANT: This file has multiple tabs — "Sheet1" (the full master report, which may be too large to read completely) and "Open Orders" (a filtered view containing only rows where Source = "open", which is small enough to read in full and is reliably complete). ALWAYS use the data from the "Open Orders" tab for your search, not Sheet1. If you cannot tell which tab a row came from, prefer rows that appear in the second/later table block, which corresponds to "Open Orders".

The sheet columns are: Order #, Co, User ID, Entered, Shipped, Invoice Printed, Customer PO, Source, FOB, Carrier, Shipped Weight, Tracking #s.

Note: every row in "Open Orders" will have Source = "open" by definition, since "history" (already invoiced) rows are excluded from that tab.

${mode === "scan"
  ? `Read ALL rows and return only orders that are ready for customer freight pickup (i.e. the customer needs to be notified to arrange pickup).`
  : `Find the row(s) matching the search term. The search term may be an Order # (like "29518") or a Customer PO number.`}

${mode === "scan" || mode === "pickup_single"
  ? ` PICKUP-READINESS RULE (apply this to every order you return, computing readyForPickup independently for each row — this is a precise boolean test, not a judgment call): A row is ready for pickup (readyForPickup = true) when ALL three of these are true:

1. The "Shipped" column is populated (not blank)
2. The "Invoice Printed" column is empty/blank
3. The FOB value is EXACTLY one of these (check FOB alone first — these two values are ALWAYS pickup-ready regardless of carrier):
   * FOB = "Customer Provided BOL" → ALWAYS readyForPickup = true (carrier does not matter)
   * FOB = "Pick Up" → ALWAYS readyForPickup = true (carrier does not matter)
   * FOB = "Collect" AND Carrier = "Special" (both must match exactly) → readyForPickup = true
   * Any other FOB value (e.g. "PrePaid/Add", "PrePaid", "Third Party", or "Collect" paired with any carrier other than "Special") → readyForPickup = false

Do this check independently of the Shipped/Invoice Printed check — a row can satisfy condition 3 but still be readyForPickup = false if Shipped is blank or Invoice Printed is filled.
${mode === "scan"
  ? "Only include rows in the output where readyForPickup = true."
  : "Include the order regardless of its readyForPickup value, and report that value accurately."}`
  : ""}

Return ONLY a JSON object, no other text.

${mode === "scan"
  ? `Since every matching row will have invoicePrinted blank, source "open", and readyForPickup true by definition, OMIT those three fields from each order object in scan mode to save space — only include them if mode were not scan. Use this compact shape for each order:
{ "found": true, "fobFilterApplied": true, "orders": [ { "orderNumber": "29518", "userId": "BEVACK", "entered": "06/11/2026 4:00:25 PM", "shipped": "06/12/2026 4:29:06 AM", "customerPO": "654334", "fob": "Collect", "carrier": "Special", "shippedWeight": "1410.224", "tracking": "", "status": "Shipped - awaiting invoice" } ] }
Be as terse as possible — no extra whitespace, no markdown, no commentary before or after the JSON. If you are running low on output budget, it is far better to return fewer complete order objects than to truncate mid-object. Prioritize completing the JSON structure over including every single matching row.`
  : `Use this full shape for each order:
{ "found": true, "fobFilterApplied": true, "orders": [ { "orderNumber": "29518", "company": "10", "userId": "BEVACK", "entered": "06/11/2026 4:00:25 PM", "shipped": "06/12/2026 4:29:06 AM", "invoicePrinted": "", "customerPO": "654334", "fob": "Collect", "carrier": "Special", "shippedWeight": "1410.224", "tracking": "", "source": "open", "status": "Shipped - awaiting invoice", "readyForPickup": true } ] }`}

If not found or no matches: { "found": false, "fobFilterApplied": true, "orders": [] }

Field notes:
* fob / carrier / shippedWeight / tracking: populate directly from the sheet columns (FOB, Carrier, Shipped Weight, Tracking #s). Use empty string if blank.
* readyForPickup: true only if the pickup conditions above are met
* status: "Pending - not yet shipped" | "Shipped - awaiting invoice" | "Fully shipped and invoiced" (based on whether Shipped/Invoice Printed are filled)
* fobFilterApplied should always be true since FOB and Carrier columns exist in this sheet.`;

// ── Helpers ───────────────────────────────────────────────────────────────────
const statusColor = (status) => {
  if (!status) return "#A0ABBE";
  if (status.includes("invoiced")) return "#22C55E";
  if (status.includes("Shipped")) return "#4A7CFF";
  return "#F59E0B";
};

const parseJSON = (text) => {
  const match = text?.match(/{[\s\S]*}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    // Response was likely truncated mid-array (hit max_tokens). Try to salvage
    // whatever complete order objects exist before the break point.
    const raw = match[0];
    const ordersStart = raw.indexOf('"orders"');
    if (ordersStart === -1) return null;
    const arrStart = raw.indexOf("[", ordersStart);
    if (arrStart === -1) return null;
    // Walk forward tracking brace depth to find complete {...} objects within the array
    let depth = 0, objStart = -1;
    const recovered = [];
    for (let i = arrStart + 1; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && objStart !== -1) {
          const chunk = raw.slice(objStart, i + 1);
          try { recovered.push(JSON.parse(chunk)); } catch { /* skip malformed object */ }
          objStart = -1;
        }
      }
    }
    if (recovered.length > 0) {
      return { found: true, fobFilterApplied: true, orders: recovered, _truncated: true };
    }
    return null;
  }
};

const extractText = (data) =>
  data.content?.filter((b) => b.type === "text").map((b) => b.text).join("") || "";

// ── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── Fix 1 & 2: API key gate — stored in localStorage, sent with every request ──
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("sc_anthropic_key") || "");
  const [apiKeyInput, setApiKeyInput] = useState("");

  const saveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    localStorage.setItem("sc_anthropic_key", trimmed);
    setApiKey(trimmed);
  };

  // Shared headers used by every Anthropic API call
  const anthropicHeaders = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "mcp-client-2025-04-04",
    "anthropic-dangerous-direct-browser-access": "true",
  };

  const [tab, setTab] = useState("status"); // "status" | "pickup"

  // ── Status tab state ──
  const [statusSearch, setStatusSearch] = useState("");
  const [statusSearching, setStatusSearching] = useState(false);
  const [statusOrders, setStatusOrders] = useState(null);
  const [statusSelected, setStatusSelected] = useState(null);
  const [statusSearchErr, setStatusSearchErr] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [scenario, setScenario] = useState("auto");
  const [tone, setTone] = useState("professional");
  const [extraContext, setExtraContext] = useState("");
  const [statusResult, setStatusResult] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusErr, setStatusErr] = useState(null);
  const [statusCopied, setStatusCopied] = useState(false);
  const [statusDebug, setStatusDebug] = useState(null);

  // ── Pickup tab state ──
  const [pickupMode, setPickupMode] = useState("scan"); // "scan" | "lookup"
  const [pickupSearch, setPickupSearch] = useState("");
  const [pickupSearching, setPickupSearching] = useState(false);
  const [pickupOrders, setPickupOrders] = useState(null);
  const [pickupSelected, setPickupSelected] = useState(null);
  const [pickupSearchErr, setPickupSearchErr] = useState(null);
  const [fobNote, setFobNote] = useState("");
  const [palletCount, setPalletCount] = useState("");
  const [palletWeight, setPalletWeight] = useState("");
  const [palletDims, setPalletDims] = useState("");
  const [pickupCustomer, setPickupCustomer] = useState("");
  const [pickupExtra, setPickupExtra] = useState("");
  const [pickupResult, setPickupResult] = useState(null);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [pickupErr, setPickupErr] = useState(null);
  const [pickupCopied, setPickupCopied] = useState(false);
  const [pickupDebug, setPickupDebug] = useState(null);

  // ── Status: search ──
  const handleStatusSearch = async () => {
    if (!statusSearch.trim()) return;
    setStatusSearching(true);
    setStatusSearchErr(null);
    setStatusOrders(null);
    setStatusSelected(null);
    setStatusResult(null);
    setStatusDebug(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system: makeLookupPrompt("single"),
          messages: [{ role: "user", content: `Search for order/PO: "${statusSearch.trim()}"` }],
          mcp_servers: [MCP_SERVER],
        }),
      });
      const data = await res.json();
      const text = extractText(data);
      const parsed = parseJSON(text);
      setStatusDebug({
        status: res.status,
        hasError: !!data.error,
        errorMsg: data.error?.message,
        rawText: text,
        blockTypes: data.content?.map((b) => b.type),
        parsed,
      });
      if (parsed?.found && parsed.orders?.length > 0) {
        setStatusOrders(parsed.orders);
        if (parsed.orders.length === 1) setStatusSelected(parsed.orders[0]);
      } else {
        setStatusSearchErr(`No order found matching "${statusSearch}".`);
      }
    } catch (e) {
      setStatusSearchErr("Lookup failed. Please try again.");
      setStatusDebug({ caughtError: String(e) });
    } finally {
      setStatusSearching(false);
    }
  };

  // ── Status: generate email ──
  const handleStatusGenerate = async () => {
    if (!statusSelected) return;
    setStatusErr(null);
    setStatusResult(null);
    setStatusLoading(true);
    const scenarioLabel = SCENARIOS.find((s) => s.id === scenario)?.label;
    const toneLabel = TONES.find((t) => t.id === tone)?.label;
    const summary = `Order #: ${statusSelected.orderNumber}
Customer PO: ${statusSelected.customerPO}
Entered: ${statusSelected.entered}
Shipped: ${statusSelected.shipped || "Not yet shipped"}
Invoice Printed: ${statusSelected.invoicePrinted || "Not yet invoiced"}
Carrier: ${statusSelected.carrier || "Not yet available"}
Tracking #: ${statusSelected.tracking || "Not yet available"}
Status: ${statusSelected.status}
Rep/User: ${statusSelected.userId}`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: statusSystemPrompt,
          messages: [{
            role: "user",
            content: `Scenario: ${scenarioLabel}\nTone: ${toneLabel}\n${customerName ? `Customer: ${customerName}\n` : ""}${extraContext ? `Context: ${extraContext}\n` : ""}\nOrder Data:\n${summary}`,
          }],
        }),
      });
      const data = await res.json();
      setStatusResult(extractText(data));
    } catch {
      setStatusErr("Something went wrong. Please try again.");
    } finally {
      setStatusLoading(false);
    }
  };

  // ── Pickup: scan or lookup ──
  const handlePickupSearch = async () => {
    const isScan = pickupMode === "scan";
    if (!isScan && !pickupSearch.trim()) return;
    setPickupSearching(true);
    setPickupSearchErr(null);
    setPickupOrders(null);
    setPickupSelected(null);
    setPickupResult(null);
    setFobNote("");
    setPickupDebug(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: isScan ? 8000 : 4000,
          system: makeLookupPrompt(isScan ? "scan" : "pickup_single"),
          messages: [{
            role: "user",
            content: isScan
              ? "Scan the sheet for all orders ready for customer pickup."
              : `Search for order/PO: "${pickupSearch.trim()}"`,
          }],
          mcp_servers: [MCP_SERVER],
        }),
      });
      const data = await res.json();
      const text = extractText(data);
      const parsed = parseJSON(text);
      setPickupDebug({
        status: res.status,
        hasError: !!data.error,
        errorMsg: data.error?.message,
        rawText: text,
        blockTypes: data.content?.map((b) => b.type),
        parsed,
      });
      if (parsed?.found && parsed.orders?.length > 0) {
        const ready = isScan ? parsed.orders : parsed.orders.filter((o) => o.readyForPickup);
        if (ready.length > 0) {
          setPickupOrders(ready);
          if (ready.length === 1) setPickupSelected(ready[0]);
          if (!parsed.fobFilterApplied)
            setFobNote("FOB/carrier columns not yet in sheet — showing all shipped-not-invoiced orders.");
          else if (parsed._truncated)
            setFobNote("Response was cut off before finishing — the list below may be incomplete. Try narrowing the search or re-running the scan.");
        } else {
          setPickupSearchErr(
            isScan
              ? "No orders are currently ready for customer pickup."
              : "That order was found but is not flagged as ready for pickup (check FOB/carrier codes or shipped status)."
          );
        }
      } else {
        setPickupSearchErr(
          isScan ? "No orders ready for pickup found." : `No order found matching "${pickupSearch}".`
        );
      }
    } catch (e) {
      setPickupSearchErr("Lookup failed. Please try again.");
      setPickupDebug({ caughtError: String(e) });
    } finally {
      setPickupSearching(false);
    }
  };

  // ── Pickup: generate email ──
  const handlePickupGenerate = async () => {
    if (!pickupSelected) return;
    setPickupErr(null);
    setPickupResult(null);
    setPickupLoading(true);
    const details = `Smith Corona Order #: ${pickupSelected.orderNumber}
Customer PO: ${pickupSelected.customerPO}
Shipped / Ready Date: ${pickupSelected.shipped}
${pickupSelected.shippedWeight ? `AS400 Shipped Weight (reference): ${pickupSelected.shippedWeight} lbs` : ""}
${palletCount ? `Pallet Count: ${palletCount}` : ""}
${palletWeight ? `Pallet Weight: ${palletWeight} lbs` : ""}
${palletDims ? `Pallet Dimensions: ${palletDims}` : ""}
${pickupCustomer ? `Customer: ${pickupCustomer}` : ""}
${pickupExtra ? `Additional context: ${pickupExtra}` : ""}`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: pickupSystemPrompt,
          messages: [{
            role: "user",
            content: `Write a freight pickup notification email with these details:\n${details}`,
          }],
        }),
      });
      const data = await res.json();
      setPickupResult(extractText(data));
    } catch {
      setPickupErr("Something went wrong. Please try again.");
    } finally {
      setPickupLoading(false);
    }
  };

  const parseEmail = (text) => {
    if (!text) return { subject: "", body: "" };
    const lines = text.split("\n");
    const subLine = lines.find((l) => l.toLowerCase().startsWith("subject:"));
    const subject = subLine ? subLine.replace(/^subject:\s*/i, "").trim() : "";
    const body = lines.slice(subLine ? lines.indexOf(subLine) + 1 : 0).join("\n").trim();
    return { subject, body };
  };

  // Fix 3: clipboard write is async — chain .then()/.catch() so permission denials don't throw
  const copyText = (text, setCopied) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  const resetStatus = () => {
    setStatusSearch("");
    setStatusOrders(null);
    setStatusSelected(null);
    setStatusSearchErr(null);
    setCustomerName("");
    setScenario("auto");
    setTone("professional");
    setExtraContext("");
    setStatusResult(null);
    setStatusErr(null);
  };

  const resetPickup = () => {
    setPickupSearch("");
    setPickupOrders(null);
    setPickupSelected(null);
    setPickupSearchErr(null);
    setFobNote("");
    setPalletCount("");
    setPalletWeight("");
    setPalletDims("");
    setPickupCustomer("");
    setPickupExtra("");
    setPickupResult(null);
    setPickupErr(null);
  };

  const { subject: sSubject, body: sBody } = parseEmail(statusResult);
  const { subject: pSubject, body: pBody } = parseEmail(pickupResult);

  const OrderCard = ({ order, selected, onClick, showPickupBadge }) => (
    <div
      onClick={onClick}
      style={{
        padding: "16px 20px",
        cursor: "pointer",
        background: selected ? "#F0F4FF" : "#fff",
        borderLeft: selected ? "3px solid #4A7CFF" : "3px solid transparent",
        transition: "background 0.1s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: "700", fontSize: "14px", color: "#1A1F2E" }}>Order {order.orderNumber}</div>
          <div style={{ fontSize: "12px", color: "#6B7A99", marginTop: "3px" }}>Customer PO: {order.customerPO} · Rep: {order.userId}</div>
          <div style={{ fontSize: "12px", color: "#6B7A99", marginTop: "2px" }}>Entered: {order.entered}</div>
          {order.shipped && <div style={{ fontSize: "12px", color: "#6B7A99", marginTop: "2px" }}>Shipped: {order.shipped}</div>}
          {order.invoicePrinted && <div style={{ fontSize: "12px", color: "#6B7A99", marginTop: "2px" }}>Invoiced: {order.invoicePrinted}</div>}
          {order.fob && <div style={{ fontSize: "12px", color: "#6B7A99", marginTop: "2px" }}>FOB: {order.fob}{order.carrier ? ` · Carrier: ${order.carrier}` : ""}</div>}
          {order.shippedWeight && <div style={{ fontSize: "12px", color: "#6B7A99", marginTop: "2px" }}>Shipped Weight: {order.shippedWeight} lbs</div>}
          {order.tracking && <div style={{ fontSize: "12px", color: "#6B7A99", marginTop: "2px" }}>Tracking: {order.tracking}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end", marginLeft: "12px" }}>
          <span style={{ fontSize: "11px", fontWeight: "700", padding: "3px 10px", borderRadius: "20px", background: statusColor(order.status) + "20", color: statusColor(order.status), whiteSpace: "nowrap" }}>
            {order.status}
          </span>
          {showPickupBadge && order.readyForPickup !== false && (
            <span style={{ fontSize: "11px", fontWeight: "700", padding: "3px 10px", borderRadius: "20px", background: "#FFF3CD", color: "#B45309", whiteSpace: "nowrap" }}>
              Ready for pickup
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const EmailResult = ({ subject, body, result, loading, onRegenerate, onCopy, copied, onNew, onBackToList }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #E4E7EE", overflow: "hidden" }}>
        {subject && (
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #E4E7EE", display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "#6B7A99", textTransform: "uppercase", flexShrink: 0 }}>Subject</span>
            <span style={{ fontSize: "14px", fontWeight: "600", color: "#1A1F2E" }}>{subject}</span>
          </div>
        )}
        <div style={{ padding: "20px", whiteSpace: "pre-wrap", fontSize: "14px", lineHeight: "1.7", color: "#2D3447" }}>{body}</div>
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        <button onClick={onCopy} style={{ background: copied ? "#22C55E" : "#4A7CFF", color: "#fff", border: "none", borderRadius: "8px", padding: "12px 22px", fontSize: "13px", fontWeight: "700", cursor: "pointer", flex: 1 }}>
          {copied ? "✓ Copied!" : "Copy to Clipboard"}
        </button>
        <button onClick={onRegenerate} style={{ background: "#F0F3FA", color: "#4A7CFF", border: "1px solid #D0D8F0", borderRadius: "8px", padding: "12px 22px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
          Regenerate
        </button>
        {onBackToList && (
          <button onClick={onBackToList} style={{ background: "#F7F8FA", color: "#6B7A99", border: "1px solid #E4E7EE", borderRadius: "8px", padding: "12px 22px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
            ← Back to List
          </button>
        )}
        <button onClick={onNew} style={{ background: "#F7F8FA", color: "#6B7A99", border: "1px solid #E4E7EE", borderRadius: "8px", padding: "12px 22px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
          New Search
        </button>
      </div>
    </div>
  );

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "6px",
    border: "1px solid #D8DDE8",
    fontSize: "13px",
    color: "#1A1F2E",
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle = {
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.08em",
    color: "#6B7A99",
    textTransform: "uppercase",
    marginBottom: "10px",
  };
  const cardStyle = {
    background: "#fff",
    borderRadius: "10px",
    border: "1px solid #E4E7EE",
    padding: "16px 18px",
  };

  // ── API key gate ──────────────────────────────────────────────────────────────
  if (!apiKey) {
    return (
      <div style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif", background: "#F7F8FA", minHeight: "100vh" }}>
        <div style={{ background: "#1A1F2E", padding: "20px 32px", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "8px", height: "32px", background: "#4A7CFF", borderRadius: "2px" }} />
          <div>
            <div style={{ color: "#fff", fontWeight: "700", fontSize: "16px", letterSpacing: "-0.02em" }}>Smith Corona · Order Communications</div>
            <div style={{ color: "#8892A4", fontSize: "12px", marginTop: "1px" }}>Pulls live from your order report</div>
          </div>
        </div>
        <div style={{ maxWidth: "480px", margin: "80px auto", padding: "0 24px" }}>
          <div style={{ ...cardStyle, padding: "32px" }}>
            <div style={{ fontWeight: "700", fontSize: "15px", color: "#1A1F2E", marginBottom: "8px" }}>Enter your Anthropic API Key</div>
            <div style={{ fontSize: "13px", color: "#6B7A99", marginBottom: "20px" }}>Your key is stored locally in this browser and never sent anywhere except directly to Anthropic.</div>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
              placeholder="sk-ant-..."
              style={{ ...inputStyle, padding: "10px 14px", fontSize: "14px", marginBottom: "12px" }}
              autoFocus
            />
            <button
              onClick={saveApiKey}
              disabled={!apiKeyInput.trim()}
              style={{ background: apiKeyInput.trim() ? "#4A7CFF" : "#A0ABBE", color: "#fff", border: "none", borderRadius: "8px", padding: "12px 24px", fontSize: "13px", fontWeight: "700", cursor: apiKeyInput.trim() ? "pointer" : "not-allowed", width: "100%" }}
            >
              Save & Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif", background: "#F7F8FA", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "#1A1F2E", padding: "20px 32px", display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ width: "8px", height: "32px", background: "#4A7CFF", borderRadius: "2px" }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontWeight: "700", fontSize: "16px", letterSpacing: "-0.02em" }}>Smith Corona · Order Communications</div>
          <div style={{ color: "#8892A4", fontSize: "12px", marginTop: "1px" }}>Pulls live from your order report</div>
        </div>
        <button
          onClick={() => { localStorage.removeItem("sc_anthropic_key"); setApiKey(""); setApiKeyInput(""); }}
          style={{ background: "none", border: "1px solid #3A4158", borderRadius: "6px", color: "#8892A4", fontSize: "12px", padding: "6px 12px", cursor: "pointer" }}
        >
          Change API Key
        </button>
      </div>

      {/* Tabs */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E4E7EE", padding: "0 32px", display: "flex", gap: "0" }}>
        {[
          { id: "status", label: "Order Status Emails" },
          { id: "pickup", label: "Freight Pickup Notifications" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "none",
              border: "none",
              borderBottom: tab === t.id ? "2px solid #4A7CFF" : "2px solid transparent",
              color: tab === t.id ? "#1A1F2E" : "#6B7A99",
              fontWeight: tab === t.id ? "700" : "400",
              fontSize: "13px",
              padding: "14px 20px",
              cursor: "pointer",
              marginBottom: "-1px",
              transition: "all 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: "820px", margin: "0 auto", padding: "28px 24px" }}>

        {/* ── STATUS TAB ── */}
        {tab === "status" && (
          <>
            {!statusResult ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ ...cardStyle, padding: "20px" }}>
                  <div style={{ ...labelStyle, marginBottom: "12px" }}>Step 1 — Find the Order</div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <input
                      type="text"
                      value={statusSearch}
                      onChange={(e) => setStatusSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleStatusSearch()}
                      placeholder="Order # (e.g. 29518) or Customer PO"
                      style={{ ...inputStyle, flex: 1, padding: "10px 14px", fontSize: "14px" }}
                    />
                    <button
                      onClick={handleStatusSearch}
                      disabled={statusSearching || !statusSearch.trim()}
                      style={{ background: statusSearching ? "#A0ABBE" : "#4A7CFF", color: "#fff", border: "none", borderRadius: "7px", padding: "10px 20px", fontSize: "13px", fontWeight: "700", cursor: statusSearching ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                    >
                      {statusSearching ? "Looking up…" : "Look Up"}
                    </button>
                  </div>
                  {statusSearchErr && (
                    <div style={{ marginTop: "10px", color: "#C0392B", fontSize: "13px", background: "#FFF3F3", border: "1px solid #FFCDD2", borderRadius: "6px", padding: "10px 14px" }}>
                      {statusSearchErr}
                    </div>
                  )}
                  {statusDebug && (
                    <details style={{ marginTop: "10px", fontSize: "11px", color: "#6B7A99" }}>
                      <summary style={{ cursor: "pointer", fontWeight: "600" }}>Debug info (click to expand)</summary>
                      <pre style={{ whiteSpace: "pre-wrap", background: "#F7F8FA", padding: "10px", borderRadius: "6px", marginTop: "6px", maxHeight: "300px", overflow: "auto" }}>
                        {JSON.stringify(statusDebug, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>

                {statusOrders && (
                  <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #E4E7EE", overflow: "hidden" }}>
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid #E4E7EE", ...labelStyle, marginBottom: 0 }}>
                      {statusOrders.length === 1 ? "Order Found" : `${statusOrders.length} Orders Found — Select One`}
                    </div>
                    {statusOrders.map((order, i) => (
                      <div key={i} style={{ borderBottom: i < statusOrders.length - 1 ? "1px solid #F0F2F7" : "none" }}>
                        <OrderCard
                          order={order}
                          selected={statusSelected?.orderNumber === order.orderNumber}
                          onClick={() => setStatusSelected(order)}
                          showPickupBadge={false}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {statusSelected && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                      <div style={cardStyle}>
                        <div style={labelStyle}>Scenario</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {SCENARIOS.map((s) => (
                            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                              <input type="radio" name="scenario" value={s.id} checked={scenario === s.id} onChange={() => setScenario(s.id)} style={{ accentColor: "#4A7CFF" }} />
                              <span style={{ fontSize: "13px", color: scenario === s.id ? "#1A1F2E" : "#6B7A99", fontWeight: scenario === s.id ? "600" : "400" }}>{s.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <div style={cardStyle}>
                          <div style={labelStyle}>Tone</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {TONES.map((t) => (
                              <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                                <input type="radio" name="tone" value={t.id} checked={tone === t.id} onChange={() => setTone(t.id)} style={{ accentColor: "#4A7CFF" }} />
                                <span style={{ fontSize: "13px", color: tone === t.id ? "#1A1F2E" : "#6B7A99", fontWeight: tone === t.id ? "600" : "400" }}>{t.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div style={cardStyle}>
                          <div style={labelStyle}>Customer Name <span style={{ fontWeight: "400", color: "#A0ABBE" }}>(optional)</span></div>
                          <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Acme Corp / John Smith" style={inputStyle} />
                        </div>
                      </div>
                    </div>
                    <div style={cardStyle}>
                      <div style={labelStyle}>Extra Context <span style={{ fontWeight: "400", color: "#A0ABBE" }}>(optional)</span></div>
                      <input type="text" value={extraContext} onChange={(e) => setExtraContext(e.target.value)} placeholder="e.g. Customer called twice, ScanSource confirmed backorder until July…" style={inputStyle} />
                    </div>
                    {statusErr && (
                      <div style={{ background: "#FFF3F3", border: "1px solid #FFCDD2", borderRadius: "8px", padding: "12px 16px", color: "#C0392B", fontSize: "13px" }}>
                        {statusErr}
                      </div>
                    )}
                    <button
                      onClick={handleStatusGenerate}
                      disabled={statusLoading}
                      style={{ background: statusLoading ? "#A0ABBE" : "#4A7CFF", color: "#fff", border: "none", borderRadius: "8px", padding: "14px 24px", fontSize: "14px", fontWeight: "700", cursor: statusLoading ? "not-allowed" : "pointer" }}
                    >
                      {statusLoading ? "Drafting email…" : "Generate Email Draft →"}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <EmailResult
                subject={sSubject}
                body={sBody}
                result={statusResult}
                loading={statusLoading}
                onRegenerate={handleStatusGenerate}
                onNew={resetStatus}
                onBackToList={() => { setStatusResult(null); setStatusErr(null); }}
                onCopy={() => copyText(statusResult, setStatusCopied)}
                copied={statusCopied}
              />
            )}
          </>
        )}

        {/* ── PICKUP TAB ── */}
        {tab === "pickup" && (
          <>
            {!pickupResult ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

                {/* Mode toggle */}
                <div style={{ ...cardStyle, padding: "20px" }}>
                  <div style={{ ...labelStyle, marginBottom: "14px" }}>Step 1 — Find Orders Ready for Pickup</div>
                  <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
                    {[{ id: "scan", label: "Scan All Orders" }, { id: "lookup", label: "Look Up by Order / PO" }].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setPickupMode(m.id); setPickupOrders(null); setPickupSelected(null); setPickupSearchErr(null); setFobNote(""); }}
                        style={{
                          padding: "8px 16px",
                          borderRadius: "7px",
                          border: "1px solid",
                          fontSize: "13px",
                          fontWeight: "600",
                          cursor: "pointer",
                          background: pickupMode === m.id ? "#4A7CFF" : "#F7F8FA",
                          borderColor: pickupMode === m.id ? "#4A7CFF" : "#D8DDE8",
                          color: pickupMode === m.id ? "#fff" : "#6B7A99",
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {pickupMode === "lookup" && (
                    <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                      <input
                        type="text"
                        value={pickupSearch}
                        onChange={(e) => setPickupSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handlePickupSearch()}
                        placeholder="Order # or Customer PO"
                        style={{ ...inputStyle, flex: 1, padding: "10px 14px", fontSize: "14px" }}
                      />
                    </div>
                  )}

                  <button
                    onClick={handlePickupSearch}
                    disabled={pickupSearching || (pickupMode === "lookup" && !pickupSearch.trim())}
                    style={{ background: pickupSearching ? "#A0ABBE" : "#4A7CFF", color: "#fff", border: "none", borderRadius: "7px", padding: "10px 20px", fontSize: "13px", fontWeight: "700", cursor: pickupSearching ? "not-allowed" : "pointer" }}
                  >
                    {pickupSearching
                      ? (pickupMode === "scan" ? "Scanning sheet…" : "Looking up…")
                      : (pickupMode === "scan" ? "Scan for Ready Orders" : "Look Up")}
                  </button>

                  {pickupSearchErr && (
                    <div style={{ marginTop: "12px", color: "#C0392B", fontSize: "13px", background: "#FFF3F3", border: "1px solid #FFCDD2", borderRadius: "6px", padding: "10px 14px" }}>
                      {pickupSearchErr}
                    </div>
                  )}
                  {pickupDebug && (
                    <details style={{ marginTop: "12px", fontSize: "11px", color: "#6B7A99" }}>
                      <summary style={{ cursor: "pointer", fontWeight: "600" }}>Debug info (click to expand)</summary>
                      <pre style={{ whiteSpace: "pre-wrap", background: "#F7F8FA", padding: "10px", borderRadius: "6px", marginTop: "6px", maxHeight: "300px", overflow: "auto" }}>
                        {JSON.stringify(pickupDebug, null, 2)}
                      </pre>
                    </details>
                  )}
                  {fobNote && (
                    <div style={{ marginTop: "12px", color: "#B45309", fontSize: "12px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: "6px", padding: "10px 14px" }}>
                      ⚠ {fobNote}
                    </div>
                  )}
                </div>

                {pickupOrders && (
                  <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #E4E7EE", overflow: "hidden" }}>
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid #E4E7EE", ...labelStyle, marginBottom: 0 }}>
                      {pickupOrders.length === 1 ? "1 Order Ready for Pickup" : `${pickupOrders.length} Orders Ready for Pickup — Select One`}
                    </div>
                    {pickupOrders.map((order, i) => (
                      <div key={i} style={{ borderBottom: i < pickupOrders.length - 1 ? "1px solid #F0F2F7" : "none" }}>
                        <OrderCard
                          order={order}
                          selected={pickupSelected?.orderNumber === order.orderNumber}
                          onClick={() => setPickupSelected(order)}
                          showPickupBadge={true}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {pickupSelected && (
                  <>
                    {/* Static pickup info preview */}
                    <div style={{ ...cardStyle, background: "#F0F4FF", border: "1px solid #C7D7FF" }}>
                      <div style={{ ...labelStyle, color: "#3B5BDB" }}>Pre-filled Pickup Details</div>
                      <div style={{ fontSize: "13px", color: "#2D3447", lineHeight: "1.8" }}>
                        <div>📍 {PICKUP_STATIC.address}</div>
                        <div>🕐 Pickup Hours: {PICKUP_STATIC.pickupHours} (Mon–Fri)</div>
                        <div>📦 Freight Class: {PICKUP_STATIC.freightClass}</div>
                        <div>🔖 Reference #: {pickupSelected.orderNumber}</div>
                      </div>
                    </div>

                    {/* Shipment details */}
                    <div style={cardStyle}>
                      <div style={{ ...labelStyle, marginBottom: "14px" }}>Shipment Details <span style={{ fontWeight: "400", color: "#A0ABBE" }}>(enter what you have — leave blank if unknown)</span></div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                        <div>
                          <div style={{ fontSize: "11px", color: "#6B7A99", fontWeight: "600", marginBottom: "6px" }}>Pallet Count</div>
                          <input type="text" value={palletCount} onChange={(e) => setPalletCount(e.target.value)} placeholder="e.g. 2" style={inputStyle} />
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", color: "#6B7A99", fontWeight: "600", marginBottom: "6px" }}>Total Weight (lbs)</div>
                          <input type="text" value={palletWeight} onChange={(e) => setPalletWeight(e.target.value)} placeholder="e.g. 840" style={inputStyle} />
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", color: "#6B7A99", fontWeight: "600", marginBottom: "6px" }}>Dimensions (L×W×H)</div>
                          <input type="text" value={palletDims} onChange={(e) => setPalletDims(e.target.value)} placeholder='e.g. 48"×40"×52"' style={inputStyle} />
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        <div>
                          <div style={{ fontSize: "11px", color: "#6B7A99", fontWeight: "600", marginBottom: "6px" }}>Customer Name <span style={{ fontWeight: "400", color: "#A0ABBE" }}>(optional)</span></div>
                          <input type="text" value={pickupCustomer} onChange={(e) => setPickupCustomer(e.target.value)} placeholder="e.g. Acme Corp / John Smith" style={inputStyle} />
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", color: "#6B7A99", fontWeight: "600", marginBottom: "6px" }}>Extra Context <span style={{ fontWeight: "400", color: "#A0ABBE" }}>(optional)</span></div>
                          <input type="text" value={pickupExtra} onChange={(e) => setPickupExtra(e.target.value)} placeholder="e.g. Hazmat, requires liftgate…" style={inputStyle} />
                        </div>
                      </div>
                    </div>

                    {pickupErr && (
                      <div style={{ background: "#FFF3F3", border: "1px solid #FFCDD2", borderRadius: "8px", padding: "12px 16px", color: "#C0392B", fontSize: "13px" }}>
                        {pickupErr}
                      </div>
                    )}

                    <button
                      onClick={handlePickupGenerate}
                      disabled={pickupLoading}
                      style={{ background: pickupLoading ? "#A0ABBE" : "#4A7CFF", color: "#fff", border: "none", borderRadius: "8px", padding: "14px 24px", fontSize: "14px", fontWeight: "700", cursor: pickupLoading ? "not-allowed" : "pointer" }}
                    >
                      {pickupLoading ? "Drafting pickup notification…" : "Generate Pickup Notification →"}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <EmailResult
                subject={pSubject}
                body={pBody}
                result={pickupResult}
                loading={pickupLoading}
                onRegenerate={handlePickupGenerate}
                onNew={resetPickup}
                onBackToList={() => { setPickupResult(null); setPickupErr(null); }}
                onCopy={() => copyText(pickupResult, setPickupCopied)}
                copied={pickupCopied}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
