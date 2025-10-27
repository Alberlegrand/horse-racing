import { renderTicketStatus, updateStats } from "./utils.js";

export function init() {
  const ticketsEl = document.getElementById("ticketsList");

  async function refreshTickets() {
    const res = await fetch("/api/v1/rounds/?action=get");
    const data = await res.json();
    updateStats(data.data);
    ticketsEl.innerHTML = data.data.receipts
      .map(t => `<div class="p-2 border-b">${t.id} - ${renderTicketStatus(t.status)}</div>`)
      .join("") || "Aucun ticket";
  }

  document.getElementById("refreshTickets").addEventListener("click", refreshTickets);
  refreshTickets();
}
