// members.js — delete with confirm modal + toast
(function () {
  'use strict';

  window.toast = window.toast || function (msg, kind = 'info') {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${kind}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3400);
  };

  const modal     = document.getElementById('confirm-modal');
  const nameEl    = document.getElementById('confirm-name');
  let pendingId   = null;
  let pendingCard = null;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    pendingId   = btn.dataset.id;
    pendingCard = btn.closest('.member-card');
    nameEl.textContent = btn.dataset.name || 'this member';
    modal.classList.add('open');
  });

  modal.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'cancel' || e.target === modal) {
      modal.classList.remove('open');
      pendingId = null; pendingCard = null;
    }
    if (e.target.dataset.action === 'confirm') {
      doDelete();
    }
  });

  async function doDelete() {
    if (!pendingId) return;
    modal.classList.remove('open');
    try {
      const res = await fetch(`/api/members/${pendingId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      // Animate the card out
      if (pendingCard) {
        pendingCard.style.transition = 'all 0.3s ease';
        pendingCard.style.opacity = '0';
        pendingCard.style.transform = 'scale(0.95) translateY(10px)';
        setTimeout(() => {
          pendingCard.remove();
          // Empty state if last one
          const grid = document.querySelector('.member-grid');
          if (grid && grid.children.length === 0) {
            window.location.reload();
          }
        }, 320);
      }
      toast('Member deleted.', 'success');
    } catch (err) {
      toast(err.message || 'Delete failed', 'error');
    }
    pendingId = null; pendingCard = null;
  }
})();
