// auth.js — login/register UX niceties
(() => {
  // Password strength meter (only on register page)
  const pw = document.getElementById("password");
  const strengthEl = document.getElementById("strength");
  if (pw && strengthEl) {
    const score = (v) => {
      let s = 0;
      if (v.length >= 6) s++;
      if (v.length >= 10) s++;
      if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
      if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
      return s; // 0..4
    };
    pw.addEventListener("input", () => {
      const s = score(pw.value);
      strengthEl.classList.remove("s1", "s2", "s3", "s4");
      if (s > 0) strengthEl.classList.add(`s${s}`);
    });
  }
})();
