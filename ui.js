const UI = {
  escape(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  setError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  },

  fillSelect(select, options, placeholder) {
    const items = placeholder
      ? [`<option value="">${placeholder}</option>`]
      : [];
    items.push(
      ...options.map((opt) => `<option value="${this.escape(opt)}">${this.escape(opt)}</option>`)
    );
    select.innerHTML = items.join("");
  },

  hallStatus(allocated, capacity) {
    if (allocated === 0) return "EMPTY";
    if (allocated >= capacity) return "FULL";
    return "PARTIALLY FILLED";
  }
};
