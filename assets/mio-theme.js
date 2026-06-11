(() => {
  const STORAGE_KEY = "mio-theme";
  const root = document.documentElement;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function storedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }

  function systemTheme() {
    return media && media.matches ? "dark" : "light";
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable in private or embedded contexts.
    }
  }

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      root.dataset.theme = theme;
    } else {
      delete root.dataset.theme;
    }

    const resolved = theme || systemTheme();
    root.dataset.themeResolved = resolved;
    if (metaTheme) {
      metaTheme.setAttribute("content", resolved === "dark" ? "#141311" : "#f6f7f9");
    }

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const next = resolved === "dark" ? "light" : "dark";
      button.setAttribute("aria-label", next === "dark" ? "다크 테마로 전환" : "라이트 테마로 전환");
      button.setAttribute("title", next === "dark" ? "다크 테마로 전환" : "라이트 테마로 전환");
    });
  }

  applyTheme(storedTheme());

  if (media) {
    const onSystemChange = () => {
      if (!storedTheme()) {
        applyTheme(null);
      }
    };
    if (media.addEventListener) {
      media.addEventListener("change", onSystemChange);
    } else if (media.addListener) {
      media.addListener(onSystemChange);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(storedTheme());
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const resolved = root.dataset.themeResolved || systemTheme();
        const next = resolved === "dark" ? "light" : "dark";
        setStoredTheme(next);
        applyTheme(next);
      });
    });
  });
})();
