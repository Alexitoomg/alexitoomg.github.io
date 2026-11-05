(() => {
  "use strict";

  const config = window.DARKPASS_CONFIG || {};
  const required = config.SUPABASE_URL && config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_URL.includes("TU-PROYECTO") &&
    !config.SUPABASE_ANON_KEY.includes("TU_PUBLISHABLE_KEY");

  const $ = (id) => document.getElementById(id);
  let db = null;
  let currentUser = null;
  let currentRole = null;
  let scanner = null;
  let scannerBusy = false;
  let tickets = [];
  let realtimeChannel = null;

  const statusNames = {
    available: "Disponible",
    used: "Utilizada",
    cancelled: "Anulada"
  };

  const resultNames = {
    accepted: "Aceptada",
    already_used: "Ya utilizada",
    cancelled: "Anulada",
    not_found: "No encontrada"
  };

  function message(element, text, type = "") {
    element.textContent = text;
    element.className = type ? `message ${type}` : "message";
  }

  function showApp() {
    $("appSection").hidden = false;
    $("userRole").textContent = "ADMINISTRADOR";
    document.querySelectorAll(".admin-only").forEach(el => { el.hidden = false; });
  }

  async function createTicket(event) {
    event.preventDefault();
    if (currentRole !== "admin") return;

    const guest = $("guestName").value.trim();
    const eventName = $("eventName").value.trim();
    if (!guest || !eventName) {
      message($("createMessage"), "Completá ambos campos.");
      return;
    }

    const button = $("ticketForm").querySelector("button");
    button.disabled = true;

    const { data, error } = await db.rpc("create_ticket", {
      p_guest_name: guest,
      p_event_name: eventName
    });

    button.disabled = false;

    if (error) {
      message($("createMessage"), `No se pudo crear la entrada: ${error.message}`);
      return;
    }

    $("guestName").value = "";
    message($("createMessage"), "Entrada creada correctamente.");
    renderNewTicket(data);
    await refreshAll();
  }

  function renderNewTicket(ticket) {
    const preview = $("newTicketPreview");
    preview.replaceChildren();

    const wrapper = document.createElement("div");
    wrapper.className = "ticket-preview";
    const qr = document.createElement("div");
    qr.className = "qr-box";
    const details = document.createElement("div");

    const heading = document.createElement("h3");
    heading.textContent = "DARK PASS";
    const guest = document.createElement("p");
    guest.textContent = `Invitado: ${ticket.guest_name}`;
    const event = document.createElement("p");
    event.textContent = `Evento: ${ticket.event_name}`;
    const code = document.createElement("p");
    code.textContent = `Código: ${ticket.id}`;

    const download = document.createElement("button");
    download.type = "button";
    download.className = "primary";
    download.textContent = "Descargar QR";
    download.addEventListener("click", () => downloadQr(qr, ticket.id));

    details.append(heading, guest, event, code, download);
    wrapper.append(qr, details);
    preview.append(wrapper);

    new QRCode(qr, {
      text: ticket.id,
      width: 190,
      height: 190,
      colorDark: "#09090f",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  function downloadQr(container, id) {
    const canvas = container.querySelector("canvas");
    const image = container.querySelector("img");
    const url = canvas ? canvas.toDataURL("image/png") : image?.src;
    if (!url) return;

    const link = document.createElement("a");
    link.href = url;
    link.download = `DARKPASS-${id}.png`;
    link.click();
  }

  async function loadTickets() {
    const { data, error } = await db
      .from("tickets")
      .select("id, guest_name, event_name, status, created_at, used_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(error);
      $("ticketTable").innerHTML = '<tr><td colspan="6">No se pudieron cargar las entradas.</td></tr>';
      return;
    }
    tickets = data || [];
    renderTickets();
    updateStats();
  }

  function renderTickets() {
    const body = $("ticketTable");
    body.replaceChildren();

    const query = $("ticketSearch").value.trim().toLowerCase();
    const filtered = tickets.filter(ticket =>
      ticket.guest_name.toLowerCase().includes(query) ||
      ticket.id.toLowerCase().includes(query) ||
      ticket.event_name.toLowerCase().includes(query)
    );

    if (!filtered.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "muted";
      cell.textContent = "No hay entradas que coincidan.";
      row.append(cell);
      body.append(row);
      return;
    }

    filtered.forEach(ticket => {
      const row = document.createElement("tr");
      const values = [
        ticket.guest_name,
        ticket.event_name,
        ticket.id,
        statusNames[ticket.status] || ticket.status,
        new Date(ticket.created_at).toLocaleString()
      ];

      values.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 2) cell.className = "code-cell";
        if (index === 3) {
          const badge = document.createElement("span");
          badge.className = `status ${ticket.status}`;
          badge.textContent = value;
          cell.replaceChildren(badge);
        }
        row.append(cell);
      });

      const actionCell = document.createElement("td");
      if (currentRole === "admin" && ticket.status === "available") {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "table-action";
        cancel.textContent = "Anular";
        cancel.addEventListener("click", () => cancelTicket(ticket.id));
        actionCell.append(cancel);
      } else {
        actionCell.textContent = "—";
      }
      row.append(actionCell);
      body.append(row);
    });
  }

  function updateStats() {
    $("totalTickets").textContent = tickets.length;
    $("availableTickets").textContent = tickets.filter(t => t.status === "available").length;
    $("usedTickets").textContent = tickets.filter(t => t.status === "used").length;
    $("cancelledTickets").textContent = tickets.filter(t => t.status === "cancelled").length;
  }

  async function cancelTicket(id) {
    if (currentRole !== "admin") return;
    if (!window.confirm("¿Seguro que querés anular esta entrada?")) return;

    const { data, error } = await db.rpc("cancel_ticket", { p_ticket_id: id });
    if (error) {
      window.alert(`No se pudo anular: ${error.message}`);
      return;
    }
    if (data.result !== "cancelled") {
      window.alert("La entrada no se pudo anular. Puede que ya haya sido utilizada.");
    }
    await refreshAll();
  }

  async function loadActivity() {
    const { data, error } = await db
      .from("scan_logs")
      .select("id, ticket_id, scanned_by, result, scanned_at")
      .order("scanned_at", { ascending: false })
      .limit(100);

    const body = $("activityTable");
    body.replaceChildren();

    if (error || !data?.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "muted";
      cell.textContent = error ? "No se pudo cargar el historial." : "Todavía no hay escaneos.";
      row.append(cell);
      body.append(row);
      return;
    }

    data.forEach(log => {
      const ticket = tickets.find(t => t.id === log.ticket_id);
      const row = document.createElement("tr");
      [
        new Date(log.scanned_at).toLocaleString(),
        resultNames[log.result] || log.result,
        ticket ? ticket.guest_name : (log.ticket_id || "Código desconocido"),
        log.scanned_by || "—"
      ].forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });
      body.append(row);
    });
  }

  async function refreshAll() {
    await loadTickets();
    await loadActivity();
  }

  function subscribeRealtime() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    realtimeChannel = db.channel("dark-pass-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, refreshAll)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scan_logs" }, loadActivity)
      .subscribe();
  }

  async function startScanner() {
    const result = $("scanResult");
    if (!currentUser) {
      result.textContent = "Iniciá sesión primero.";
      result.className = "scan-result invalid";
      return;
    }
    if (scanner?.isScanning) return;
    if (typeof Html5Qrcode === "undefined") {
      result.textContent = "No se pudo cargar la librería del escáner.";
      result.className = "scan-result invalid";
      return;
    }

    scannerBusy = false;
    try {
      if (!scanner) scanner = new Html5Qrcode("reader");
      result.textContent = "Solicitando acceso a la cámara…";
      result.className = "scan-result";

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        async decodedText => {
          if (scannerBusy) return;
          scannerBusy = true;
          await stopScanner();
          await validateTicket(decodedText);
        },
        () => {}
      );
      result.textContent = "Cámara activa. Escaneá una entrada.";
    } catch (error) {
      console.error(error);
      result.textContent = "No se pudo activar la cámara. Revisá permisos y HTTPS.";
      result.className = "scan-result invalid";
    }
  }

  async function stopScanner() {
    scannerBusy = true;
    if (scanner?.isScanning) {
      try { await scanner.stop(); }
      catch (error) { console.error("No se pudo detener la cámara:", error); }
    }
  }

  async function validateTicket(code) {
    const result = $("scanResult");
    const { data, error } = await db.rpc("validate_ticket", { p_ticket_id: code });

    if (error) {
      result.textContent = `ERROR DE VALIDACIÓN: ${error.message}`;
      result.className = "scan-result invalid";
      return;
    }

    const messages = {
      accepted: "ACCESO AUTORIZADO",
      already_used: "ENTRADA YA UTILIZADA",
      cancelled: "ENTRADA ANULADA",
      not_found: "ENTRADA NO ENCONTRADA"
    };
    const accepted = data.result === "accepted";
    result.textContent = `${messages[data.result] || "RESULTADO DESCONOCIDO"}${data.guest ? `: ${data.guest}` : ""}`;
    result.className = accepted ? "scan-result valid" : "scan-result invalid";
    await refreshAll();
  }

  async function initialize() {
    if (!required || !window.supabase) {
      document.querySelector("main").innerHTML =
        '<section class="content"><h1>Configuración pendiente</h1><p class="muted">Configurá SUPABASE_URL y SUPABASE_ANON_KEY en config.js para conectar DARK PASS.</p></section>';
      return;
    }

    db = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

    // Acceso directo: no se crea ni se solicita una sesión de usuario.
    currentUser = { email: "Acceso directo" };
    currentRole = "admin";
    showApp();

    $("ticketForm").addEventListener("submit", createTicket);
    $("startScanner").addEventListener("click", startScanner);
    $("stopScanner").addEventListener("click", async () => {
      await stopScanner();
      $("scanResult").textContent = "Escáner detenido.";
      $("scanResult").className = "scan-result";
    });
    $("ticketSearch").addEventListener("input", renderTickets);

    await refreshAll();
    subscribeRealtime();
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();