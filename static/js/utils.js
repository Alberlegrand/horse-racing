export function renderTicketStatus(status = "pending") {
  const styles = {
    paid: "bg-green-100 text-green-800",
    voided: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
  };
  return `<span class="px-2 py-1 rounded ${styles[status] || "bg-gray-100 text-gray-800"}">${status}</span>`;
}

export function updateStats(round = {}) {
  const roundEl = document.getElementById("currentRound");
  const ticketEl = document.getElementById("activeTickets");
  roundEl.textContent = round.id || "-";
  ticketEl.textContent = round.receipts?.length || 0;
}
